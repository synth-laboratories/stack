// P2 — headless monitor pass runner. The stackd scheduler only QUEUES triggers; the actual LLM pass
// has run TUI-side. This drives the monitor pass loop with no TUI attached: poll a thread's event
// log, run a pass whenever there is new worker activity or a queued trigger, and stop at a terminal
// goal state / budget. Dependencies are injected so the loop is unit-testable without codex.

import type { StackThreadMetaEvent } from "./thread-events.js"

export type MonitorPassFn = (triggerEventIds: string[], reason: string) => Promise<void>
export type ReadEventsFn = () => StackThreadMetaEvent[] | Promise<StackThreadMetaEvent[]>

export type HeadlessMonitorLoopInput = {
  readEvents: ReadEventsFn
  runPass: MonitorPassFn
  isTerminal: (events: StackThreadMetaEvent[]) => boolean
  pollMs?: number
  maxPasses?: number
  maxSeconds?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export type HeadlessMonitorLoopResult = {
  passes: number
  terminal: boolean
  reason: "terminal" | "max_passes" | "max_seconds"
}

// A worker event or a queued trigger is a reason to wake; the monitor's own events are not.
function wakeTriggers(events: StackThreadMetaEvent[], cursor: string | undefined): StackThreadMetaEvent[] {
  const startIdx = cursor ? events.findIndex((e) => e.event_id === cursor) + 1 : 0
  return events
    .slice(startIdx)
    .filter((e) => e.type.startsWith("agent.") || e.type === "monitor.trigger_queued")
}

export async function runHeadlessMonitorLoop(input: HeadlessMonitorLoopInput): Promise<HeadlessMonitorLoopResult> {
  const pollMs = input.pollMs ?? 2000
  const maxPasses = input.maxPasses ?? 200
  const maxSeconds = input.maxSeconds ?? 3600
  const now = input.now ?? (() => performance.now())
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const startedAt = now()
  let passes = 0
  let cursor: string | undefined

  while (true) {
    const events = await input.readEvents()
    if (input.isTerminal(events)) return { passes, terminal: true, reason: "terminal" }
    if (passes >= maxPasses) return { passes, terminal: false, reason: "max_passes" }
    if ((now() - startedAt) / 1000 >= maxSeconds) return { passes, terminal: false, reason: "max_seconds" }

    const triggers = wakeTriggers(events, cursor)
    if (triggers.length > 0) {
      const reason = triggers.some((e) => e.type === "agent.tool.failed" || e.type === "agent.error")
        ? "tool_failed"
        : triggers.some((e) => e.type === "agent.turn.completed")
          ? "turn_completed"
          : "event_batch"
      // Advance the cursor only past events we had SEEN before this pass — worker events that arrive
      // during the pass stay ahead of the cursor and wake us next iteration (don't skip them).
      cursor = events.at(-1)?.event_id ?? cursor
      await input.runPass(triggers.map((e) => e.event_id), reason)
      passes += 1
    } else {
      await sleep(pollMs)
    }
  }
}
