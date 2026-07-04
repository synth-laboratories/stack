import {
  stackdHealthOk,
  stackdUpdateMetaThreadLifecycle,
  type StackdMetaThreadLifecycleStatus,
  type StackdMetaThreadManifest,
} from "./client/stackd.js"

export type GardenerThreadArchiveCandidate = {
  threadId: string
  metaThreadId: string
  label: string
  lifecycle: StackdMetaThreadLifecycleStatus
}

export type GardenerThreadLifecycleResult = {
  ok: boolean
  message: string
  updated: Array<{ threadId: string; metaThreadId: string; status: StackdMetaThreadLifecycleStatus }>
}

export function resolveGardenerArchiveTargets(
  ref: string,
  candidates: readonly GardenerThreadArchiveCandidate[],
  targetThreadId?: string,
): { ok: true; targets: GardenerThreadArchiveCandidate[] } | { ok: false; error: string } {
  const trimmed = ref.trim().toLowerCase()
  if (!trimmed || trimmed === "target") {
    const target = candidates.find((candidate) => candidate.threadId === targetThreadId)
    if (!target) return { ok: false, error: "no worker target to archive — use archive <thread-id-prefix>" }
    return { ok: true, targets: [target] }
  }
  if (trimmed === "filter") {
    return { ok: false, error: "use archive filter from gardener with an active lights thread filter" }
  }

  const needle = ref.trim().toLowerCase()
  const matches = candidates.filter(
    (candidate) =>
      candidate.threadId.toLowerCase() === needle ||
      candidate.threadId.toLowerCase().startsWith(needle) ||
      candidate.metaThreadId.toLowerCase() === needle ||
      candidate.metaThreadId.toLowerCase().startsWith(needle),
  )
  if (matches.length === 0) {
    return { ok: false, error: `no thread matched "${ref.trim()}"` }
  }
  if (matches.length > 1) {
    const options = matches
      .slice(0, 5)
      .map((match) => `${match.threadId.slice(0, 8)} · ${match.label}`)
      .join("; ")
    return { ok: false, error: `ambiguous ref "${ref.trim()}" — ${options}${matches.length > 5 ? "; …" : ""}` }
  }
  return { ok: true, targets: matches }
}

export async function executeGardenerThreadLifecycle(input: {
  mode: "archive" | "revive"
  targets: readonly GardenerThreadArchiveCandidate[]
  reason?: string
  foregroundThreadId?: string
}): Promise<GardenerThreadLifecycleResult> {
  const desired: StackdMetaThreadLifecycleStatus = input.mode === "archive" ? "archived" : "live"
  if (input.targets.length === 0) {
    return { ok: false, message: "no threads to update", updated: [] }
  }
  if (!(await stackdHealthOk())) {
    return { ok: false, message: "archive failed: stackd unavailable", updated: [] }
  }

  const updated: GardenerThreadLifecycleResult["updated"] = []
  const skipped: string[] = []
  const failures: string[] = []

  for (const target of input.targets) {
    if (!target.metaThreadId) {
      skipped.push(`${target.threadId.slice(0, 8)} (no meta-thread)`)
      continue
    }
    if (target.lifecycle === desired) {
      skipped.push(`${target.threadId.slice(0, 8)} (already ${desired})`)
      continue
    }
    try {
      const manifest = await stackdUpdateMetaThreadLifecycle(target.metaThreadId, {
        status: desired,
        reason: input.reason ?? `${desired} via gardener`,
        actor_id: "operator",
      })
      updated.push({
        threadId: target.threadId,
        metaThreadId: manifest.id,
        status: normalizeLifecycle(manifest),
      })
    } catch (error) {
      failures.push(`${target.threadId.slice(0, 8)}: ${lifecycleError(error)}`)
    }
  }

  if (updated.length === 0) {
    const detail = [...failures, ...skipped].join("; ")
    return { ok: false, message: detail ? `${input.mode} failed: ${detail}` : `${input.mode} failed`, updated }
  }

  const lines = updated.map(
    (entry) => `${entry.threadId.slice(0, 8)} → ${entry.status}${entry.threadId === input.foregroundThreadId ? " (foreground)" : ""}`,
  )
  const suffix = [...failures, ...skipped]
  const tail = suffix.length > 0 ? ` · skipped ${suffix.join("; ")}` : ""
  return {
    ok: failures.length === 0,
    message: `${input.mode}d ${updated.length} thread${updated.length === 1 ? "" : "s"}: ${lines.join("; ")}${tail}`,
    updated,
  }
}

function normalizeLifecycle(manifest: StackdMetaThreadManifest): StackdMetaThreadLifecycleStatus {
  return manifest.lifecycle_status === "archived" ? "archived" : "live"
}

function lifecycleError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
