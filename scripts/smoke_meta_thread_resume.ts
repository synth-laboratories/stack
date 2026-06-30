#!/usr/bin/env bun

/**
 * Smoke: start meta-thread (goal bind) → save checkpoint (exit) → resolve resume bundle
 * and confirm harness + meta-thread state machines pick up where we left off.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"

import { loadConfig } from "../src/config.js"
import { emptyGoalContext } from "../src/codex/goal-context.js"
import {
  enrichResumeCheckpoint,
  metaThreadResumeLooksComplete,
} from "../src/checkpoint-state.js"
import {
  resolveResumeBundle,
  resumeCheckpointFromCheckpoint,
  writeResumeCheckpointSync,
} from "../src/resume-checkpoint.js"
import { runGoalSlashCommand, type GoalSlashAppState } from "../src/tui/goal-slash-dispatch.js"
import { stackdMetaThread, stackdSaveCheckpoint } from "../src/client/stackd.js"
import type { StackLocalSession } from "../src/session.js"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const smokeRoot = join(appRoot, ".stack", "evidence", "meta-thread-resume", stamp)
const stackRoot = join(smokeRoot, "stack-root")
const sessionLogDir = join(stackRoot, ".stack", "sessions")
const port = 19400 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const failures: string[] = []

mkdirSync(sessionLogDir, { recursive: true })

const threadId = `thread_${randomUUID()}`
const workspaceRoot = resolve(appRoot, "..")
const objective = "Resume smoke: confirm meta-thread checkpoint roundtrip"
const fakeCodexThreadId = `codex-thread-${randomUUID().slice(0, 8)}`

const session: StackLocalSession = {
  id: threadId,
  workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  harness: "codex",
  turns: [
    {
      id: randomUUID(),
      prompt: "kickoff worker turn",
      selectedPaths: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      stdout: JSON.stringify({ type: "thread.started", thread_id: fakeCodexThreadId }),
      stderr: "",
    },
  ],
}

writeFileSync(join(sessionLogDir, `${threadId}.json`), JSON.stringify(session, null, 2) + "\n")

const stackdBin = resolve(appRoot, "target/debug/stackd")
const proc = Bun.spawn([stackdBin, "serve", "--port", String(port)], {
  cwd: stackRoot,
  env: {
    ...process.env,
    STACK_ROOT: stackRoot,
    STACK_SESSION_DIR: sessionLogDir,
    STACK_API_URL: baseUrl,
    STACKD_MONITOR_SCHEDULER: "0",
  },
  stdout: "pipe",
  stderr: "pipe",
})

try {
  process.env.STACK_API_URL = baseUrl
  process.env.STACK_ROOT = stackRoot
  process.env.STACK_SESSION_DIR = sessionLogDir

  await waitForHealth(`${baseUrl}/health`)

  const config = await loadConfig(appRoot)
  const ctx = { config, session }
  const state: GoalSlashAppState = {
    goalContext: emptyGoalContext(),
    codexTransport: "exec",
  }

  const handled = await runGoalSlashCommand(
    `/goal ${objective}`,
    ctx,
    state,
    undefined,
    undefined,
    () => undefined,
    () => undefined,
  )
  if (!handled.handled) failures.push("goal set was not handled")
  if (!session.metaThreadId) failures.push("meta-thread not bound after /goal")

  const manifest = await stackdMetaThread(session.metaThreadId!)
  session.metaThreadId = manifest.id
  session.segmentId = manifest.head_segment_id
  session.codexThreadId = fakeCodexThreadId
  session.displayName = objective.slice(0, 48)
  writeFileSync(join(sessionLogDir, `${threadId}.json`), JSON.stringify(session, null, 2) + "\n")

  const exitCheckpoint = enrichResumeCheckpoint({
    checkpoint: {
      version: 1,
      savedAt: new Date().toISOString(),
      sessionId: session.id,
      goalShutterWorkerPeek: false,
      focusMode: "monitor",
    },
    session,
    manifest,
    transport: "exec",
    backendSessionId: fakeCodexThreadId,
  })

  writeResumeCheckpointSync(stackRoot, exitCheckpoint)
  await stackdSaveCheckpoint(exitCheckpoint)

  const token = resumeCheckpointFromCheckpoint(exitCheckpoint)
  const bundle = await resolveResumeBundle(stackRoot, sessionLogDir, token)
  if (!bundle) failures.push("resolveResumeBundle returned undefined")
  if (!bundle?.checkpoint.metaThreadState) failures.push("missing metaThreadState on resume")
  if (bundle?.checkpoint.metaThreadState?.phase !== "goal_active") {
    failures.push(`expected goal_active, got ${bundle?.checkpoint.metaThreadState?.phase}`)
  }
  if (bundle?.checkpoint.harnessResume?.resumeMethod !== "exec-transcript") {
    failures.push(
      `expected exec-transcript harness resume, got ${bundle?.checkpoint.harnessResume?.resumeMethod}`,
    )
  }
  if (bundle?.checkpoint.harnessResume?.backendSessionId !== fakeCodexThreadId) {
    failures.push("harness backendSessionId mismatch after resume")
  }
  if (bundle?.manifest?.active_goal?.objective !== objective) {
    failures.push("manifest objective mismatch after resume")
  }
  if ((bundle?.session as StackLocalSession).turns.length !== 1) {
    failures.push("session turns not preserved across resume")
  }
  if (!metaThreadResumeLooksComplete(bundle!.checkpoint, bundle!.manifest)) {
    failures.push("metaThreadResumeLooksComplete returned false")
  }

  const paused = await runGoalSlashCommand("/goal pause", ctx, state, undefined, undefined, () => undefined, () => undefined)
  if (!paused.handled) failures.push("/goal pause not handled")
  const pausedManifest = await stackdMetaThread(session.metaThreadId!)
  const pausedCheckpoint = enrichResumeCheckpoint({
    checkpoint: {
      version: 1,
      savedAt: new Date().toISOString(),
      sessionId: session.id,
    },
    session,
    manifest: pausedManifest,
    transport: "exec",
    backendSessionId: fakeCodexThreadId,
  })
  if (pausedCheckpoint.metaThreadState?.phase !== "goal_paused") {
    failures.push(`expected goal_paused after pause, got ${pausedCheckpoint.metaThreadState?.phase}`)
  }

  const summary = {
    stamp,
    token,
    meta_thread_id: session.metaThreadId,
    harness_resume: bundle?.checkpoint.harnessResume,
    meta_thread_state: bundle?.checkpoint.metaThreadState,
    failures,
    ok: failures.length === 0,
  }
  writeFileSync(join(smokeRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n")

  if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exit(1)
  }

  console.log("stack_meta_thread_resume_ok")
  console.log(JSON.stringify(summary, null, 2))
} finally {
  proc.kill()
  await proc.exited.catch(() => undefined)
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 20_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = `${response.status} ${await response.text()}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(250)
  }
  throw new Error(`stackd health failed: ${lastError}`)
}
