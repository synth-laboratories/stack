#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import {
  enqueueGardenerInbox,
  gardenerThreadDocPath,
  markGardenerInboxRouted,
  readGardenerInbox,
  runGardenerAfterTurn,
} from "../src/gardener.js"
import { readThreadMetaEvents } from "../src/thread-events.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"

const appRoot = resolve(import.meta.dir, "..")
const config = await loadConfig(appRoot)
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const threadId = process.env.STACK_GARDENER_SMOKE_THREAD_ID ?? `gardener-v1-${randomUUID()}`
const proofDir =
  process.env.STACK_GARDENER_PROOF_DIR ?? join(appRoot, ".stack", "evidence", "gardener-v1", stamp)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })

const inboxMessage = "Run the artifacts proof through gardener inbox routing."
const item = enqueueGardenerInbox(config.appRoot, threadId, inboxMessage, { source: "typed" })

const afterQueue = readThreadMetaEvents(config.appRoot, threadId)
const queued = afterQueue.find((event) => event.type === "gardener.queued")
if (!queued) failures.push("missing gardener.queued")
if (queued?.payload.inbox_id !== item.id) failures.push("gardener.queued inbox_id mismatch")
if (readGardenerInbox(config.appRoot, threadId).length !== 1) {
  failures.push("expected 1 pending inbox item after enqueue")
}

const session = mockSession(threadId, config.workspaceRoot)
const turn = mockFailedTurn()
const afterTurn = runGardenerAfterTurn({
  config,
  session: { ...session, turns: [turn] },
  turn,
  workerStatus: "idle",
  goalContext: { objective: "gardener v1 smoke", source: "none" },
  workerQueueCount: 0,
})

const gardenPath = gardenerThreadDocPath(config.appRoot, threadId)
if (!existsSync(gardenPath)) failures.push(`missing garden doc: ${gardenPath}`)
if (!afterTurn.gardenPath) failures.push("runGardenerAfterTurn did not return gardenPath")
if (afterTurn.frictions.length === 0) failures.push("expected friction on failed turn")
if (!afterQueue.concat(readThreadMetaEvents(config.appRoot, threadId)).some((e) => e.type === "gardener.garden_updated")) {
  failures.push("missing gardener.garden_updated")
}
if (!readThreadMetaEvents(config.appRoot, threadId).some((e) => e.type === "gardener.friction")) {
  failures.push("missing gardener.friction")
}

markGardenerInboxRouted(config.appRoot, threadId, item)
const pendingAfterRoute = readGardenerInbox(config.appRoot, threadId)
if (pendingAfterRoute.length !== 0) failures.push("inbox still pending after route")
if (!readThreadMetaEvents(config.appRoot, threadId).some((e) => e.type === "gardener.routed")) {
  failures.push("missing gardener.routed")
}

const summary = {
  ok: failures.length === 0,
  stamp,
  thread_id: threadId,
  inbox_item_id: item.id,
  garden_path: gardenPath,
  frictions: afterTurn.frictions,
  event_log: join(config.appRoot, ".stack", "events", "threads", `${threadId}.jsonl`),
  failures,
}

writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`stack_gardener_v1_failed: ${failures.join("; ")}`)
  process.exit(1)
}

console.log("stack_gardener_v1_ok")
console.log(`thread_id=${threadId}`)
console.log(`proof_dir=${proofDir}`)

function mockSession(id: string, workspaceRoot: string): StackLocalSession {
  return {
    id,
    workspaceRoot,
    startedAt: new Date().toISOString(),
    codexCommand: "codex",
    turns: [],
  }
}

function mockFailedTurn(): StackCodexTurn {
  return {
    id: `turn-${randomUUID()}`,
    prompt: "smoke turn",
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 1,
    stdout: '{"type":"tool_error"}\n{"type":"tool_error"}',
    stderr: "rate limit exceeded",
  }
}
