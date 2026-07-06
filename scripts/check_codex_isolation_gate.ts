#!/usr/bin/env bun
// Source gate: every Codex subprocess Stack launches must go through the
// approved launcher path (stackCodexEnv + assertStackCodexIsolation in
// src/codex/isolation.ts). A raw spawn of `codex` anywhere else can inherit
// the personal ~/.codex and leak Stack threads into the user's Codex app.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "..")
const srcRoot = join(repoRoot, "src")

// The only files allowed to spawn a codex process. Both must build their
// subprocess environment via stackCodexEnv.
const APPROVED_SPAWN_FILES = new Set([
  "src/codex/app-server-client.ts",
  "src/codex/app-server-session.ts",
])

const RAW_SPAWN_PATTERNS: RegExp[] = [
  /Bun\.spawn\(\s*\[\s*["']codex["']/,
  /spawn\(\s*["']codex["']/,
  /spawnSync\(\s*["']codex["']/,
  /Bun\.spawn\(\s*\[[^\]]*codexCommand/,
]

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      files.push(...walk(path))
    } else if (entry.endsWith(".ts")) {
      files.push(path)
    }
  }
  return files
}

const violations: string[] = []

for (const path of walk(srcRoot)) {
  const rel = relative(repoRoot, path)
  const text = readFileSync(path, "utf8")
  const spawnsCodex = RAW_SPAWN_PATTERNS.some((pattern) => pattern.test(text))
  if (spawnsCodex && !APPROVED_SPAWN_FILES.has(rel)) {
    violations.push(`${rel}: spawns a codex process outside the approved launcher path`)
  }
}

for (const rel of APPROVED_SPAWN_FILES) {
  const text = readFileSync(join(repoRoot, rel), "utf8")
  if (rel === "src/codex/app-server-session.ts" && !text.includes("stackCodexEnv(")) {
    violations.push(`${rel}: approved launcher no longer applies stackCodexEnv`)
  }
  if (rel === "src/codex/app-server-client.ts" && !text.includes("launch.env")) {
    violations.push(`${rel}: approved launcher no longer honors launch.env`)
  }
}

// Every app-server launch site must preflight the isolation guard.
const GUARDED_LAUNCH_FILES = ["src/codex/app-server-session.ts", "src/monitor-sidecar-codex.ts"]
for (const rel of GUARDED_LAUNCH_FILES) {
  const text = readFileSync(join(repoRoot, rel), "utf8")
  if (!text.includes("assertStackCodexIsolation(")) {
    violations.push(`${rel}: codex launch site is missing assertStackCodexIsolation preflight`)
  }
}

if (violations.length > 0) {
  console.error("codex isolation gate FAILED:")
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log("codex isolation gate OK")
