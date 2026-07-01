import { join } from "node:path"
import { runCodexTurn } from "./codex/app-server-session.js"
import type { StackConfig } from "./config.js"
import {
  appendGardenerChatMessage,
  applyGardenerHarnessToConfig,
  restoreWorkerHarness,
  snapshotWorkerHarness,
} from "./gardener.js"
import { loadGardenerConfig, resolveGardenerSystemPrompt, type StackGardenerConfig } from "./gardener-config.js"
import { readMetaThreadManifests } from "./meta-thread-goal.js"
import {
  readSessionLog,
  writeSessionLog,
  type StackCodexTurn,
  type StackLocalSession,
  type StackSessionSummary,
} from "./session.js"
import { blocksFromTurnStdout } from "./tui/transcript.js"
import { resolveThreadDisplayLabel } from "./thread-display-name.js"

export type GardenerChatTurnInput = {
  config: StackConfig
  gardenerThreadId: string
  userMessage: string
  workerSession: StackLocalSession
  workerSummaries?: readonly StackSessionSummary[]
  workerTargetId?: string
  onOutput?: (chunk: string) => void
}

export async function runGardenerChatTurn(input: GardenerChatTurnInput): Promise<string | undefined> {
  const sessionPath = join(input.config.sessionLogDir, `${input.gardenerThreadId}.json`)
  const gardenerSession = await readSessionLog(sessionPath)

  const workerHarness = snapshotWorkerHarness(input.config)
  const gardenerConfig = loadGardenerConfig(input.config.stackDataRoot)
  applyGardenerHarnessToConfig(input.config, gardenerConfig)
  try {
    const turn = await runCodexTurn({
      config: input.config,
      userPrompt: await buildGardenerChatPrompt(input.userMessage, input, gardenerConfig),
      selectedFiles: [],
      priorTurns: gardenerSession.turns,
      onOutput: input.onOutput ?? (() => undefined),
    })
    gardenerSession.turns.push(turn)
    await writeSessionLog(gardenerSession, input.config.sessionLogDir, {
      codexModel: gardenerSession.codexModel,
      pricingRows: input.config.codexPricing,
    })
    const response = extractTurnAssistantText(turn)
    if (response) {
      appendGardenerChatMessage(input.config.stackDataRoot, input.gardenerThreadId, "gardener", response)
    }
    return response
  } finally {
    restoreWorkerHarness(input.config, workerHarness)
  }
}

async function buildGardenerChatPrompt(
  message: string,
  input: GardenerChatTurnInput,
  gardenerConfig: StackGardenerConfig,
): Promise<string> {
  const workers = (input.workerSummaries ?? [])
    .filter((summary) => summary.id !== input.gardenerThreadId)
    .slice(0, 8)
  const workerLines = workers.map(
    (summary) =>
      `- ${summary.id.slice(0, 8)} · ${summary.turnCount} turns · ${truncateOneLine(resolveThreadDisplayLabel(summary, { maxLength: 72 }), 72)}`,
  )
  const target = input.workerTargetId?.slice(0, 8)
  const systemPrompt = resolveGardenerSystemPrompt(input.config.stackDataRoot, gardenerConfig)
  const metaThreadLines = await liveMetaThreadLines(input.config.stackDataRoot)
  return [
    systemPrompt,
    ...(target ? [`Default worker target for explicit routing: ${target}`] : []),
    ...(workerLines.length > 0 ? ["Live worker threads:", ...workerLines] : []),
    ...(metaThreadLines.length > 0 ? ["Live meta-threads:", ...metaThreadLines] : []),
    "",
    "Operator message:",
    message,
  ].join("\n")
}

async function liveMetaThreadLines(stackDataRoot: string): Promise<string[]> {
  const manifests = await readMetaThreadManifests(stackDataRoot, "live")
  return manifests.slice(0, 8).map((manifest) => {
    const goal = manifest.active_goal
    const goalLabel = goal?.objective?.trim()
      ? `goal ${goal.status || "active"}`
      : "no goal"
    const monitor = manifest.monitor_profile ? ` · monitor ${manifest.monitor_profile}` : ""
    return `- ${manifest.id.slice(0, 10)} · ${truncateOneLine(manifest.title, 48)} · ${goalLabel} · head ${manifest.head_thread_id.slice(0, 8)}${monitor}`
  })
}

function extractTurnAssistantText(turn: StackCodexTurn): string | undefined {
  const { blocks } = blocksFromTurnStdout(turn.prompt, turn.stdout)
  const parts: string[] = []
  for (const block of blocks) {
    if (block.kind === "agent" && block.text.trim()) {
      parts.push(block.text.trim())
    }
  }
  if (parts.length > 0) return parts.join("\n\n")
  const stderr = turn.stderr?.trim()
  if (stderr) return stderr
  const stdout = turn.stdout.trim()
  return stdout ? stdout.slice(0, 4000) : undefined
}

function truncateOneLine(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= maxLength) return trimmed
  if (maxLength <= 3) return trimmed.slice(0, maxLength)
  return `${trimmed.slice(0, maxLength - 1)}…`
}
