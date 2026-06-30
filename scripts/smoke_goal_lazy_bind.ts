#!/usr/bin/env bun

/**
 * Smoke test for lazy meta-thread binding: /goal <objective> on a brand-new
 * session (no metaThreadId, no codex app-server session) must auto-create and
 * bind a meta-thread instead of throwing "no meta-thread bound".
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { loadConfig } from "../src/config.js"
import { emptyGoalContext } from "../src/codex/goal-context.js"
import { runGoalSlashCommand, type GoalSlashAppState } from "../src/tui/goal-slash-dispatch.js"
import { stackdMetaThread } from "../src/client/stackd.js"
import type { StackLocalSession } from "../src/session.js"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const smokeRoot = join(appRoot, ".stack", "evidence", "goal-lazy-bind", stamp)
const stackRoot = join(smokeRoot, "stack-root")
const sessionLogDir = join(stackRoot, ".stack", "sessions")
const port = 19200 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const failures: string[] = []

mkdirSync(sessionLogDir, { recursive: true })

const threadId = `thread_${randomUUID()}`
const workspaceRoot = resolve(appRoot, "..")
const objective = "Lazy-bind smoke: wire up the candidate service"

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
  process.env.STACK_ROOT = stackRoot
  process.env.STACK_SESSION_DIR = sessionLogDir

  await waitForHealth(`${baseUrl}/health`)

  const config = await loadConfig(appRoot)
  const ctx = { config, session }
  const state: GoalSlashAppState = {
    goalContext: emptyGoalContext(),
    codexTransport: "exec",
  }

  const messages: string[] = []
  const feedback = (message: string) => messages.push(message)

  // Exactly the screenshot's repro: brand-new session, no metaThreadId, no
  // codex app-server session (exec transport / app-server unavailable).
  const handledSet = await runGoalSlashCommand(
    `/goal ${objective}`,
    ctx,
    state,
    undefined,
    undefined,
    () => undefined,
    feedback,
  )

  if (!handledSet) failures.push("set: /goal command was not handled")
  if (!session.metaThreadId) failures.push("set: session.metaThreadId was not bound")
  if (messages.some((m) => m.startsWith("goal failed"))) {
    failures.push(`set: goal action failed: ${messages.join(" | ")}`)
  }
  if (!messages.some((m) => m.includes(objective))) {
    failures.push(`set: feedback missing objective: ${messages.join(" | ")}`)
  }

  const manifest = await stackdMetaThread(session.metaThreadId!)
  if (manifest.active_goal?.objective !== objective) {
    failures.push(`manifest objective mismatch: ${manifest.active_goal?.objective}`)
  }

  messages.length = 0
  const handledPause = await runGoalSlashCommand("/goal pause", ctx, state, undefined, undefined, () => undefined, feedback)
  if (!handledPause) failures.push("pause: /goal pause was not handled")
  if (messages.some((m) => m.startsWith("goal failed"))) {
    failures.push(`pause: goal action failed: ${messages.join(" | ")}`)
  }

  const summary = { stamp, meta_thread_id: session.metaThreadId, failures, ok: failures.length === 0 }
  writeFileSync(join(smokeRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n")

  if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exit(1)
  }

  console.log("stack_goal_lazy_bind_ok")
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
