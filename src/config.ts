import { join } from "node:path"

export type StackConfig = {
  workspaceRoot: string
  codexCommand: string
  codexArgs: string[]
  sessionLogDir: string
}

export function loadConfig(workspaceRoot: string): StackConfig {
  return {
    workspaceRoot,
    codexCommand: process.env.STACK_CODEX_COMMAND ?? "codex",
    codexArgs: parseArgs(process.env.STACK_CODEX_ARGS ?? "exec --color never"),
    sessionLogDir: process.env.STACK_SESSION_DIR ?? join(workspaceRoot, ".stack", "sessions"),
  }
}

function parseArgs(value: string): string[] {
  return value
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}
