#!/usr/bin/env bun

/**
 * E2E: /goal → /exit prints stack resume + checkpoint; bundle resolves with goal state.
 * TUI `stack resume` reopen is validated via smoke_meta_thread_resume.ts (data path).
 * Paused goals stay in goal mode (isGoalMode includes paused).
 */

import {
  closeStackTuiTerm,
  focusStackAgentInput,
  resolveStackTuiE2eBackend,
  spawnStackTui,
  stackDataRootFromWorkspace,
  submitStackExit,
  waitForResumeCheckpointFile,
  waitForScreenText,
  waitForStackPrompt,
} from "./harness.ts"
import {
  readLatestResumeCheckpoint,
  resumeCheckpointFromCheckpoint,
  resumeCommandFromCheckpoint,
  resolveResumeBundle,
} from "../../src/resume-checkpoint.ts"
import { isGoalMode } from "../../src/tui/goal-mode.js"
import type { StackdMetaThreadManifest } from "../../src/client/stackd.js"

const backend = resolveStackTuiE2eBackend()
const marker = "STACK_TUI_E2E_RESUME_ACTIVE"
const objective = `${marker} active goal resume roundtrip`
const failures: string[] = []

const pausedManifest = {
  id: "mt_paused",
  title: "paused",
  schema: "stack/meta-thread/v1",
  repo_refs: [],
  worktree_refs: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  segments: [],
  head_segment_id: "seg_1",
  head_thread_id: "thread_1",
  artifacts: [],
  handoffs: [],
  decisions: [],
  active_goal: {
    objective: "paused objective",
    status: "paused",
    acceptance_criteria: [],
    blockers: [],
  },
} satisfies StackdMetaThreadManifest

if (!isGoalMode({ goalContext: { status: "active" }, metaThreadManifest: pausedManifest })) {
  failures.push("isGoalMode should include paused goals")
}

let session: Awaited<ReturnType<typeof spawnStackTui>> | undefined

try {
  session = await spawnStackTui({
    backend,
    withStackd: true,
    monitorEnabled: true,
    cols: 160,
    rows: 45,
    keepSmokeDir: true,
  })

  const { term, workspace } = session
  await waitForStackPrompt(term)
  await focusStackAgentInput(term)
  await Bun.sleep(250)

  term.type(`/goal ${objective}`)
  await waitForScreenText(term, marker, 8_000)
  term.press("Enter")
  await waitForScreenText(term, "Goal ·", 20_000)
  await Bun.sleep(1500)

  await submitStackExit(session)

  const stackDataRoot = stackDataRootFromWorkspace(workspace)
  await waitForResumeCheckpointFile(
    stackDataRoot,
    (checkpoint) =>
      Boolean(checkpoint.metaThreadId) &&
      checkpoint.metaThreadState?.goalObjective?.includes(marker),
    20_000,
  )

  const checkpoint = await readLatestResumeCheckpoint(stackDataRoot)
  if (!checkpoint) failures.push("checkpoint missing after /exit")
  const token = checkpoint ? resumeCheckpointFromCheckpoint(checkpoint) : ""
  if (!token) failures.push("resume token empty after /exit")
  if (checkpoint && !resumeCommandFromCheckpoint(checkpoint).includes("stack resume")) {
    failures.push("checkpoint resume command malformed")
  }

  if (session.stackApiUrl) process.env.STACK_API_URL = session.stackApiUrl
  const bundle = await resolveResumeBundle(stackDataRoot, workspace.sessionLogDir, token)
  if (!bundle?.checkpoint.metaThreadId) failures.push("resume bundle missing metaThreadId")
  const bundleObjective =
    bundle?.manifest?.active_goal?.objective ?? bundle?.checkpoint.metaThreadState?.goalObjective
  if (!bundleObjective?.includes(marker)) failures.push("resume bundle missing goal objective")
  if (bundle?.checkpoint.metaThreadState?.phase !== "goal_active") {
    failures.push(`expected goal_active, got ${bundle?.checkpoint.metaThreadState?.phase}`)
  }

  await closeStackTuiTerm(session)

  if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exit(1)
  }

  console.log("stack_tui_e2e_goal_resume_ok")
  console.log(JSON.stringify({ backend, token, smokeDir: session.smokeDir }, null, 2))
} finally {
  if (session) await session.cleanup()
}
