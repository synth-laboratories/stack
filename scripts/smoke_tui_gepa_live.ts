#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const stackRoot = resolve(import.meta.dir, "..")
const optimizersRoot = join(process.env.HOME ?? "", "Documents/GitHub/optimizers")
const timeoutMs = readPositiveInteger(process.env.STACK_GEPA_LIVE_TIMEOUT_MS, 180_000)

if (!existsSync(join(optimizersRoot, "dev_examples/better_gepa/run_acceptance.py"))) {
  console.error("stack_tui_gepa_live_skipped: optimizers checkout missing run_acceptance.py")
  process.exit(0)
}

const key = loadOpenAiKey()
if (!key) {
  console.error("stack_tui_gepa_live_skipped: OPENAI_API_KEY missing")
  process.exit(0)
}

const smokeDir = process.env.STACK_GEPA_LIVE_DIR ?? "/tmp/stack-tui-gepa-live"
const artifactDir = `${smokeDir}/artifacts`
const expectScript = join(stackRoot, "scripts/smoke_tui_gepa.expect")

const expect = spawnSync("expect", [expectScript], {
  cwd: stackRoot,
  encoding: "utf8",
  timeout: timeoutMs,
  env: {
    ...process.env,
    STACK_GEPA_SMOKE_REAL: "1",
    STACK_GEPA_SMOKE_DIR: smokeDir,
    STACK_SESSION_DIR: smokeDir,
    STACK_GEPA_SMOKE_ARTIFACT_DIR: artifactDir,
    OPENAI_API_KEY: key,
  },
})

if (expect.status !== 0) {
  console.error("stack_tui_gepa_live_failed: expect exited", expect.status)
  if (expect.stdout) console.error(expect.stdout.trim())
  if (expect.stderr) console.error(expect.stderr.trim())
  process.exit(expect.status ?? 1)
}

const outputLog = `${smokeDir}/output.log`
const output = existsSync(outputLog) ? readFileSync(outputLog, "utf8") : ""
if (output.includes("Failed to create optimized buffer")) {
  console.error("stack_tui_gepa_live_failed: OpenTUI buffer crash")
  process.exit(1)
}

if (!output.includes("STACK_GEPA_SMOKE_OK")) {
  console.error("stack_tui_gepa_live_failed: missing STACK_GEPA_SMOKE_OK in terminal output")
  process.exit(1)
}

console.log("stack_tui_gepa_live_ok")

function loadOpenAiKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const envPath = join(process.env.HOME ?? "", "Documents/GitHub/synth-ai/.env")
  if (!existsSync(envPath)) return undefined
  const match = readFileSync(envPath, "utf8").match(/^OPENAI_API_KEY=(.+)$/m)
  return match?.[1]?.trim()
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
