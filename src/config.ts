import { join } from "node:path"
import { homedir } from "node:os"

export type StackConfig = {
  workspaceRoot: string
  codexCommand: string
  codexArgs: string[]
  codexModel: string
  codexReasoningEffort: string
  sessionLogDir: string
}

export async function loadConfig(workspaceRoot: string): Promise<StackConfig> {
  const codexDefaults = await readCodexDefaults()

  return {
    workspaceRoot,
    codexCommand: process.env.STACK_CODEX_COMMAND ?? "codex",
    codexArgs: parseArgs(process.env.STACK_CODEX_ARGS ?? "exec --color never"),
    codexModel: process.env.STACK_CODEX_MODEL ?? codexDefaults.model ?? "unknown",
    codexReasoningEffort:
      process.env.STACK_CODEX_REASONING_EFFORT ?? codexDefaults.reasoningEffort ?? "unknown",
    sessionLogDir: process.env.STACK_SESSION_DIR ?? join(workspaceRoot, ".stack", "sessions"),
  }
}

type CodexDefaults = {
  model?: string
  reasoningEffort?: string
}

async function readCodexDefaults(): Promise<CodexDefaults> {
  const path = join(homedir(), ".codex", "config.toml")
  const file = Bun.file(path)
  if (!(await file.exists())) return {}

  const text = await file.text()
  return {
    model: readTomlString(text, "model"),
    reasoningEffort: readTomlString(text, "model_reasoning_effort"),
  }
}

function readTomlString(text: string, key: string): string | undefined {
  const pattern = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m")
  return pattern.exec(text)?.[1]
}

function parseArgs(value: string): string[] {
  return value
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}
