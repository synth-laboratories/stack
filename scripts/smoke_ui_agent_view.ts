#!/usr/bin/env bun
// AT-STACK-AGENT-VIEW-001 — `a` toggles curated (human) vs agent event stream.
// Pure data-contract smoke over curatedWorkerStreamEvents + coreEventStreamLineCount.

import {
  coreEventStreamLineCount,
  curatedWorkerStreamEvents,
} from "../src/tui/center-panel.ts"
import { monitorThreadEvents } from "../src/tui/monitor-thread.ts"
import type { StackThreadMetaEvent } from "../src/thread-events.ts"

const fail = (msg: string, detail?: unknown): never => {
  console.error(`stack_ui_agent_view FAIL: ${msg}`, detail ?? "")
  process.exit(1)
}

const ev = (
  type: string,
  i: number,
  payload: Record<string, unknown> = {},
): StackThreadMetaEvent => ({
  event_id: `ev_${i}`,
  type,
  thread_id: "th_smoke",
  observed_at: `2026-06-30T04:00:0${i}Z`,
  payload,
})

// Mixed worker tape: curated-worthy events interleaved with raw agent.tool.* noise.
const workerEvents: StackThreadMetaEvent[] = [
  ev("agent.tool.started", 0),
  ev("monitor.summary", 1),
  ev("agent.tool.completed", 2),
  ev("handoff.sealed", 3),
  ev("agent.tool.started", 4),
  ev("meta_thread.goal_updated", 5),
  ev("agent.tool.failed", 6),
  ev("thread.named", 7, { named_by: "monitor" }),
  ev("agent.tool.completed", 8),
]
const gardenerEvents: StackThreadMetaEvent[] = []
const columns = 80

// 1. Curated (Agent view off): drop raw agent.tool.started/completed noise.
const curated = curatedWorkerStreamEvents(workerEvents)
const curatedTypes = curated.map((e) => e.type)
for (const noisy of ["agent.tool.started", "agent.tool.completed"]) {
  if (curatedTypes.includes(noisy)) fail(`curated view should hide ${noisy}`, curatedTypes)
}

// 2. Curated keeps monitor/handoff/meta/failure/named events.
for (const kept of [
  "monitor.summary",
  "handoff.sealed",
  "meta_thread.goal_updated",
  "agent.tool.failed",
  "thread.named",
]) {
  if (!curatedTypes.includes(kept)) fail(`curated view should keep ${kept}`, curatedTypes)
}

// 3. Curated is strictly fewer events than the full tape.
if (curated.length >= workerEvents.length) {
  fail("curated view should drop at least one event", {
    curated: curated.length,
    full: workerEvents.length,
  })
}

// 4. Agent view reveals the raw agent.* tape that curated hides (the toggle's point).
const agentTape = monitorThreadEvents(workerEvents)
const agentTypes = agentTape.map((e) => e.type)
for (const raw of ["agent.tool.started", "agent.tool.completed"]) {
  if (!agentTypes.includes(raw)) fail(`agent view should reveal ${raw}`, agentTypes)
  if (curatedTypes.includes(raw)) fail(`curated view should still hide ${raw}`, curatedTypes)
}

// 5. Agent view (on) renders more lines than curated (off) — the toggle has effect.
const offLines = coreEventStreamLineCount("worker", gardenerEvents, workerEvents, columns, false)
const onLines = coreEventStreamLineCount("worker", gardenerEvents, workerEvents, columns, true)
if (!(onLines > offLines)) {
  fail("agent view should render more lines than curated view", { offLines, onLines })
}

const summary = {
  ok: true,
  full_event_count: workerEvents.length,
  curated_event_count: curated.length,
  curated_types: curatedTypes,
  agent_view_event_count: agentTape.length,
  agent_reveals_raw_tools: true,
  off_line_count: offLines,
  on_line_count: onLines,
}
console.log("stack_ui_agent_view_ok")
console.log(JSON.stringify(summary, null, 2))
