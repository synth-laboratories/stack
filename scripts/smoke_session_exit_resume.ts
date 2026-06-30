#!/usr/bin/env bun
/**
 * Exit/resume round-trip: everything a session needs to come back correctly
 * after the app is closed and reopened — turns, display name, and (if a goal
 * was active) the meta-thread binding plus its goal state on the backend.
 * Models a real session lifecycle: write while "running" -> drop the
 * in-memory object ("exit") -> re-read from disk only ("resume").
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import {
  ensureSessionInHistory,
  listSessionHistory,
  readSessionLog,
  writeSessionLog,
  type StackCodexTurn,
  type StackLocalSession,
} from "../src/session.ts"
import { stackdCreateMetaThread, stackdMetaThread, stackdUpdateMetaThreadGoal } from "../src/client/stackd.ts"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const smokeRoot = join(appRoot, ".stack", "evidence", "session-exit-resume", stamp)
const stackRoot = join(smokeRoot, "stack-root")
const sessionLogDir = join(stackRoot, ".stack", "sessions")
const port = 19500 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const failures: string[] = []

function check(label: string, condition: boolean): void {
  if (!condition) failures.push(label)
}

mkdirSync(sessionLogDir, { recursive: true })

const threadId = randomUUID()
const workspaceRoot = resolve(appRoot, "..")
const objective = "Exit/resume smoke: verify session and goal state survive a restart"

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

  // --- Part 1: a plain session (no goal) survives exit -> resume ---------

  const turnOne: StackCodexTurn = {
    id: `turn-${randomUUID()}`,
    prompt: "scaffold the candidate service",
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout: "Created candidate/scripts/run_service.py",
    stderr: "",
  }

  const live: StackLocalSession = {
    id: threadId,
    workspaceRoot,
    startedAt: new Date().toISOString(),
    codexCommand: "codex",
    codexModel: "gpt-5.4-mini",
    harness: "codex",
    displayName: "Candidate service scaffold",
    turns: [turnOne],
  }

  await writeSessionLog(live, sessionLogDir, { codexModel: "gpt-5.4-mini" })

  // "exit": nothing more happens to `live` — only what's on disk counts from here.

  // "resume": a fresh read, as if the process had just (re)started.
  const resumedPath = join(sessionLogDir, `${threadId}.json`)
  const resumed = await readSessionLog(resumedPath)

  check("resumed id matches", resumed.id === threadId)
  check("resumed displayName matches", resumed.displayName === live.displayName)
  check("resumed turn count matches", resumed.turns.length === 1)
  check("resumed turn prompt matches", resumed.turns[0]?.prompt === turnOne.prompt)
  check("resumed turn stdout matches", resumed.turns[0]?.stdout === turnOne.stdout)
  check("resumed session has no metaThreadId yet", resumed.metaThreadId === undefined)

  const historyAfterResume = await listSessionHistory(sessionLogDir)
  const resumedSummary = historyAfterResume.find((entry) => entry.id === threadId)
  check("resumed thread appears in history", Boolean(resumedSummary))
  check("history lastPrompt matches latest turn", resumedSummary?.lastPrompt === turnOne.prompt)
  check("history turnCount matches", resumedSummary?.turnCount === 1)

  // Continuing the resumed session (a second turn) must append, not clobber.
  const turnTwo: StackCodexTurn = {
    id: `turn-${randomUUID()}`,
    prompt: "run the spectrum and report the score",
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout: "harbor_reward=1.0 across 20 scenarios",
    stderr: "",
  }
  resumed.turns.push(turnTwo)
  await writeSessionLog(resumed, sessionLogDir, { codexModel: "gpt-5.4-mini" })
  const resumedAgain = await readSessionLog(resumedPath)
  check("second turn persisted after resume", resumedAgain.turns.length === 2)
  check("first turn still intact after second write", resumedAgain.turns[0]?.prompt === turnOne.prompt)

  // --- Part 2: an active goal's meta-thread binding survives exit -> resume ---

  const created = await stackdCreateMetaThread({
    title: objective,
    thread_id: threadId,
    role: "implement",
    model: "gpt-5.4-mini",
    reasoning_effort: "medium",
    harness: "codex",
    active_goal: { objective, status: "active", acceptance_criteria: ["[ ] spectrum passes"], blockers: [] },
  })
  resumedAgain.metaThreadId = created.id
  resumedAgain.segmentId = created.head_segment_id
  resumedAgain.segmentRole = "implement"
  await writeSessionLog(resumedAgain, sessionLogDir, { codexModel: "gpt-5.4-mini" })

  await stackdUpdateMetaThreadGoal(created.id, { blockers: ["waiting on gold.board import"] })

  // "exit" again — drop everything in memory.
  // "resume" again — re-read from disk only, then re-fetch the goal from the backend
  // the same way the goal panel does on open, simulating a real app restart.
  const resumedWithGoal = await readSessionLog(resumedPath)
  check("metaThreadId survives exit/resume", resumedWithGoal.metaThreadId === created.id)
  check("segmentId survives exit/resume", resumedWithGoal.segmentId === created.head_segment_id)
  check("segmentRole survives exit/resume", resumedWithGoal.segmentRole === "implement")

  const manifestAfterResume = await stackdMetaThread(resumedWithGoal.metaThreadId!)
  check("goal objective survives exit/resume", manifestAfterResume.active_goal?.objective === objective)
  check("goal status survives exit/resume", manifestAfterResume.active_goal?.status === "active")
  check(
    "goal blocker set before exit survives resume",
    Boolean(manifestAfterResume.active_goal?.blockers?.includes("waiting on gold.board import")),
  )

  const historyWithGoal = ensureSessionInHistory(historyAfterResume, resumedWithGoal, sessionLogDir, "gpt-5.4-mini")
  const summaryWithGoal = historyWithGoal.find((entry) => entry.id === threadId)
  check("resumed history entry carries metaThreadId", summaryWithGoal?.metaThreadId === created.id)

  const summary = {
    stamp,
    thread_id: threadId,
    meta_thread_id: resumedWithGoal.metaThreadId,
    failures,
    ok: failures.length === 0,
  }
  writeFileSync(join(smokeRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n")

  if (failures.length > 0) {
    console.error("smoke_session_exit_resume_failed")
    console.error(failures.join("\n"))
    console.error(JSON.stringify(summary, null, 2))
    process.exit(1)
  }

  console.log("smoke_session_exit_resume_ok")
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
