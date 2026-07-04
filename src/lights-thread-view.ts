import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { StackSessionSummary } from "./session.js"

export type LightsThreadViewState = {
  viewedThreadIds: string[]
  selectedThreadId?: string
}

export function lightsThreadViewStatePath(stackRoot: string): string {
  return join(stackRoot, ".stack", "config", "lights-thread-view.json")
}

export function lightsThreadViewDiskUpdatedAtMs(stackRoot: string): number | undefined {
  const path = lightsThreadViewStatePath(stackRoot)
  if (!existsSync(path)) return undefined
  try {
    return statSync(path).mtimeMs
  } catch {
    return undefined
  }
}

export function readLightsThreadViewState(stackRoot: string): LightsThreadViewState {
  const path = lightsThreadViewStatePath(stackRoot)
  if (!existsSync(path)) return { viewedThreadIds: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      viewedThreadIds?: unknown
      selectedThreadId?: unknown
    }
    const ids = Array.isArray(parsed.viewedThreadIds)
      ? parsed.viewedThreadIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : []
    const selectedThreadId =
      typeof parsed.selectedThreadId === "string" && parsed.selectedThreadId.trim().length > 0
        ? parsed.selectedThreadId.trim()
        : undefined
    return { viewedThreadIds: [...new Set(ids)], selectedThreadId }
  } catch {
    return { viewedThreadIds: [] }
  }
}

export function writeLightsThreadViewState(stackRoot: string, state: LightsThreadViewState): void {
  const path = lightsThreadViewStatePath(stackRoot)
  mkdirSync(dirname(path), { recursive: true })
  const viewedThreadIds = [...new Set(state.viewedThreadIds.filter((id) => id.trim().length > 0))]
  const payload: LightsThreadViewState = { viewedThreadIds }
  if (state.selectedThreadId?.trim()) payload.selectedThreadId = state.selectedThreadId.trim()
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

export function applyLightsThreadViewUpdate(
  stackRoot: string,
  current: LightsThreadViewState,
  threadIds: readonly string[],
  viewed: boolean,
): LightsThreadViewState {
  const viewedSet = new Set(current.viewedThreadIds)
  for (const id of threadIds) {
    if (viewed) viewedSet.add(id)
    else viewedSet.delete(id)
  }
  let selectedThreadId = current.selectedThreadId
  if (viewed) {
    selectedThreadId = threadIds[threadIds.length - 1]
  } else if (selectedThreadId && threadIds.includes(selectedThreadId)) {
    selectedThreadId = undefined
  }
  const next = { viewedThreadIds: [...viewedSet], selectedThreadId }
  writeLightsThreadViewState(stackRoot, next)
  return next
}

export function markLightsThreadsViewed(stackRoot: string, current: Set<string>, threadIds: readonly string[]): Set<string> {
  const disk = readLightsThreadViewState(stackRoot)
  const next = applyLightsThreadViewUpdate(
    stackRoot,
    { viewedThreadIds: [...current], selectedThreadId: disk.selectedThreadId },
    threadIds,
    true,
  )
  return new Set(next.viewedThreadIds)
}

export function markLightsThreadsUnviewed(
  stackRoot: string,
  current: Set<string>,
  threadIds: readonly string[],
): Set<string> {
  const disk = readLightsThreadViewState(stackRoot)
  const next = applyLightsThreadViewUpdate(
    stackRoot,
    { viewedThreadIds: [...current], selectedThreadId: disk.selectedThreadId },
    threadIds,
    false,
  )
  return new Set(next.viewedThreadIds)
}

export function resolveLightsThreadViewTargets(input: {
  body: string
  history: readonly StackSessionSummary[]
  gardenerThreadId: string
  workerTargetId: string
  filteredSummaries?: readonly StackSessionSummary[]
}): { ok: true; threadIds: string[] } | { ok: false; error: string } {
  const needle = input.body.trim().toLowerCase()
  if (!needle || needle === "target") {
    const target = input.workerTargetId
    if (!target || target === input.gardenerThreadId) {
      return { ok: false, error: "no worker target — use viewed/unviewed <thread-id-prefix>" }
    }
    return { ok: true, threadIds: [target] }
  }
  if (needle === "filter") {
    const summaries = input.filteredSummaries ?? []
    if (summaries.length === 0) {
      return { ok: false, error: "view filter requires a lights thread filter — try filter craftax first" }
    }
    return { ok: true, threadIds: summaries.map((summary) => summary.id) }
  }
  const matches = input.history.filter(
    (summary) =>
      summary.id !== input.gardenerThreadId &&
      (summary.id.toLowerCase().startsWith(needle) || summary.id.toLowerCase().includes(needle)),
  )
  if (matches.length === 0) {
    return { ok: false, error: `no thread matches ${JSON.stringify(input.body.trim())}` }
  }
  if (matches.length > 1 && !input.history.some((summary) => summary.id.toLowerCase() === needle)) {
    return {
      ok: false,
      error: `ambiguous thread prefix ${JSON.stringify(input.body.trim())} — matches ${matches.length} threads`,
    }
  }
  return { ok: true, threadIds: [matches[0]!.id] }
}
