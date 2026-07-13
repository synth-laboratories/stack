import { randomUUID } from "node:crypto"
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
import { runSynthResponsesTurn } from "./synth-responses.js"
import { localModelCapabilities } from "./local/optimizers.js"
import { blocksFromTurnStdout } from "./tui/transcript.js"
import { resolveThreadDisplayLabel } from "./thread-display-name.js"
import { readThreadMetaEvents } from "./thread-events.js"

export type GardenerChatTurnInput = {
  config: StackConfig
  gardenerThreadId: string
  userMessage: string
  imagePaths?: string[]
  workerSession: StackLocalSession
  workerSummaries?: readonly StackSessionSummary[]
  workerTargetId?: string
  onOutput?: (chunk: string) => void
}

export async function runGardenerChatTurn(input: GardenerChatTurnInput): Promise<string | undefined> {
  const sessionPath = join(input.config.sessionLogDir, `${input.gardenerThreadId}.json`)
  const gardenerSession = await readSessionLog(sessionPath)

  const gardenerConfig = loadGardenerConfig(input.config.stackDataRoot)
  const synthProvider = synthGardenerProvider(gardenerConfig)
  if (synthProvider) {
    const turn = await runSynthGardenerChatTurn(input, gardenerConfig, synthProvider)
    gardenerSession.turns.push(turn)
    await writeSessionLog(gardenerSession, input.config.sessionLogDir, {
      codexModel: gardenerConfig.model.model,
      pricingRows: input.config.codexPricing,
    })
    const response = turn.stdout.trim()
    if (response) {
      appendGardenerChatMessage(input.config.stackDataRoot, input.gardenerThreadId, "gardener", response)
    }
    return response || undefined
  }

  const workerHarness = snapshotWorkerHarness(input.config)
  applyGardenerHarnessToConfig(input.config, gardenerConfig)
  try {
    const turn = await runCodexTurn({
      config: input.config,
      userPrompt: await buildGardenerChatPrompt(input.userMessage, input, gardenerConfig),
      selectedFiles: [],
      priorTurns: gardenerSession.turns,
      imagePaths: input.imagePaths,
      actorRole: "gardener",
      onOutput: input.onOutput ?? (() => undefined),
    })
    gardenerSession.turns.push(turn)
    await writeSessionLog(gardenerSession, input.config.sessionLogDir, {
      codexModel: gardenerConfig.model.model,
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

async function runSynthGardenerChatTurn(
  input: GardenerChatTurnInput,
  gardenerConfig: StackGardenerConfig,
  synthProvider: "synth_aux" | "synth_inference",
): Promise<StackCodexTurn> {
  const startedAt = new Date().toISOString()
  const prompt = await buildGardenerChatPrompt(input.userMessage, input, gardenerConfig, { directSynth: true })
  const result = await runSynthResponsesTurn({
    stackConfig: input.config,
    route: synthProvider === "synth_aux"
      ? "/api/v1/stack-aux/openai/v1/responses"
      : "/api/v1/stack-inference/openai/v1/responses",
    authError: `Synth gardener requires ${input.config.environment.authEnv}; local worker remains Codex/BYOK`,
    roleHeader: "gardener",
    model: gardenerConfig.model.model,
    prompt,
    maxOutputTokens: 900,
    metadata: {
      thread_id: input.gardenerThreadId,
      stack_thread_id: input.gardenerThreadId,
      actor_role: "gardener",
      actor_id: gardenerConfig.id,
      worker_thread_id: input.workerSession.id,
      worker_target_id: input.workerTargetId,
      source: "stack_gardener",
    },
    timeoutEnv: synthProvider === "synth_aux"
      ? "STACK_GARDENER_SYNTH_AUX_TIMEOUT_MS"
      : "STACK_GARDENER_SYNTH_INFERENCE_TIMEOUT_MS",
    defaultTimeoutMs: synthProvider === "synth_aux" ? 120_000 : 180_000,
    failurePrefix: synthProvider === "synth_aux"
      ? "Synth aux gardener request failed"
      : "Synth inference gardener request failed",
  })
  const response = result.assistantText?.trim()
  if (!response) {
    throw new Error("Synth gardener completed without an assistant message")
  }
  input.onOutput?.(`${response}\n`)
  return {
    id: randomUUID(),
    prompt,
    selectedPaths: [],
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    usage: result.usage,
    stdout: response,
    stderr: "",
  }
}

async function buildGardenerChatPrompt(
  message: string,
  input: GardenerChatTurnInput,
  gardenerConfig: StackGardenerConfig,
  options?: { directSynth?: boolean },
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
  const localModelLines = localModelRuntimeFacts(input.config)
  const metaThreadLines = await liveMetaThreadLines(input.config.stackDataRoot)
  const handoffLines = gardenerWorkerHandoffLines(input.config.stackDataRoot, input.gardenerThreadId)
  return [
    systemPrompt,
    ...localModelLines,
    `Current gardener thread id: ${input.gardenerThreadId}. When you call stack_jesterky_launch, pass owner_actor_role="gardener" and owner_thread_id="${input.gardenerThreadId}" so the workflow is nested under this gardener.`,
    ...(options?.directSynth
      ? [
          "Runtime note: this gardener turn is running through direct Synth Responses chat, not the Codex app-server. Do not claim to call tools, mutate Stack state, or dispatch workers. Explicit route, steer, queue, skill register, and skill suggest commands are handled by Stack before this prompt.",
        ]
      : []),
    ...(target ? [`Default worker target for explicit routing: ${target}`] : []),
    ...(workerLines.length > 0 ? ["Live worker threads:", ...workerLines] : []),
    ...(metaThreadLines.length > 0 ? ["Live meta-threads:", ...metaThreadLines] : []),
    ...(handoffLines.length > 0 ? ["Worker lifecycle handoffs (durable):", ...handoffLines] : []),
    "",
    "Operator message:",
    message,
].join("\n")
}

function localModelRuntimeFacts(config: StackConfig): string[] {
  const gemini = localModelCapabilities(config).find((capability) => capability.model === "gemini-3.1-flash-lite")
  if (!gemini || gemini.credential_status !== "available") {
    return [
      "Runtime fact: Gemini local policy credentials are not available. Do not infer availability from a hosted catalog; report the safe local configuration step instead.",
    ]
  }
  return [
    "AUTHORITATIVE RUNTIME FACT: gemini-3.1-flash-lite is available for Stack's local GEPA/policy harness through GEMINI_API_KEY. This route is independent of stack_inference_catalog and does not require hosted Synth inference to be online.",
    "Historical worker or Effort text saying that Gemini requires restoring/authenticating the hosted owner catalog is stale for this local policy route. Do not repeat it as the current blocker. If reviewing that Effort, identify the old hosted-route blocker as superseded and use the local policy/harness path for the next safe action.",
    "Boundary: Gemini remains policy/benchmark-only, not a Codex gardener or worker model. Never change the Codex model to Gemini or claim the local policy capability proves a hosted route.",
  ]
}

function gardenerWorkerHandoffLines(stackRoot: string, gardenerThreadId: string, limit = 8): string[] {
  return readThreadMetaEvents(stackRoot, gardenerThreadId)
    .filter((event) => event.type === "gardener.worker_run_status")
    .slice(-limit)
    .map((event) => {
      const payload = event.payload
      const worker = payloadString(payload, "worker_title") ?? payloadString(payload, "worker_thread_id")?.slice(0, 8) ?? "worker"
      const status = payloadString(payload, "status") ?? "updated"
      const reason = payloadString(payload, "error") ?? payloadString(payload, "reason")
      const completed = payload.completed_turns
      const max = payload.max_turns
      const turns = typeof completed === "number" && typeof max === "number" ? ` · ${completed}/${max} turns` : ""
      return `- ${event.observed_at.slice(0, 19).replace("T", " ")} · ${worker} · ${status}${turns}${reason ? ` · ${truncateOneLine(reason, 72)}` : ""}`
    })
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function synthGardenerProvider(config: StackGardenerConfig): "synth_aux" | "synth_inference" | undefined {
  const provider = config.model.provider.trim().toLowerCase()
  if (provider === "synth_aux" || provider === "synth_inference") return provider
  return undefined
}

async function liveMetaThreadLines(stackDataRoot: string): Promise<string[]> {
  const manifests = await readMetaThreadManifests(stackDataRoot, "live")
  return manifests.slice(0, 8).map((manifest) => {
    const goal = manifest.active_goal
    const goalLabel = goal?.objective?.trim()
      ? `goal ${goal.status || "active"}`
      : "no goal"
    const profile = manifest.monitor_profile ? ` · monitor ${manifest.monitor_profile}` : ""
    const headline = monitorHeadlineLine(manifest.monitor_headline)
    const monitor = headline ? ` · sidecar ${headline}` : profile
    return `- ${manifest.id.slice(0, 10)} · ${truncateOneLine(manifest.title, 48)} · ${goalLabel} · head ${manifest.head_thread_id.slice(0, 8)}${monitor}`
  })
}

function monitorHeadlineLine(headline: { status?: string; headline?: string; note?: string } | undefined): string | undefined {
  if (!headline) return undefined
  const status = headline.status?.trim() ? headline.status.trim().replace(/_/g, " ") : "update"
  const label = headline.headline?.trim() || headline.note?.trim() || "monitor update"
  return truncateOneLine(`${status}: ${label}`, 72)
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
