#!/usr/bin/env bun
//
// Deterministic test for the sidecar-thread render. The thread now renders through the SHARED
// worker-chat transcript renderer (blocksFromTurnStdout + renderTranscriptStyledView); this locks
// the monitor-specific CLEANING applied to a turn's JSONL before rendering — the part that keeps
// runtime mechanics and quiet markers out of the worker-grade view.

import { cleanSidecarStdout, goalShutterStreamEvents, goalShutterStreamLines, renderGoalSidecarThreadRich } from "../src/tui/monitor-thread.js"
import type { StackMonitorSidecarTurn } from "../src/monitor-sidecar-codex.js"
import type { StackMonitorSnapshot } from "../src/monitor.js"
import type { StackThreadMetaEvent } from "../src/thread-events.js"
import type { TranscriptRenderOptions } from "../src/tui/transcript.js"

const failures: string[] = []
let checks = 0
function check(cond: boolean, msg: string): void {
  checks += 1
  if (!cond) failures.push(msg)
}

const substantiveStdout = [
  JSON.stringify({ type: "reasoning_summary", text: "Checking the baseline result." }),
  JSON.stringify({ type: "function_call", name: "guidance.search", call_id: "c1", arguments: "{}" }),
  JSON.stringify({ type: "function_call", name: "guidance.search", call_id: "c1", arguments: "{}" }), // bridge dup
  JSON.stringify({ type: "function_call", name: "stack_sidecar_pause_for_restart", call_id: "c2" }),
  JSON.stringify({ type: "function_call", name: "stack_sidecar_pause_for_restart", call_id: "c2" }),
  JSON.stringify({ type: "function_call_output", call_id: "c2", output: "PAUSE_OUTPUT_MARKER ok" }),
  JSON.stringify({ type: "agent_message", text: "PROGRESS_UPDATE: Baseline landed at 0.085 over 100 seeds." }),
].join("\n")

const cleaned = cleanSidecarStdout(substantiveStdout)
check(!cleaned.includes("stack_sidecar_pause_for_restart"), "pause tool call removed")
check(!cleaned.includes("PAUSE_OUTPUT_MARKER"), "pause tool output removed (no orphan block)")
check(!cleaned.includes("PROGRESS_UPDATE:"), "PROGRESS_UPDATE prefix stripped")
check(cleaned.includes("Baseline landed at 0.085 over 100 seeds"), "message text preserved")
check(cleaned.includes("guidance.search"), "real tool call preserved")
check(cleaned.includes("Checking the baseline result"), "reasoning preserved")

const quiet = cleanSidecarStdout(
  [
    JSON.stringify({ type: "function_call", name: "stack_sidecar_pause_for_restart", call_id: "c3" }),
    JSON.stringify({ type: "agent_message", text: "NO_USER_UPDATE" }),
  ].join("\n"),
)
check(!quiet.includes("NO_USER_UPDATE"), "quiet marker removed")
check(!quiet.includes("pause"), "quiet pause removed")
check(quiet.trim() === "", "a fully-quiet wake cleans to nothing")

const steer = cleanSidecarStdout(JSON.stringify({ type: "agent_message", text: "STEER_WORKER: fix the module path" }))
check(steer.includes("steer →") && steer.includes("fix the module path"), "steer prefix rewritten to `steer →`")

// The rich renderer must run over cleaned turns and return a view; a quiet-only turn set yields the
// watching placeholder, not a crash.
const opts: TranscriptRenderOptions = {
  expandedBlockIds: new Set<string>(),
  showDetails: false,
  running: false,
  spinnerFrame: 0,
  agentSpeakerLabel: "monitor",
}
const turn = (stdout: string): StackMonitorSidecarTurn =>
  ({ id: "t", prompt: JSON.stringify({ wake_reason: "tool_completed" }), startedAt: "", finishedAt: "", exitCode: 0, stdout, stderr: "" }) as StackMonitorSidecarTurn

const rich = renderGoalSidecarThreadRich({ turns: [turn(substantiveStdout)], columns: 80, visibleRows: 30, scrollOffset: 0, options: opts })
check(rich != null, "rich render returns a styled view for a substantive turn")
const quietRender = renderGoalSidecarThreadRich({ turns: [turn("{\"type\":\"function_call\",\"name\":\"stack_sidecar_pause_for_restart\",\"call_id\":\"x\"}\n{\"type\":\"agent_message\",\"text\":\"NO_USER_UPDATE\"}")], columns: 80, visibleRows: 30, scrollOffset: 0, options: opts })
check(quietRender != null, "rich render handles a quiet-only turn set without crashing")

const now = new Date().toISOString()
const event = (type: string, payload: Record<string, unknown>): StackThreadMetaEvent =>
  ({
    event_id: `${type}-id`,
    type,
    thread_id: "thread",
    observed_at: now,
    actor_id: type.startsWith("agent.") ? "primary_codex" : "monitor_default",
    actor_role: type.startsWith("agent.") ? "primary" : "monitor",
    payload,
  }) as StackThreadMetaEvent
const feedEvents = [
  event("monitor.wake", { wake_reason: "turn_completed", pending_event_count: 4 }),
  event("monitor.summary", { severity: "none", summary: "NO_USER_UPDATE" }),
  event("monitor.summary", { severity: "none", summary: "A tool completed; monitor checkpoint advanced after reviewing the event delta." }),
  event("monitor.checkpoint", { summary: "checkpoint advanced" }),
  event("monitor.pause_for_restart", { reason: "done" }),
  event("monitor.usage", { input_tokens: 1 }),
  event("agent.tool.completed", { tool_name: "bash", command: "bun test", output: "ok" }),
  event("monitor.progress", { summary: "Baseline pinned at 0.085 over 100 seeds." }),
  event("monitor.steer", { source: "sidecar_codex", message: "Find the real Craftax entrypoint before retrying." }),
]
const snapshot = {
  enabled: true,
  actorId: "monitor_default",
  label: "Monitor",
  runtime: "codex-app-server",
  model: "gpt-5.4-mini",
  reasoningEffort: "medium",
  strictness: "conservative",
  status: "watching",
  lastSeverity: "none",
  wakeCount: 0,
  queuedCount: 0,
  skillReadCount: 0,
  contextPushCount: 0,
  threadSpendUsd: 0,
  focusResults: {},
  modeSource: "config",
} as StackMonitorSnapshot
const humanFeedTypes = goalShutterStreamEvents(feedEvents, false).map((entry) => entry.type)
check(humanFeedTypes.join(",") === "monitor.progress,monitor.steer", `feed filters runtime mechanics, got ${humanFeedTypes.join(",")}`)
const humanFeed = goalShutterStreamLines(feedEvents, snapshot, 100, false).join("\n")
check(humanFeed.includes("Baseline pinned at 0.085"), "feed shows progress")
check(humanFeed.includes("Find the real Craftax entrypoint"), "feed shows steer")
check(!humanFeed.includes("NO_USER_UPDATE"), "feed hides quiet marker")
check(!humanFeed.includes("checkpoint"), "feed hides checkpoint/runtime filler")
check(!humanFeed.includes("bun test"), "feed hides raw agent tool rows")
const agentTapeTypes = goalShutterStreamEvents(feedEvents, true).map((entry) => entry.type)
check(agentTapeTypes.includes("monitor.wake") && agentTapeTypes.includes("agent.tool.completed"), "agent tape retains raw runtime/agent rows")

if (failures.length > 0) {
  console.error(`SIDECAR RENDER FAILURES (${failures.length}/${checks}):\n` + failures.map((f) => `  - ${f}`).join("\n"))
  console.error("\n--- cleaned ---\n" + cleaned)
  process.exit(1)
}
console.log(`stack_sidecar_render_ok (${checks} checks)`)
