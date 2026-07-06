#!/usr/bin/env bun
// Runtime smoke for Stack Codex sequestration:
//   1. Build a fixture "personal" ~/.codex (sessions, history.jsonl,
//      session_index.jsonl, auth.json) and snapshot it.
//   2. Run a Stack worker turn and a background (gardener) turn against a
//      fake `codex` binary that records its argv and CODEX_HOME and writes a
//      session file into whatever CODEX_HOME it was given.
//   3. Assert the personal fixture did not change, Stack artifacts landed
//      under <workspace>/.stack/codex-home, and the background turn ran
//      --ephemeral.
//   4. Assert the guard rejects a personal-home launch outright.

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const scratch = join(process.env.TMPDIR ?? "/tmp", `stack-codex-isolation-smoke-${process.pid}`)
const personalHome = join(scratch, "home")
const personalCodex = join(personalHome, ".codex")
const workspace = join(scratch, "workspace")
mkdirSync(join(personalCodex, "sessions", "2026", "07", "05"), { recursive: true })
mkdirSync(workspace, { recursive: true })
writeFileSync(join(personalCodex, "auth.json"), JSON.stringify({ tokens: { fixture: true } }))
writeFileSync(join(personalCodex, "history.jsonl"), `${JSON.stringify({ text: "personal" })}\n`)
writeFileSync(join(personalCodex, "session_index.jsonl"), `${JSON.stringify({ id: "personal" })}\n`)
writeFileSync(
  join(personalCodex, "sessions", "2026", "07", "05", "rollout-2026-07-05T00-00-00-personal.jsonl"),
  "{}\n",
)

// Fake codex: records argv + CODEX_HOME, writes a session artifact into its
// CODEX_HOME (exactly what a real codex would pollute), prints one JSON line.
const fakeCodex = join(scratch, "bin", "codex")
mkdirSync(join(scratch, "bin"), { recursive: true })
writeFileSync(
  fakeCodex,
  [
    "#!/bin/bash",
    `echo "$CODEX_HOME" > "${scratch}/observed_codex_home_$1.txt"`,
    `printf '%s\\n' "$@" > "${scratch}/observed_args.txt"`,
    'mkdir -p "$CODEX_HOME/sessions/2026/07/05"',
    'touch "$CODEX_HOME/sessions/2026/07/05/rollout-2026-07-05T01-00-00-stackthread.jsonl"',
    "cat > /dev/null || true",
    "echo '{\"type\":\"agent_message\",\"text\":\"ok\"}'",
  ].join("\n"),
)
chmodSync(fakeCodex, 0o755)

type Snapshot = Record<string, { size: number; mtimeMs: number }>
function snapshot(root: string): Snapshot {
  const out: Snapshot = {}
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stats = statSync(path)
      if (stats.isDirectory()) walk(path)
      else out[path] = { size: stats.size, mtimeMs: stats.mtimeMs }
    }
  }
  walk(root)
  return out
}

// Point Stack at the fixture before importing any stack module.
process.env.HOME = personalHome
process.env.STACK_ROOT = workspace
process.env.STACK_CODEX_COMMAND = fakeCodex
delete process.env.STACK_CODEX_HOME
delete process.env.STACK_CODEX_ISOLATION
delete process.env.CODEX_HOME

const { loadConfig } = await import("../src/config.js")
const { runCodexTurn } = await import("../src/codex/app-server-session.js")
const { assertStackCodexIsolation, personalCodexHome } = await import("../src/codex/isolation.js")

const failures: string[] = []
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`)
  if (!ok) failures.push(label)
}

const config = await loadConfig(join(import.meta.dir, ".."))
check(config.codexHome === join(workspace, ".stack", "codex-home"), "codexHome defaults into <workspace>/.stack/codex-home")
check(
  readFileSync(join(config.codexHome, "auth.json"), "utf8").includes("fixture"),
  "auth.json (and only auth material) is seeded from the personal home",
)
check(!existsSync(join(config.codexHome, "sessions")), "no sessions copied at seed time")

const before = snapshot(personalCodex)

await runCodexTurn({
  config,
  userPrompt: "worker turn",
  selectedFiles: [],
  priorTurns: [],
  onOutput: () => undefined,
})
await runCodexTurn({
  config,
  userPrompt: "gardener turn",
  selectedFiles: [],
  priorTurns: [],
  actorRole: "gardener",
  onOutput: () => undefined,
})

const observedArgs = readFileSync(join(scratch, "observed_args.txt"), "utf8").split("\n")
check(observedArgs.includes("--ephemeral"), "background (gardener) exec turn runs --ephemeral")
const observedHome = readFileSync(join(scratch, "observed_codex_home_exec.txt"), "utf8").trim()
check(observedHome === config.codexHome, "codex subprocess receives the Stack-owned CODEX_HOME")

const after = snapshot(personalCodex)
const beforeKeys = Object.keys(before).sort().join("|")
const afterKeys = Object.keys(after).sort().join("|")
check(beforeKeys === afterKeys, "personal ~/.codex gained no files during Stack turns")
check(
  Object.entries(before).every(([path, meta]) => after[path]?.size === meta.size && after[path]?.mtimeMs === meta.mtimeMs),
  "personal ~/.codex sessions/history/session_index unchanged (size+mtime)",
)
check(existsSync(join(config.codexHome, "sessions")), "stack codex artifacts landed under .stack/codex-home")

let guardThrew = false
try {
  assertStackCodexIsolation(
    { codexHome: personalCodexHome(), codexIsolationMode: "isolated_app_server" },
    "monitor",
    { transport: "app_server" },
  )
} catch {
  guardThrew = true
}
check(guardThrew, "guard rejects launching a Stack actor against the personal ~/.codex")

let ephemeralGuardThrew = false
try {
  assertStackCodexIsolation(
    { codexHome: config.codexHome, codexIsolationMode: "isolated_app_server" },
    "eval",
    { transport: "exec", args: ["exec", "--json"] },
  )
} catch {
  ephemeralGuardThrew = true
}
check(ephemeralGuardThrew, "guard rejects background codex exec without --ephemeral")

// Relocated $CODEX_HOME: auth seeding must read from the user's real Codex
// home wherever it lives — a user with CODEX_HOME set gets unauthenticated
// Stack launches if seeding assumes ~/.codex.
const relocatedCodex = join(scratch, "relocated-codex")
mkdirSync(relocatedCodex, { recursive: true })
writeFileSync(join(relocatedCodex, "auth.json"), JSON.stringify({ tokens: { relocated: true } }))
process.env.CODEX_HOME = relocatedCodex
const { ensureStackCodexHome } = await import("../src/codex/isolation.js")
check(personalCodexHome() === relocatedCodex, "personalCodexHome honors a relocated $CODEX_HOME")
const relocatedStackHome = join(scratch, "workspace-relocated", ".stack", "codex-home")
ensureStackCodexHome(relocatedStackHome)
check(
  readFileSync(join(relocatedStackHome, "auth.json"), "utf8").includes("relocated"),
  "auth.json seeds from the relocated $CODEX_HOME",
)
delete process.env.CODEX_HOME
check(personalCodexHome() === personalCodex, "personalCodexHome falls back to ~/.codex when $CODEX_HOME is unset")

if (failures.length > 0) {
  console.error(`\ncodex isolation smoke FAILED (${failures.length})`)
  process.exit(1)
}
console.log("\ncodex isolation smoke OK")
