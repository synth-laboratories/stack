#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  bundledStackSkillsRoot,
  ensureStackCodexSkills,
  installedStackSkillNames,
} from "../src/codex/install-skills.ts"

const stackRoot = join(import.meta.dir, "..")
const expected = installedStackSkillNames(stackRoot)
if (!expected.includes("stack-local-setup") || !expected.includes("synth-via-stack") || !expected.includes("stack-agent-bridge")) {
  console.error("bundled skills missing", expected)
  process.exit(1)
}

const installed = ensureStackCodexSkills(stackRoot)
for (const name of expected) {
  if (!installed.includes(name)) {
    console.error(`failed to install ${name}`)
    process.exit(1)
  }
  const link = join(homedir(), ".codex", "skills", name, "SKILL.md")
  if (!existsSync(link)) {
    console.error(`missing symlink target ${link}`)
    process.exit(1)
  }
}

console.log("stack_install_skills_smoke_ok")
console.log(installed.join(", "))
