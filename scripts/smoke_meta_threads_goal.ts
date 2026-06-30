#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import {
  stackdApproveMetaThreadArtifact,
  stackdCreateMetaThread,
  stackdMetaThread,
  stackdSealMetaThreadSegment,
  stackdUpdateMetaThreadGoal,
} from "../src/client/stackd.js"
import { loadConfig } from "../src/config.js"
import { runMonitorAfterTurn } from "../src/monitor.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"
import { mergeMetaThreadGoalContext } from "../src/meta-thread-goal.js"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const smokeRoot = join(appRoot, ".stack", "evidence", "meta-threads-goal", stamp)
const stackRoot = join(smokeRoot, "stack-root")
const sessionLogDir = join(stackRoot, ".stack", "sessions")
const port = 18820 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const failures: string[] = []

mkdirSync(sessionLogDir, { recursive: true })
mkdirSync(join(smokeRoot, "proof"), { recursive: true })

const threadId = `thread_${randomUUID()}`
const workspaceRoot = resolve(appRoot, "..")
const objective = "Rebuild TicTacToe Harbor env; pass 20-scenario spectrum (harbor_reward=1.0)"

const session: StackLocalSession = {
  id: threadId,
  workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [],
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
  await waitForHealth(`${baseUrl}/health`)

  const created = await stackdCreateMetaThread({
    title: "Harbor env rebuild smoke",
    thread_id: threadId,
    role: "implement",
    model: "gpt-5.4-mini",
    reasoning_effort: "medium",
    harness: "codex",
    monitor_profile: "progress-narrator",
    active_goal: {
      objective,
      status: "active",
      acceptance_criteria: [
        "[ ] candidate/scripts/run_service.py exists",
        "[ ] 20-scenario spectrum passes",
      ],
      blockers: [],
    },
  })

  if (!created.active_goal?.objective) failures.push("create missing active_goal")
  if (created.head_segment_id.length === 0) failures.push("create missing head_segment_id")

  const updated = await stackdUpdateMetaThreadGoal(created.id, {
    blockers: ["ImportError: missing gold.board module"],
  })
  if (!updated.active_goal?.blockers?.includes("ImportError: missing gold.board module")) {
    failures.push("PATCH goal blockers not persisted")
  }

  const bound = await stackdMetaThread(created.id)
  if (bound.active_goal?.objective !== objective) failures.push("GET manifest active_goal mismatch")

  const artifact = await stackdSealMetaThreadSegment(created.id, created.head_segment_id, {
    summary: "Scaffolded Harbor candidate; pytest blocked on gold.board import",
    successor_role: "implement",
    recommended_next_action: "continue_implement",
  })

  const artifactPath = join(stackRoot, artifact.path.replace(/^\.stack\//, ".stack/"))
  const artifactBody = readFileSync(artifactPath, "utf8")
  if (!artifactBody.includes("## Goal progress")) failures.push("handoff artifact missing Goal progress section")
  if (!artifactBody.includes(objective)) failures.push("handoff artifact missing objective")
  if (!artifactBody.includes("ImportError: missing gold.board module")) {
    failures.push("handoff artifact missing blockers from manifest")
  }

  await stackdApproveMetaThreadArtifact(created.id, artifact.id, { thread_id: threadId })

  process.env.STACK_MONITOR_PROFILE = "progress-narrator"
  process.env.STACK_MONITOR_MODEL_WORKER = "deterministic"

  const config = await loadConfig(appRoot)
  const boundSession: StackLocalSession = {
    ...session,
    metaThreadId: created.id,
    segmentId: created.head_segment_id,
    segmentRole: "implement",
  }

  const turn: StackCodexTurn = {
    id: `turn-${randomUUID()}`,
    prompt: "Wire gold.board module for Harbor pytest",
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout: "Added gold.board stub; pytest still failing import chain.",
    stderr: "",
  }

  const goalContext = mergeMetaThreadGoalContext({ source: "none" }, bound)
  if (goalContext.objective !== objective) failures.push("mergeMetaThreadGoalContext objective mismatch")

  await runMonitorAfterTurn({
    config,
    session: { ...boundSession, turns: [turn] },
    turn,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
    goalContext,
  })

  const summary = {
    stamp,
    meta_thread_id: created.id,
    failures,
    ok: failures.length === 0,
    artifact_path: artifact.path,
    goal_objective: bound.active_goal?.objective,
  }

  writeFileSync(join(smokeRoot, "proof", "summary.json"), JSON.stringify(summary, null, 2) + "\n")

  if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exit(1)
  }

  console.log("stack_meta_threads_goal_ok")
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
