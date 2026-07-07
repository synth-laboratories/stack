import type { StackdMetaThreadManifest } from "../client/stackd.js"
import type { StackSessionSummary } from "../session.js"

export type AssociatedGardenerWorker = {
  summary: StackSessionSummary
  manifest: StackdMetaThreadManifest
}

export type ActiveGardenerEffortScope = {
  effortId: string
  metaThreadRefs?: readonly string[]
}

export function associatedGardenerWorkersForEffort(input: {
  summaries: readonly StackSessionSummary[]
  manifestsByThreadId: ReadonlyMap<string, StackdMetaThreadManifest>
  gardenerThreadId: string
  activeEffort?: ActiveGardenerEffortScope
}): AssociatedGardenerWorker[] {
  const primary: AssociatedGardenerWorker[] = []
  const reverseIndexFallback: AssociatedGardenerWorker[] = []

  for (const summary of input.summaries) {
    if (summary.id === input.gardenerThreadId) continue
    const manifest = input.manifestsByThreadId.get(summary.id)
    if (!manifest) continue
    if (manifest.gardener_thread_id !== input.gardenerThreadId) continue
    if ((manifest.lifecycle_status ?? "live") !== "live") continue

    if (input.activeEffort) {
      if (manifest.effort_ref === input.activeEffort.effortId) {
        primary.push({ summary, manifest })
        continue
      }
      if (!manifest.effort_ref && input.activeEffort.metaThreadRefs?.includes(manifest.id)) {
        reverseIndexFallback.push({ summary, manifest })
      }
      continue
    }

    primary.push({ summary, manifest })
  }

  return primary.length > 0 ? primary : reverseIndexFallback
}

export function resolveGardenerWorkerTargetIdFromAssociations(input: {
  workers: readonly AssociatedGardenerWorker[]
  gardenerThreadId: string
  rememberedTargetId?: string
  currentSessionId?: string
}): string {
  if (input.rememberedTargetId) {
    const remembered = input.workers.find((worker) => worker.summary.id === input.rememberedTargetId)
    if (remembered) return remembered.summary.id
  }
  if (input.currentSessionId) {
    const current = input.workers.find((worker) => worker.summary.id === input.currentSessionId)
    if (current) return current.summary.id
  }
  return input.workers[0]?.summary.id ?? input.gardenerThreadId
}

export function resolveAssociatedGardenerWorkerTargetIdFromAssociations(input: {
  workers: readonly AssociatedGardenerWorker[]
  gardenerThreadId: string
  rememberedTargetId?: string
  currentSessionId?: string
}): string | undefined {
  const targetId = resolveGardenerWorkerTargetIdFromAssociations(input)
  return targetId === input.gardenerThreadId ? undefined : targetId
}
