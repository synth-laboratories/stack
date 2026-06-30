import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs"
import { join, resolve } from "node:path"

/** Resolve synth-optimizers source checkout (skills + dev_examples), not the PyPI CLI alone. */
export function resolveSynthOptimizersRoot(stackRoot: string): string | undefined {
  const candidates: string[] = []
  const fromEnv = process.env.STACK_SYNTH_OPTIMIZERS_ROOT?.trim()
  if (fromEnv) candidates.push(fromEnv)
  candidates.push(join(stackRoot, "..", "optimizers"))
  candidates.push(join(stackRoot, "..", "synth-optimizers"))
  for (const candidate of candidates) {
    const root = resolve(candidate)
    if (existsSync(join(root, "skills", "gepa", "SKILL.md"))) return root
  }
  return undefined
}

/** Symlink optimizers repo `skills/gepa` into `.stack/skills/gepa` when checkout exists. */
export function syncOptimizersGepaSkill(stackRoot: string): string[] {
  const optimizersRoot = resolveSynthOptimizersRoot(stackRoot)
  const consolidatedRoot = join(stackRoot, ".stack", "skills")
  mkdirSync(consolidatedRoot, { recursive: true })

  const synced: string[] = []
  if (optimizersRoot) {
    const source = join(optimizersRoot, "skills", "gepa")
    const target = join(consolidatedRoot, "gepa")
    if (linkPointsTo(source, target)) {
      synced.push("gepa")
    } else {
      replacePath(target)
      symlinkSync(source, target)
      synced.push("gepa")
    }
  }
  return synced
}

function linkPointsTo(source: string, target: string): boolean {
  if (!existsSync(target)) return false
  try {
    const stat = lstatSync(target)
    if (!stat.isSymbolicLink()) return false
    return resolve(readlinkSync(target)) === resolve(source)
  } catch {
    return false
  }
}

function replacePath(path: string): void {
  if (!existsSync(path)) return
  rmSync(path, { recursive: true, force: true })
}
