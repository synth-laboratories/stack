import { environmentAuthStatus, type StackConfig } from "./config.js"

export type SynthResponsesUsage = {
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
  reasoningOutputTokens?: number
}

export type SynthResponsesRunResult = {
  assistantText?: string
  usage?: SynthResponsesUsage
}

export async function runSynthResponsesTurn(input: {
  stackConfig: StackConfig
  route: string
  authError: string
  roleHeader: string
  model: string
  prompt: string
  maxOutputTokens: number
  metadata: Record<string, unknown>
  timeoutEnv: string
  defaultTimeoutMs: number
  failurePrefix: string
}): Promise<SynthResponsesRunResult> {
  const auth = environmentAuthStatus(input.stackConfig.environment)
  const token = process.env[input.stackConfig.environment.authEnv]
  if (!auth.hasAuth || !token) {
    throw new Error(input.authError)
  }

  const response = await fetch(`${input.stackConfig.environment.apiBaseUrl.replace(/\/+$/, "")}${input.route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Stack-Actor-Role": input.roleHeader,
    },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      max_output_tokens: input.maxOutputTokens,
      metadata: input.metadata,
    }),
    signal: AbortSignal.timeout(synthTimeoutMs(input.timeoutEnv, input.defaultTimeoutMs)),
  })

  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(`${input.failurePrefix}: ${response.status} ${readErrorMessage(payload) ?? response.statusText}`)
  }

  return {
    assistantText: readResponseText(payload),
    usage: readUsage(payload),
  }
}

function readResponseText(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const outputText = readString(record?.output_text)
  if (outputText) return outputText
  const parts: string[] = []
  for (const output of asArray(record?.output)) {
    const outputRecord = asRecord(output)
    const directText = readString(outputRecord?.text)
    if (directText) parts.push(directText)
    for (const content of asArray(outputRecord?.content)) {
      const contentRecord = asRecord(content)
      const text = readString(contentRecord?.text) ?? readString(contentRecord?.output_text)
      if (text) parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join("\n").trim() : undefined
}

function readUsage(payload: unknown): SynthResponsesUsage | undefined {
  const usage = asRecord(asRecord(payload)?.usage)
  if (!usage) return undefined
  const inputTokens = readNumber(usage.input_tokens) ?? readNumber(usage.prompt_tokens) ?? 0
  const outputTokens = readNumber(usage.output_tokens) ?? readNumber(usage.completion_tokens) ?? 0
  const details = asRecord(usage.input_tokens_details)
  const outputDetails = asRecord(usage.output_tokens_details)
  return {
    inputTokens,
    cachedInputTokens: readNumber(details?.cached_tokens) ?? 0,
    outputTokens,
    reasoningOutputTokens: readNumber(outputDetails?.reasoning_tokens) ?? 0,
  }
}

function readErrorMessage(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const detail = readString(record?.detail)
  if (detail) return detail
  const error = asRecord(record?.error)
  return readString(error?.message)
}

function synthTimeoutMs(envName: string, defaultMs: number): number {
  const raw = process.env[envName]
  if (!raw) return defaultMs
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
