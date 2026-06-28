import {
  bundledStackSkillsRoot,
  defaultCodexHome,
  ensureStackSkills,
  stackSkillsRoot,
  syncBundledStackSkills,
} from "./skills.js"

export function installedStackSkillNames(stackRoot: string, codexHome = defaultCodexHome()): string[] {
  void codexHome
  return syncBundledStackSkills(stackRoot)
}

export function ensureStackCodexSkills(stackRoot: string, codexHome = defaultCodexHome()): string[] {
  return ensureStackSkills(stackRoot, codexHome)
}

export { bundledStackSkillsRoot, defaultCodexHome, stackSkillsRoot }
