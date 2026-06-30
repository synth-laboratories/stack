#!/usr/bin/env bun

/**
 * Goal-first E2E proof: isolated stackd + meta-thread goal + handoff seal/continue +
 * progress-narrator monitor + human-view event filter assertions.
 * Writes proof packet to .stack/evidence/goal-first-e2e/<stamp>/
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import {
  stackdApproveMetaThreadArtifact,
  stackdContinueMetaThread,
  stackdCreateMetaThread,
  stackdMetaThread,
  stackdSealMetaThreadSegment,
  stackdUpdateMetaThreadGoal,
} from "../src/client/stackd.js"
import { loadConfig } from "../src/config.js"
import { runMonitorAfterTurn, runMonitorForNewEvents } from "../src/monitor.js"
import { mergeMetaThreadGoalContext, readMetaThreadManifest } from "../src/meta-thread-goal.js"
import { appendThreadMetaEvent, readThreadMetaEvents, stackEventId } from "../src/thread-events.js"
import { curatedWorkerStreamEvents } from "../src/tui/center-panel.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "goal-first-e2e", stamp)
const stackRoot = join(proofDir, "stack-root")
const sessionLogDir = join(stackRoot, ".stack", "sessions")
const port = 18900 + Math.floor(Math.random() * 100)
const baseUrl = `http://127.0.0.1:${port}`
const failures: string[] = []
const checks: Record<string, boolean | string | number> = {}

mkdirSync(sessionLogDir, { recursive: true })

const parentThreadId = `thread_${randomUUID()}`
const workspaceRoot = resolve(appRoot, "..")
const objective =
  "Rebuild TicTacToe Harbor env; pass 20-scenario spectrum (harbor_reward=1.0)"

const parentSession: StackLocalSession = {
  id: parentThreadId,
  workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [],
}

writeFileSync(join(sessionLogDir, `${parentThreadId}.json`), JSON.stringify(parentSession, null, 2) + "\n")

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
  process.env.STACK_MONITOR_PROFILE = "progress-narrator"
  process.env.STACK_CODEX_COMMAND = join(appRoot, "scripts/fake_codex_jsonl.ts")
  delete process.env.STACK_CODEX_ARGS

  await waitForHealth(`${baseUrl}/health`)
  checks.stackd_health = true

  const created = await stackdCreateMetaThread({
    title: "Harbor env rebuild E2E proof",
    thread_id: parentThreadId,
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

  checks.meta_thread_created = Boolean(created.id)
  checks.active_goal_on_create = created.active_goal?.objective === objective

  await stackdUpdateMetaThreadGoal(created.id, {
    blockers: ["ImportError: missing gold.board module"],
  })

  const manifestAfterPatch = await readMetaThreadManifest(join(stackRoot, ".stack"), created.id)
  checks.read_manifest_disk = manifestAfterPatch?.active_goal?.blockers?.length === 1

  const boundSession: StackLocalSession = {
    ...parentSession,
    metaThreadId: created.id,
    segmentId: created.head_segment_id,
    segmentRole: "implement",
  }

  const turn: StackCodexTurn = {
    id: `turn-${randomUUID()}`,
    prompt: "Scaffold candidate/scripts/run_service.py for Harbor gold env",
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout: "Created run_service.py; gold.board import still missing.",
    stderr: "",
  }

  const config = await loadConfig(appRoot)
  const eventRoot = config.appRoot
  const goalContext = mergeMetaThreadGoalContext({ source: "none" }, manifestAfterPatch)
  checks.merge_goal_context = goalContext.objective === objective

  await runMonitorAfterTurn({
    config,
    session: { ...boundSession, turns: [turn] },
    turn,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
    goalContext,
  })

  appendThreadMetaEvent(eventRoot, {
    event_id: stackEventId("agent_tool_failed"),
    type: "agent.tool.failed",
    thread_id: parentThreadId,
    observed_at: new Date().toISOString(),
    actor_id: "primary_codex",
    actor_role: "primary",
    payload: {
      tool_name: "bash",
      command: "python3 -m pytest workspace/candidate/tests",
      message: "ImportError: missing gold.board module",
    },
  })

  await runMonitorForNewEvents({
    config,
    session: boundSession,
    turn,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
    goalContext,
    wakeReason: "tool_failed",
    triggerEventIds: [readThreadMetaEvents(eventRoot, parentThreadId).at(-1)!.event_id],
  })

  const threadEvents = readThreadMetaEvents(eventRoot, parentThreadId)
  const summaries = threadEvents.filter((event) => event.type === "monitor.summary")
  const steers = threadEvents.filter((event) => event.type === "monitor.steer")
  const latestSummary = summaries.at(-1)
  const operatorUpdate = latestSummary?.payload.operator_update as Record<string, unknown> | undefined

  checks.monitor_summary_count = summaries.length
  checks.monitor_no_steer = steers.length === 0
  checks.operator_update_working_on = readString(operatorUpdate?.working_on)?.includes("Harbor") ?? false
  checks.operator_update_struggling = Boolean(readString(operatorUpdate?.struggling_with))
  checks.goal_progress_pass =
    (latestSummary?.payload.focus_results as Record<string, unknown> | undefined)?.goal_progress === "pass"

  const agentToolStarted = threadEvents.filter((event) => event.type === "agent.tool.started").length
  const humanViewCount = curatedWorkerStreamEvents(threadEvents).length
  checks.agent_events_total = threadEvents.length
  checks.human_view_filters_tools =
    humanViewCount < threadEvents.length || agentToolStarted === 0

  const artifact = await stackdSealMetaThreadSegment(created.id, created.head_segment_id, {
    summary: "Scaffolded Harbor candidate; blocked on gold.board",
    successor_role: "verify",
    recommended_next_action: "continue_verify",
  })

  const artifactBody = readFileSync(join(stackRoot, artifact.path), "utf8")
  checks.handoff_goal_progress = artifactBody.includes("## Goal progress")
  checks.handoff_has_blocker = artifactBody.includes("ImportError: missing gold.board module")

  await stackdApproveMetaThreadArtifact(created.id, artifact.id, { thread_id: parentThreadId })

  const continued = await stackdContinueMetaThread(created.id, {
    role: "verify",
    model: "gpt-5.4-mini",
    reasoning_effort: "medium",
    harness: "codex",
    harness_command: "codex",
    workspace_root: workspaceRoot,
    artifact_ids: [artifact.id],
  })

  checks.handoff_continue_child_thread = continued.session.id !== parentThreadId
  checks.successor_prompt_has_goal = continued.prompt.includes(objective)
  checks.successor_prompt_artifact_only =
    continued.prompt.includes("artifact payloads only") && !continued.prompt.includes("stdout replay")

  const metaEventsPath = join(
    stackRoot,
    ".stack",
    "meta-threads",
    created.id,
    "events.jsonl",
  )
  const metaEventsText = readFileSync(metaEventsPath, "utf8")
  checks.meta_events_goal_updated = metaEventsText.includes("meta_thread.goal_updated")
  checks.meta_events_handoff_created = metaEventsText.includes("handoff.created")
  checks.meta_events_segment_started = metaEventsText.includes("meta_thread.segment_started")

  for (const [key, value] of Object.entries(checks)) {
    if (value === false || value === 0 && key.includes("pass")) {
      failures.push(`check failed: ${key}=${String(value)}`)
    }
  }
  if (typeof checks.monitor_summary_count === "number" && checks.monitor_summary_count < 2) {
    failures.push(`expected >=2 monitor.summary, got ${checks.monitor_summary_count}`)
  }
  if (!checks.handoff_continue_child_thread) failures.push("continue did not spawn child thread")
  if (!checks.successor_prompt_has_goal) failures.push("successor prompt missing active_goal objective")

  const proof = {
    stamp,
    ok: failures.length === 0,
    failures,
    checks,
    ids: {
      meta_thread_id: created.id,
      parent_thread_id: parentThreadId,
      child_thread_id: continued.session.id,
      parent_segment_id: created.head_segment_id,
      child_segment_id: continued.manifest.head_segment_id,
      handoff_id: continued.handoff.id,
      artifact_id: artifact.id,
    },
    operator_update: operatorUpdate,
    latest_monitor_summary: readString(latestSummary?.payload.summary),
    human_view_event_count: humanViewCount,
    agent_view_event_count: threadEvents.length,
    proof_dir: proofDir,
    stack_api_url: baseUrl,
  }

  writeFileSync(join(proofDir, "proof.json"), JSON.stringify(proof, null, 2) + "\n")
  writeFileSync(join(proofDir, "handoff-artifact.md"), artifactBody)

  if (failures.length > 0) {
    console.error("goal_first_e2e_failed")
    console.error(failures.join("\n"))
    console.error(JSON.stringify(proof, null, 2))
    process.exit(1)
  }

  console.log("goal_first_e2e_ok")
  console.log(JSON.stringify(proof, null, 2))
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
