#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const appRoot = resolve(import.meta.dir, "..")
const installer = resolve(appRoot, "packaging", "install.sh")
const manifest = resolve(appRoot, "packaging", "manifests", "nightly.example.json")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const evidenceDir = resolve(appRoot, ".stack", "evidence", "installer-contract", stamp)

const result = spawnSync(
  "sh",
  [
    installer,
    "--channel",
    "nightly",
    "--manifest",
    manifest,
    "--install-dir",
    resolve(appRoot, ".stack", "evidence", "installer-smoke", "install-dir"),
    "--bin-dir",
    resolve(appRoot, ".stack", "evidence", "installer-smoke", "bin-dir"),
    "--dry-run",
  ],
  { cwd: appRoot, encoding: "utf8" },
)

if (result.status !== 0) {
  console.error(result.stdout)
  console.error(result.stderr)
  process.exit(result.status ?? 1)
}

const output = result.stdout
const failures: string[] = []
for (const expected of [
  "Stack installer",
  "version: 0.2.0-dev.20260629.1",
  "target:",
  "artifact:",
  "dry_run: true",
  "stack_installer_plan_ok",
]) {
  if (!output.includes(expected)) failures.push(`missing ${expected}`)
}

if (failures.length > 0) {
  console.error(`installer_contract_smoke_failed: ${failures.join("; ")}`)
  console.error(output)
  process.exit(1)
}

mkdirSync(evidenceDir, { recursive: true })
writeFileSync(
  resolve(evidenceDir, "summary.json"),
  `${JSON.stringify(
    {
      stamp,
      ok: true,
      installer,
      manifest,
      output_lines: output.trim().split("\n"),
    },
    null,
    2,
  )}\n`,
)

console.log("installer_contract_smoke_ok")
console.log(`proof_dir: ${evidenceDir}`)
console.log(output.trim())
