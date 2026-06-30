#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  bundledStackSkillsRoot,
  ensureStackCodexSkills,
  installedStackSkillNames,
} from "../src/codex/install-skills.ts"
import { stackGlobalSkillsRoot } from "../src/paths.ts"

const stackRoot = join(import.meta.dir, "..")
const required = ["synth-stack-productivity", "stack-local-setup", "oss-gepa", "synth-via-stack", "stack-agent-bridge"] as const
const expected = installedStackSkillNames(stackRoot)
for (const name of required) {
  if (!expected.includes(name)) {
    console.error("bundled skills missing", expected)
    process.exit(1)
  }
}

const installed = ensureStackCodexSkills(stackRoot)
for (const name of expected) {
  if (!installed.includes(name)) {
    console.error(`failed to install ${name}`)
    process.exit(1)
  }
  const workspaceSkill = join(bundledStackSkillsRoot(stackRoot), name, "SKILL.md")
  const globalSkill = join(stackGlobalSkillsRoot(), name, "SKILL.md")
  if (!existsSync(workspaceSkill) && !existsSync(globalSkill)) {
    console.error(`missing skill materialization for ${name}`)
    process.exit(1)
  }
}

console.log("stack_install_skills_smoke_ok")
console.log(installed.join(", "))
