#!/usr/bin/env bun

import { fileURLToPath } from "node:url"
import { join } from "node:path"

const suite = process.argv[2] ?? "paste"
const backend = process.argv[3]
const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../..")

if (backend) {
  process.env.STACK_TUI_E2E_BACKEND = backend
}

const scripts: Record<string, string> = {
  boot: "scripts/tui_e2e/smoke_boot.ts",
  paste: "scripts/tui_e2e/smoke_paste.ts",
}

const script = scripts[suite]
if (!script) {
  console.error(`unknown tui e2e suite: ${suite}`)
  console.error(`available: ${Object.keys(scripts).join(", ")}`)
  process.exit(1)
}

const proc = Bun.spawn(["bun", "run", script], {
  cwd: repoRoot,
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
})
const status = await proc.exited
process.exit(status)
