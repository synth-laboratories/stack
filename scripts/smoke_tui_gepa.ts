#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const stackRoot = resolve(import.meta.dir, "..")
const smokeDir = process.env.STACK_GEPA_SMOKE_DIR ?? "/tmp/stack-tui-gepa-smoke"
const expectScript = join(stackRoot, "scripts/smoke_tui_gepa.expect")

const expect = spawnSync("expect", [expectScript], {
  cwd: stackRoot,
  encoding: "utf8",
  env: process.env,
})

if (expect.status !== 0) {
  console.error("stack_tui_gepa_smoke_failed: expect exited", expect.status)
  if (expect.stdout) console.error(expect.stdout.trim())
  if (expect.stderr) console.error(expect.stderr.trim())
  process.exit(expect.status ?? 1)
}

const sessionPath = findLatestSessionPath(smokeDir)
if (!sessionPath) {
  console.error("stack_tui_gepa_smoke_failed: no session JSON written")
  process.exit(1)
}

const session = JSON.parse(readFileSync(sessionPath, "utf8")) as {
  turns?: Array<{ exitCode?: number; prompt?: string; stdout?: string }>
}

const turn = session.turns?.at(-1)
const failures = [
  !turn ? "missing final turn" : "",
  turn?.exitCode !== 0 ? `final turn exit ${turn?.exitCode}` : "",
  !turn?.stdout?.includes("STACK_GEPA_SMOKE_OK") ? "session stdout missing STACK_GEPA_SMOKE_OK" : "",
  !turn?.prompt?.includes("Banking77") ? "session prompt missing Banking77 marker" : "",
].filter((failure) => failure.length > 0)

if (failures.length > 0) {
  console.error(`stack_tui_gepa_smoke_failed: ${failures.join("; ")}`)
  process.exit(1)
}

console.log("stack_tui_gepa_smoke_ok")
console.log(`session=${sessionPath}`)

function findLatestSessionPath(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== "seed-session.json")
    .map((name) => join(dir, name))
  if (candidates.length === 0) return undefined
  return candidates.sort().at(-1)
}
