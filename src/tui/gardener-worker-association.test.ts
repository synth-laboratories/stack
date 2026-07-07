import { expect, test } from "bun:test"
import type { StackdMetaThreadManifest } from "../client/stackd.js"
import type { StackSessionSummary } from "../session.js"
import { associatedGardenerWorkersForEffort } from "./gardener-worker-association.js"

const GARDENER = "gardener-thread"

function summary(id: string): StackSessionSummary {
  return { id } as StackSessionSummary
}

function manifest(overrides: Partial<StackdMetaThreadManifest>): StackdMetaThreadManifest {
  return { id: `manifest-${overrides.gardener_thread_id ?? "x"}`, ...overrides } as StackdMetaThreadManifest
}

function fixture() {
  const workerA = summary("worker-a")
  const workerB = summary("worker-b")
  const summaries = [summary(GARDENER), workerA, workerB]
  const manifestsByThreadId = new Map<string, StackdMetaThreadManifest>([
    ["worker-a", manifest({ id: "m-a", gardener_thread_id: GARDENER, effort_ref: "effort-1", lifecycle_status: "live" })],
    ["worker-b", manifest({ id: "m-b", gardener_thread_id: GARDENER, effort_ref: "effort-2", lifecycle_status: "live" })],
  ])
  return { summaries, manifestsByThreadId }
}

test("effort scope narrows to workers tagged with that effort", () => {
  const { summaries, manifestsByThreadId } = fixture()
  const result = associatedGardenerWorkersForEffort({
    summaries,
    manifestsByThreadId,
    gardenerThreadId: GARDENER,
    activeEffort: { effortId: "effort-1" },
  })
  expect(result.map((w) => w.summary.id)).toEqual(["worker-a"])
})

test("no effort scope shows all live gardener workers", () => {
  const { summaries, manifestsByThreadId } = fixture()
  const result = associatedGardenerWorkersForEffort({
    summaries,
    manifestsByThreadId,
    gardenerThreadId: GARDENER,
  })
  expect(result.map((w) => w.summary.id)).toEqual(["worker-a", "worker-b"])
})

test("unresolved effort id (undefined scope) falls open to all gardener workers, not empty", () => {
  // Regression: a transient efforts-panel read failure leaves effortId unresolved.
  // The caller must pass activeEffort: undefined in that case so the panel shows
  // the gardener's workers rather than silently blanking.
  const { summaries, manifestsByThreadId } = fixture()
  const result = associatedGardenerWorkersForEffort({
    summaries,
    manifestsByThreadId,
    gardenerThreadId: GARDENER,
    activeEffort: undefined,
  })
  expect(result.map((w) => w.summary.id)).toEqual(["worker-a", "worker-b"])
})

test("reverse index picks up workers lacking effort_ref only when no primary match exists", () => {
  const workerC = summary("worker-c")
  const summaries = [summary(GARDENER), workerC]
  const manifestsByThreadId = new Map<string, StackdMetaThreadManifest>([
    ["worker-c", manifest({ id: "m-c", gardener_thread_id: GARDENER, lifecycle_status: "live" })],
  ])
  const result = associatedGardenerWorkersForEffort({
    summaries,
    manifestsByThreadId,
    gardenerThreadId: GARDENER,
    activeEffort: { effortId: "effort-1", metaThreadRefs: ["m-c"] },
  })
  expect(result.map((w) => w.summary.id)).toEqual(["worker-c"])
})

test("archived and foreign-gardener workers are excluded", () => {
  const summaries = [summary(GARDENER), summary("archived"), summary("foreign"), summary("no-manifest")]
  const manifestsByThreadId = new Map<string, StackdMetaThreadManifest>([
    ["archived", manifest({ id: "m-arch", gardener_thread_id: GARDENER, lifecycle_status: "archived" })],
    ["foreign", manifest({ id: "m-for", gardener_thread_id: "other-gardener", lifecycle_status: "live" })],
  ])
  const result = associatedGardenerWorkersForEffort({
    summaries,
    manifestsByThreadId,
    gardenerThreadId: GARDENER,
  })
  expect(result).toEqual([])
})
