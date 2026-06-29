import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { StackVoiceConfig } from "../config.js"

export function loadVoiceApiKeys(config?: Pick<StackVoiceConfig, "envFile">): { groq?: string; openai?: string } {
  return {
    groq: readEnvKey("GROQ_API_KEY", config),
    openai: readEnvKey("OPENAI_API_KEY", config),
  }
}

function readEnvKey(name: string, config?: Pick<StackVoiceConfig, "envFile">): string | undefined {
  const direct = process.env[name]?.trim()
  if (direct) return direct
  for (const path of envFileCandidates(config)) {
    if (!existsSync(path)) continue
    const match = readFileSync(path, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"))
    if (match?.[1]?.trim()) return match[1].trim()
  }
  return undefined
}

function envFileCandidates(config?: Pick<StackVoiceConfig, "envFile">): string[] {
  const paths = [
    join(homedir(), ".stack", "voice.env"),
    join(homedir(), "Documents", "GitHub", "synth-ai", ".env"),
  ]
  if (config?.envFile) paths.unshift(config.envFile)
  if (process.env.STACK_SYNTH_AI_ENV) paths.unshift(process.env.STACK_SYNTH_AI_ENV)
  return paths
}
