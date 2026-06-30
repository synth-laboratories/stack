#!/usr/bin/env bun

import { join, resolve } from "node:path"
import {
  stackdBootstrapSkills,
  stackdHealth,
  stackdListSkills,
  stackdReadSkill,
} from "../src/client/stackd.ts"

const appRoot = resolve(import.meta.dir, "..")
process.env.STACK_ROOT = appRoot

const port = 18840 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const required = ["oss-gepa", "hosted-gepa", "synth-ai"]
const failures: string[] = []

const stackdBin = join(appRoot, "target/debug/stackd")
const proc = Bun.spawn([stackdBin, "serve", "--port", String(port)], {
  cwd: appRoot,
  env: { ...process.env, STACK_ROOT: appRoot, STACKD_MONITOR_SCHEDULER: "0" },
  stdout: "pipe",
  stderr: "pipe",
})

try {
  await waitForStackd(baseUrl)

  const bootstrapped = await stackdBootstrapSkills(baseUrl)
  const listed = await stackdListSkills(baseUrl)
  const ids = new Set(listed.skills.map((skill) => skill.skill_id))

  for (const skillId of required) {
    if (!ids.has(skillId)) failures.push(`missing preinstalled skill ${skillId}`)
  }

  if (bootstrapped.count < required.length) {
    failures.push(`bootstrap returned ${bootstrapped.count} skills`)
  }

  for (const skillId of required) {
    const read = await stackdReadSkill(skillId, {}, baseUrl)
    if (!read.content.includes("---")) failures.push(`${skillId} content missing frontmatter`)
  }

  if (failures.length > 0) {
    console.error(`stackd_skills_smoke_failed: ${failures.join("; ")}`)
    process.exit(1)
  }

  console.log("stackd_skills_smoke_ok")
  console.log([...ids].sort().join(", "))
} finally {
  proc.kill()
}

async function waitForStackd(baseUrl: string): Promise<void> {
  let lastError = "unknown"
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const health = await stackdHealth(baseUrl)
      if (health.ok) return
      lastError = JSON.stringify(health)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(250)
  }
  throw new Error(`stackd health failed: ${lastError}`)
}
