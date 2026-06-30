#!/usr/bin/env bun
/**
 * `codex app-server` has no -m/--model flag (only `codex exec` does) — passing
 * it through verbatim made the app-server process exit immediately with
 * "unexpected argument '-m' found", surfacing to users as a generic
 * "codex app-server stdout closed" error on any native goal action.
 * Guards the exec→app-server arg translation against that regression.
 */

import { codexAppServerArgs } from "../src/codex/app-server-client.ts"

const failures: string[] = []

function check(label: string, condition: boolean): void {
  if (!condition) failures.push(label)
}

const execArgs = [
  "exec",
  "--json",
  "--color",
  "never",
  "--skip-git-repo-check",
  "-m",
  "gpt-5.4-mini",
  "-c",
  'model_reasoning_effort="medium"',
  "-c",
  "features.multi_agent=true",
  "-c",
  'mcp_servers.stack_live_ops.command="/path/to/stack-mcp"',
]

const result = codexAppServerArgs(execArgs)

check("starts with app-server subcommand", result[0] === "app-server")
check("never passes -m through", !result.includes("-m"))
check(
  "translates -m to -c model=...",
  result.some((arg, index) => arg === "-c" && result[index + 1] === 'model="gpt-5.4-mini"'),
)
check(
  "preserves other -c overrides",
  result.some((arg, index) => arg === "-c" && result[index + 1] === 'model_reasoning_effort="medium"'),
)
check("strips exec-only flags", !["exec", "--json", "--color", "never", "--skip-git-repo-check"].some((f) => result.includes(f)))
check("enables goals by default", result.includes("--enable") && result[result.indexOf("--enable") + 1] === "goals")

const alreadyEnabled = codexAppServerArgs(["-m", "gpt-5.4-mini", "--enable", "goals"])
check(
  "doesn't double-enable goals",
  alreadyEnabled.filter((arg) => arg === "goals").length === 1,
)

if (failures.length > 0) {
  console.error("smoke_codex_app_server_args_failed")
  console.error(failures.join("\n"))
  console.error(JSON.stringify(result))
  process.exit(1)
}

console.log("smoke_codex_app_server_args_ok")
console.log(JSON.stringify({ ok: true, result }, null, 2))
