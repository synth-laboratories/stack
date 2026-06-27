import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { buildSessionUsageSummary, type CodexModelPricing } from "./codex/usage-cost.js"

export type StackSessionUsageTotals = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  turnCountWithUsage: number
}

export type StackSessionUsageSummary = {
  model: string
  totals: StackSessionUsageTotals
  estimatedSpendUsd?: number
}

export type StackCodexTurn = {
  id: string
  prompt: string
  selectedPaths: string[]
  startedAt: string
  finishedAt?: string
  exitCode?: number
  usage?: StackCodexUsage
  stdout: string
  stderr: string
}

export type StackCodexUsage = {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
}

export type StackLocalSession = {
  id: string
  workspaceRoot: string
  startedAt: string
  codexCommand: string
  codexModel?: string
  codexThreadId?: string
  usageSummary?: StackSessionUsageSummary
  turns: StackCodexTurn[]
}

export type StackSessionSummary = {
  id: string
  path: string
  startedAt: string
  updatedAt: string
  turnCount: number
  lastPrompt?: string
  usageSummary?: StackSessionUsageSummary
}

export function createSession(workspaceRoot: string, codexCommand: string): StackLocalSession {
  return {
    id: randomUUID(),
    workspaceRoot,
    startedAt: new Date().toISOString(),
    codexCommand,
    turns: [],
  }
}

export async function readSessionLog(path: string): Promise<StackLocalSession> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as StackLocalSession
  for (const turn of parsed.turns ?? []) {
    turn.usage ??= readUsageFromStdout(turn.stdout)
  }
  return parsed
}

export async function listSessionHistory(
  sessionLogDir: string,
  pricingRows?: readonly CodexModelPricing[],
): Promise<StackSessionSummary[]> {
  let entries: string[]
  try {
    entries = await readdir(sessionLogDir)
  } catch {
    return []
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry): Promise<StackSessionSummary | undefined> => {
        const path = join(sessionLogDir, entry)
        try {
          const [session, info] = await Promise.all([readSessionLog(path), stat(path)])
          const lastTurn = session.turns.at(-1)
          const usageSummary =
            session.usageSummary ??
            buildSessionUsageSummary(
              session.turns,
              session.codexModel ?? inferCodexModel(session.codexCommand),
              pricingRows,
            )
          return {
            id: session.id,
            path,
            startedAt: session.startedAt,
            updatedAt: info.mtime.toISOString(),
            turnCount: session.turns.length,
            lastPrompt: lastTurn?.prompt,
            usageSummary,
          }
        } catch {
          return undefined
        }
      }),
  )

  return summaries
    .filter((summary): summary is StackSessionSummary => Boolean(summary))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function writeSessionLog(
  session: StackLocalSession,
  sessionLogDir: string,
  options?: { codexModel?: string; pricingRows?: readonly CodexModelPricing[] },
): Promise<string> {
  await mkdir(sessionLogDir, { recursive: true })
  if (options?.codexModel) session.codexModel = options.codexModel
  session.usageSummary = buildSessionUsageSummary(
    session.turns,
    session.codexModel ?? inferCodexModel(session.codexCommand),
    options?.pricingRows,
  )
  const path = join(sessionLogDir, `${session.id}.json`)
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, "utf8")
  return path
}

export function readUsageFromStdout(stdout: string): StackCodexUsage | undefined {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    const event = asRecord(record)
    if (!event || event.type !== "turn.completed") continue
    const usage = asRecord(event.usage)
    if (!usage) continue
    return {
      inputTokens: readNumber(usage.input_tokens),
      cachedInputTokens: readNumber(usage.cached_input_tokens),
      outputTokens: readNumber(usage.output_tokens),
      reasoningOutputTokens: readNumber(usage.reasoning_output_tokens),
    }
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function inferCodexModel(codexCommand: string): string {
  const match = codexCommand.match(/(?:^|\s)-m\s+(\S+)/)
  return match?.[1] ?? "gpt-5.4-mini"
}
