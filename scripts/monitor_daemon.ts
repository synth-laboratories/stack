#!/usr/bin/env bun
//
// Headless monitor daemon — drives the monitor pass loop for a thread with NO TUI attached (P2:
// "server-side pass runner"). Polls the thread's event log; each time new worker activity / a queued
// trigger appears, it runs a real monitor pass; stops when the goal reaches a terminal state.
//
// Usage:  bun run scripts/monitor_daemon.ts <threadId> "<objective>" [maxSeconds]

import { resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runMonitorForNewEvents } from "../src/monitor.js"
import { readThreadMetaEvents } from "../src/thread-events.js"
import { reduceGoalSessionSnapshot } from "../src/goal-session.js"
import { runHeadlessMonitorLoop } from "../src/monitor-daemon.js"
import type { StackLocalSession } from "../src/session.js"

const [threadId, objective, maxSecondsArg] = process.argv.slice(2)
if (!threadId || !objective) {
  console.error('usage: bun run scripts/monitor_daemon.ts <threadId> "<objective>" [maxSeconds]')
  process.exit(2)
}

const appRoot = resolve(import.meta.dir, "..")
const workspaceRoot = "/Users/joshpurtell/Documents/GitHub"
const config = { ...(await loadConfig(appRoot)), workspaceRoot }
const goalContext = { objective, status: "active" as const, source: "context" as const }
const session: StackLocalSession = { id: threadId, workspaceRoot, startedAt: new Date().toISOString(), codexCommand: "codex", turns: [] }
const agentContext = { usedSkills: [], loadedSkills: [], cwd: workspaceRoot }

const result = await runHeadlessMonitorLoop({
  readEvents: () => readThreadMetaEvents(config.stackDataRoot, threadId),
  runPass: async (triggerEventIds, wakeReason) => {
    await runMonitorForNewEvents({ config, session, agentContext, goalContext, wakeReason, triggerEventIds }).catch(() => {})
  },
  isTerminal: (events) => {
    const status = reduceGoalSessionSnapshot({
      events,
      goal: { objective, status: "active", acceptanceCriteria: [] },
      metaThreadId: undefined,
      monitorThreadSpendUsd: 0,
    })?.status
    return status === "done" || status === "cleared"
  },
  pollMs: 3000,
  maxSeconds: maxSecondsArg ? Number(maxSecondsArg) : 1800,
})

console.log(JSON.stringify({ threadId, ...result }, null, 2))
