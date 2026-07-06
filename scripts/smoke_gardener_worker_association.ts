#!/usr/bin/env bun

import type { StackdMetaThreadManifest } from "../src/client/stackd.ts"
import type { StackSessionSummary } from "../src/session.ts"
import {
  associatedGardenerWorkersForEffort,
  resolveAssociatedGardenerWorkerTargetIdFromAssociations,
  resolveGardenerWorkerTargetIdFromAssociations,
} from "../src/tui/gardener-worker-association.ts"

const failures: string[] = []

function assert(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

function summary(id: string, metaThreadId = `meta-${id}`): StackSessionSummary {
  return {
    id,
    path: `/tmp/${id}.json`,
    startedAt: "2026-07-06T00:00:00Z",
    updatedAt: "2026-07-06T00:00:00Z",
    turnCount: 0,
    metaThreadId,
  }
}

function manifest(input: {
  id: string
  threadId: string
  gardenerThreadId?: string
  effortRef?: string
  lifecycle?: "live" | "archived"
}): StackdMetaThreadManifest {
  return {
    schema: "stack/meta-thread/v1",
    id: input.id,
    title: input.id,
    lifecycle_status: input.lifecycle,
    source: "smoke",
    effort_ref: input.effortRef,
    repo_refs: [],
    worktree_refs: [],
    created_at: "2026-07-06T00:00:00Z",
    updated_at: "2026-07-06T00:00:00Z",
    segments: [],
    head_segment_id: `seg-${input.threadId}`,
    head_thread_id: input.threadId,
    artifacts: [],
    handoffs: [],
    decisions: [],
    gardener_thread_id: input.gardenerThreadId,
  }
}

function ids(workers: ReturnType<typeof associatedGardenerWorkersForEffort>): string[] {
  return workers.map((worker) => worker.summary.id)
}

function assertIds(actual: string[], expected: string[], message: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

const gardenerA = summary("gardener-a", "meta-gardener-a")
const gardenerB = summary("gardener-b", "meta-gardener-b")
const workerA1 = summary("worker-a1", "meta-worker-a1")
const workerA2 = summary("worker-a2", "meta-worker-a2")
const workerB1 = summary("worker-b1", "meta-worker-b1")
const legacyA = summary("legacy-a", "meta-legacy-a")
const archivedA = summary("archived-a", "meta-archived-a")
const fallbackA = summary("fallback-a", "meta-fallback-a")

const summaries = [gardenerA, workerA1, workerB1, legacyA, archivedA, fallbackA, workerA2, gardenerB]
const manifestsByThreadId = new Map<string, StackdMetaThreadManifest>([
  [workerA1.id, manifest({ id: "meta-worker-a1", threadId: workerA1.id, gardenerThreadId: gardenerA.id, effortRef: "effort-a" })],
  [workerA2.id, manifest({ id: "meta-worker-a2", threadId: workerA2.id, gardenerThreadId: gardenerA.id, effortRef: "effort-a" })],
  [workerB1.id, manifest({ id: "meta-worker-b1", threadId: workerB1.id, gardenerThreadId: gardenerB.id, effortRef: "effort-b" })],
  [legacyA.id, manifest({ id: "meta-legacy-a", threadId: legacyA.id, effortRef: "effort-a" })],
  [archivedA.id, manifest({ id: "meta-archived-a", threadId: archivedA.id, gardenerThreadId: gardenerA.id, effortRef: "effort-a", lifecycle: "archived" })],
  [fallbackA.id, manifest({ id: "meta-fallback-a", threadId: fallbackA.id, gardenerThreadId: gardenerA.id })],
])

const scopedA = associatedGardenerWorkersForEffort({
  summaries,
  manifestsByThreadId,
  gardenerThreadId: gardenerA.id,
  activeEffort: { effortId: "effort-a", metaThreadRefs: ["meta-fallback-a"] },
})
assertIds(ids(scopedA), ["worker-a1", "worker-a2"], "active effort must use strict effort_ref matches when available")

const scopedBFromGardenerA = associatedGardenerWorkersForEffort({
  summaries,
  manifestsByThreadId,
  gardenerThreadId: gardenerA.id,
  activeEffort: { effortId: "effort-b" },
})
assertIds(ids(scopedBFromGardenerA), [], "gardener A must not see gardener B worker")

const unscopedA = associatedGardenerWorkersForEffort({
  summaries,
  manifestsByThreadId,
  gardenerThreadId: gardenerA.id,
})
assertIds(ids(unscopedA), ["worker-a1", "fallback-a", "worker-a2"], "unscoped gardener must see only live workers tied to that gardener")

const fallbackOnly = associatedGardenerWorkersForEffort({
  summaries: [gardenerA, fallbackA, legacyA],
  manifestsByThreadId,
  gardenerThreadId: gardenerA.id,
  activeEffort: { effortId: "effort-a", metaThreadRefs: ["meta-fallback-a"] },
})
assertIds(ids(fallbackOnly), ["fallback-a"], "reverse index fallback must work only when no strict effort_ref worker exists")

const missingEffortRecord = associatedGardenerWorkersForEffort({
  summaries,
  manifestsByThreadId,
  gardenerThreadId: gardenerA.id,
  activeEffort: { metaThreadRefs: ["meta-worker-a1"] },
})
assertIds(ids(missingEffortRecord), [], "missing active effort id must fail closed")

assert(
  resolveGardenerWorkerTargetIdFromAssociations({
    workers: scopedA,
    gardenerThreadId: gardenerA.id,
    rememberedTargetId: workerA2.id,
    currentSessionId: workerA1.id,
  }) === workerA2.id,
  "remembered associated worker should win",
)
assert(
  resolveGardenerWorkerTargetIdFromAssociations({
    workers: scopedA,
    gardenerThreadId: gardenerA.id,
    rememberedTargetId: workerB1.id,
    currentSessionId: workerA1.id,
  }) === workerA1.id,
  "stale remembered worker must be ignored in favor of current associated worker",
)
assert(
  resolveGardenerWorkerTargetIdFromAssociations({
    workers: scopedA,
    gardenerThreadId: gardenerA.id,
    currentSessionId: legacyA.id,
  }) === workerA1.id,
  "unassociated current session must not become the target",
)
assert(
  resolveGardenerWorkerTargetIdFromAssociations({
    workers: [],
    gardenerThreadId: gardenerA.id,
    rememberedTargetId: workerA1.id,
    currentSessionId: workerA1.id,
  }) === gardenerA.id,
  "no associated worker should resolve to gardener sentinel",
)
assert(
  resolveAssociatedGardenerWorkerTargetIdFromAssociations({
    workers: [],
    gardenerThreadId: gardenerA.id,
  }) === undefined,
  "associated target should be undefined when no associated worker exists",
)

if (failures.length > 0) {
  console.error(`gardener_worker_association_smoke_failed: ${failures.join("; ")}`)
  process.exit(1)
}

console.log("gardener_worker_association_smoke_ok")
