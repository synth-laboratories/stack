import { join } from "node:path"

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini"
const DEFAULT_CODEX_REASONING_EFFORT = "medium"

export type StackConfig = {
  workspaceRoot: string
  codexCommand: string
  codexArgs: string[]
  codexModel: string
  codexReasoningEffort: string
  sessionLogDir: string
}

export async function loadConfig(workspaceRoot: string): Promise<StackConfig> {
  const codexModel = process.env.STACK_CODEX_MODEL ?? DEFAULT_CODEX_MODEL
  const codexReasoningEffort =
    process.env.STACK_CODEX_REASONING_EFFORT ?? DEFAULT_CODEX_REASONING_EFFORT

  return {
    workspaceRoot,
    codexCommand: process.env.STACK_CODEX_COMMAND ?? "codex",
    codexArgs: process.env.STACK_CODEX_ARGS
      ? parseArgs(process.env.STACK_CODEX_ARGS)
      : defaultCodexArgs(codexModel, codexReasoningEffort),
    codexModel,
    codexReasoningEffort,
    sessionLogDir: process.env.STACK_SESSION_DIR ?? join(workspaceRoot, ".stack", "sessions"),
  }
}

function defaultCodexArgs(model: string, reasoningEffort: string): string[] {
  return [
    "exec",
    "--json",
    "--color",
    "never",
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${reasoningEffort}"`,
  ]
}

function parseArgs(value: string): string[] {
  return value
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}
