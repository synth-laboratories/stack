import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  stackdHealthOk,
  stackdMetaThread,
  type StackdMetaThreadManifest,
} from "./client/stackd.js"
import { mergeGoalContext, type CodexGoalSnapshot } from "./codex/goal-context.js"

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
