import { join } from "node:path"

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini"
const DEFAULT_CODEX_REASONING_EFFORT = "medium"

export const CODEX_MODEL_OPTIONS = ["gpt-5.4-mini", "gpt-5.5", "gpt-5.4", "gpt-5"] as const
export const CODEX_REASONING_EFFORT_OPTIONS = ["low", "medium", "high"] as const

export type StackConfig = {
  workspaceRoot: string
  codexCommand: string
  codexArgs: string[]
  codexModel: string
  codexReasoningEffort: string
  codexArgsLocked: boolean
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
    codexArgsLocked: Boolean(process.env.STACK_CODEX_ARGS),
    sessionLogDir: process.env.STACK_SESSION_DIR ?? join(workspaceRoot, ".stack", "sessions"),
  }
}

export function setCodexModel(config: StackConfig, model: string): void {
  config.codexModel = model
  refreshCodexArgs(config)
}

export function setCodexReasoningEffort(config: StackConfig, reasoningEffort: string): void {
  config.codexReasoningEffort = reasoningEffort
  refreshCodexArgs(config)
}

function refreshCodexArgs(config: StackConfig): void {
  if (config.codexArgsLocked) return
  config.codexArgs = defaultCodexArgs(config.codexModel, config.codexReasoningEffort)
}

export function defaultCodexArgs(model: string, reasoningEffort: string): string[] {
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
