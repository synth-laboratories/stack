import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  stackdHealthOk,
  stackdMetaThread,
  stackdUpdateMetaThreadGoal,
  type StackdMetaThreadManifest,
} from "./client/stackd.js"
import { mergeGoalContext, readCodexGoalSnapshotOnce, type CodexGoalSnapshot } from "./codex/goal-context.js"

export type MetaThreadActiveGoal = {
  objective: string
  status: string
  acceptance_criteria: string[]
  blockers: string[]
}

export async function readMetaThreadManifest(
  stackDataRoot: string,
  metaThreadId: string,
): Promise<StackdMetaThreadManifest | undefined> {
  if (await stackdHealthOk()) {
    try {
      return await stackdMetaThread(metaThreadId)
    } catch {
      // fall through to disk read
    }
  }
  const path = join(stackDataRoot, ".stack", "meta-threads", metaThreadId, "manifest.json")
  try {
    const text = await readFile(path, "utf8")
    return JSON.parse(text) as StackdMetaThreadManifest
  } catch {
    return undefined
  }
}

/**
 * Maps the Codex thread-goal status vocabulary (active / paused / complete) onto the meta-thread
 * `active_goal.status` vocabulary (active / paused / blocked / done / cleared). Codex never emits
 * blocked or cleared — those are operator-owned on the meta side.
 */
export function mapCodexGoalStatusToMeta(status: string | undefined): string | undefined {
  const normalized = status?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === "complete" || normalized === "completed" || normalized === "done") return "done"
  if (normalized === "paused") return "paused"
  if (normalized === "active" || normalized === "in_progress" || normalized === "running") return "active"
  return normalized
}

/**
 * Decides the meta-goal status given the authoritative Codex thread-goal status. Direction is
 * codex → meta: the agent owns the lifecycle and marks completion. Precedence:
 *  - never resurrect an operator-cleared goal;
 *  - completion (agent-owned, terminal) always propagates;
 *  - operator-owned holds (paused / blocked) win over a codex "active";
 *  - otherwise mirror codex.
 * Returns the desired meta status, or `undefined` when no change is warranted.
 */
export function reconcileMetaGoalStatus(
  codexStatus: string | undefined,
  metaStatus: string | undefined,
): string | undefined {
  const codex = mapCodexGoalStatusToMeta(codexStatus)
  if (!codex) return undefined
  const meta = metaStatus?.trim().toLowerCase() || "active"
  if (meta === "cleared") return undefined
  if (codex === "done") return meta === "done" ? undefined : "done"
  if (meta === "paused" || meta === "blocked") return undefined
  if (codex === meta) return undefined
  return codex
}

/**
 * Sync layer: reconciles a meta-thread's `active_goal` with its worker thread's authoritative Codex
 * goal, persisting any divergence through stackd so every reader (display, badges, other processes)
 * sees the truth. The common case — agent calls `update_goal {complete}` without going through a
 * Stack `/goal` command — would otherwise leave the meta goal stuck "active". No-op when there's no
 * codex thread, no bound goal, or no divergence. Returns the (possibly updated) manifest.
 */
export async function reconcileMetaThreadGoalFromCodex(
  metaThreadId: string,
  codexThreadId: string | undefined,
  manifest: StackdMetaThreadManifest | undefined,
): Promise<StackdMetaThreadManifest | undefined> {
  const meta = manifest?.active_goal
  if (!codexThreadId || !meta?.objective?.trim()) return manifest
  const codexGoal = await readCodexGoalSnapshotOnce(codexThreadId)
  const desired = reconcileMetaGoalStatus(codexGoal?.status, meta.status)
  if (!desired) return manifest
  try {
    return await stackdUpdateMetaThreadGoal(metaThreadId, {
      objective: meta.objective,
      status: desired,
      acceptance_criteria: meta.acceptance_criteria,
      blockers: meta.blockers,
    })
  } catch {
    // stackd unavailable — keep the current manifest and let the next refresh retry the sync.
    return manifest
  }
}

export function mergeMetaThreadGoalContext(
  codexGoal: CodexGoalSnapshot,
  manifest?: StackdMetaThreadManifest,
): CodexGoalSnapshot {
  const meta = manifest?.active_goal
  if (!meta?.objective?.trim()) return codexGoal
  return mergeGoalContext(codexGoal, {
    objective: meta.objective.trim(),
    status: meta.status,
    acceptanceCriteria: meta.acceptance_criteria,
    blockers: meta.blockers,
    source: "meta_thread",
  })
}

export function metaThreadGoalStripLines(
  manifest: StackdMetaThreadManifest | undefined,
  columns: number,
): string[] {
  const goal = manifest?.active_goal
  if (!goal?.objective?.trim()) return []

  const width = Math.max(24, columns - 2)
  const lines: string[] = [
    truncateMetaGoalLine(`mt · ${goal.status} · ${goal.objective.replace(/\s+/g, " ").trim()}`, width),
  ]

  for (const criterion of goal.acceptance_criteria.slice(0, 4)) {
    const normalized = criterion.trim()
    if (!normalized) continue
    lines.push(
      truncateMetaGoalLine(
        normalized.startsWith("[") ? `  ${normalized}` : `  [ ] ${normalized}`,
        width,
      ),
    )
  }
  if (goal.acceptance_criteria.length > 4) {
    lines.push(truncateMetaGoalLine(`  … +${goal.acceptance_criteria.length - 4} criteria`, width))
  }
  for (const blocker of goal.blockers.slice(0, 2)) {
    const normalized = blocker.trim()
    if (!normalized) continue
    lines.push(truncateMetaGoalLine(`  blocker · ${normalized}`, width))
  }
  return lines
}

function truncateMetaGoalLine(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text
  return `${text.slice(0, Math.max(0, maxWidth - 1))}…`
}
