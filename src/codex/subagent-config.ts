import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { StackConfig } from "../config.js"

const STACK_AGENT_PROFILES = [
  {
    name: "default",
    description: "Default Stack subagent for general delegated work.",
    instructions: [
      "Handle bounded delegated work from the parent Stack session.",
      "Keep intermediate output concise and return a clear summary with evidence.",
      "Do not make broad writes unless the parent prompt explicitly asked for implementation.",
    ],
  },
  {
    name: "worker",
    description: "Stack worker subagent for implementation, fixes, and focused execution.",
    instructions: [
      "Execute a focused delegated task from the parent Stack session.",
      "Prefer narrow edits, concrete evidence, and a concise final handoff.",
      "Avoid expanding scope beyond the delegated task.",
    ],
  },
  {
    name: "explorer",
    description: "Stack explorer subagent for repo inspection, research, and evidence gathering.",
    instructions: [
      "Investigate the delegated question with read-first discipline.",
      "Return exact file paths, commands, or docs that support the conclusion.",
      "Do not edit files unless the parent prompt explicitly asks for a write.",
    ],
  },
]

export function syncStackSubagentAgentFiles(config: StackConfig): void {
  const agentsDir = join(config.appRoot, ".codex", "agents")
  mkdirSync(agentsDir, { recursive: true })
  for (const profile of STACK_AGENT_PROFILES) {
    writeIfChanged(
      join(agentsDir, `${profile.name}.toml`),
      agentToml(profile, config.codexSubagentModel, config.codexSubagentReasoningEffort),
    )
  }
}

function agentToml(
  profile: (typeof STACK_AGENT_PROFILES)[number],
  model: string,
  reasoningEffort: string,
): string {
  return [
    `name = ${tomlString(profile.name)}`,
    `description = ${tomlString(profile.description)}`,
    `model = ${tomlString(model)}`,
    `model_reasoning_effort = ${tomlString(reasoningEffort)}`,
    'developer_instructions = """',
    ...profile.instructions,
    '"""',
    "",
  ].join("\n")
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return
  writeFileSync(path, content)
}
