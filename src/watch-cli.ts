import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { StackConfig } from "./config.js"
import {
  readHostedOptimizerRunEvents,
  readHostedOptimizerRunWatchFrame,
  type HostedOptimizerRunEvent,
  type HostedOptimizerRunWatchFrame,
} from "./remote/optimizers.js"
import { readRemoteInferenceUsage } from "./remote/inference-usage.js"
import { hostedRunWatchLines } from "./tui/hosted-watch.js"
import { emitFeatureUsed } from "./telemetry/funnel.js"

const DEFAULT_INTERVAL_SECONDS = 10
const MIN_INTERVAL_SECONDS = 2
const MAX_INTERVAL_SECONDS = 300
const DEFAULT_MAX_MINUTES = 720
const USAGE_REFRESH_SECONDS = 60

type WatchEvidenceFrame = {
  checked_at: string
  terminal: boolean
  status: string
  phase: string | null
  rollout_count: number | null
  heldout_reward: number | null
  train_reward: number | null
  best_candidate_id: string | null
  cost_usd: number | null
  total_tokens: number | null
  org_spend_today_usd: number | null
  artifact_names: string[]
  latest_event_seq: number | null
  lines: string[]
}

export async function runWatchCli(config: StackConfig, argv: string[]): Promise<number> {
  const args = argv.slice(1)
  const runId = args.find((arg) => !arg.startsWith("--"))
  if (!runId || args.includes("--help") || args.includes("-h")) {
    printWatchHelp()
    return runId ? 0 : 2
  }
  const json = args.includes("--json")
  const once = args.includes("--once")
  const replay = args.includes("--replay")
  const writeEvidence = !args.includes("--no-evidence")
  const intervalSeconds = clampNumber(
    readNumericFlag(args, "--interval") ?? DEFAULT_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS,
    MAX_INTERVAL_SECONDS,
  )
  const maxMinutes = clampNumber(readNumericFlag(args, "--max-minutes") ?? DEFAULT_MAX_MINUTES, 1, 7 * 24 * 60)

  void emitFeatureUsed("hosted_ops")
  const startedAt = new Date().toISOString()
  const frames: WatchEvidenceFrame[] = []
  const replayEvents: HostedOptimizerRunEvent[] = []
  let orgSpendTodayUsd: number | undefined
  let usageCheckedAtMs = 0
  let notified = false

  try {
    if (replay) {
      replayEvents.push(...(await readHostedOptimizerRunEvents(config, runId)))
      if (!json) {
        console.log(`replaying ${replayEvents.length} hosted optimizer events for ${runId} (${config.environmentName})`)
        for (const line of replayTimelineLines(replayEvents)) console.log(`  ${line}`)
      }
    }

    const deadline = Date.now() + maxMinutes * 60_000
    let frame: HostedOptimizerRunWatchFrame | undefined
    while (true) {
      if (Date.now() - usageCheckedAtMs > USAGE_REFRESH_SECONDS * 1000) {
        orgSpendTodayUsd = await readOrgSpendTodayUsd(config)
        usageCheckedAtMs = Date.now()
      }
      frame = await readHostedOptimizerRunWatchFrame(config, runId)
      const lines = hostedRunWatchLines(frame.run, frame.detail, orgSpendTodayUsd)
      frames.push(evidenceFrame(frame, orgSpendTodayUsd, lines))
      if (!json) {
        console.log(`[${frame.checkedAt}] frame ${frames.length}`)
        for (const line of lines) console.log(`  ${line}`)
      }
      if (frame.terminal) {
        notified = true
        if (!json) {
          process.stdout.write("\u0007")
          console.log(`terminal: hosted optimizer run ${runId} finished with status ${frame.run.status}`)
        }
        break
      }
      if (once) break
      if (Date.now() >= deadline) {
        if (!json) console.error(`watch timed out after ${maxMinutes} minutes without a terminal status`)
        break
      }
      await sleep(intervalSeconds * 1000)
    }

    const evidencePath = writeEvidence
      ? writeWatchEvidence(config, {
          runId,
          mode: replay ? "replay" : once ? "once" : "poll",
          startedAt,
          frames,
          replayEventCount: replay ? replayEvents.length : undefined,
          replayTimeline: replay ? replayTimelineLines(replayEvents) : undefined,
          terminalStatus: frame?.terminal ? frame.run.status : undefined,
          notified,
        })
      : undefined

    if (json) {
      console.log(
        JSON.stringify(
          {
            run_id: runId,
            environment: config.environmentName,
            api_base_url: config.environment.apiBaseUrl,
            mode: replay ? "replay" : once ? "once" : "poll",
            terminal: frame?.terminal ?? false,
            terminal_status: frame?.terminal ? frame.run.status : null,
            frame_count: frames.length,
            frames,
            ...(replay ? { replay_event_count: replayEvents.length, replay_timeline: replayTimelineLines(replayEvents) } : {}),
            evidence_path: evidencePath ?? null,
          },
          null,
          2,
        ),
      )
    } else if (evidencePath) {
      console.log(`evidence: ${evidencePath}`)
    }
    return frame?.terminal || once || replay ? 0 : 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`stack watch failed: ${message}`)
    if (message.includes("not set")) console.error("connect: stack auth open signin")
    return 1
  }
}

// Fold the historical event feed into the same lifecycle the live panel walks,
// so a terminal run still demonstrates start -> progress -> terminal tracking.
function replayTimelineLines(events: HostedOptimizerRunEvent[]): string[] {
  const lines: string[] = []
  let rolloutFrames = 0
  for (const event of events) {
    const type = event.eventType ?? ""
    if (/rollout|sensor_frame/i.test(type)) {
      rolloutFrames += 1
      continue
    }
    if (!/started|finished|completed|candidate|frontier|checkpoint|persisted|terminal|failed|cancel/i.test(type)) continue
    const details: string[] = []
    for (const key of ["state", "rollout_count", "heldout_reward", "best_candidate_id", "candidate_count"]) {
      const value = event.fields?.[key]
      if (value !== undefined && value !== null && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
        details.push(`${key}=${value}`)
      }
    }
    lines.push(`seq ${event.seq ?? "-"} · ${type}${details.length ? ` · ${details.join(" ")}` : ""}`)
  }
  if (rolloutFrames > 0) lines.push(`(+${rolloutFrames} rollout/sensor-frame events)`)
  return lines
}

function evidenceFrame(
  frame: HostedOptimizerRunWatchFrame,
  orgSpendTodayUsd: number | undefined,
  lines: string[],
): WatchEvidenceFrame {
  return {
    checked_at: frame.checkedAt,
    terminal: frame.terminal,
    status: frame.run.status,
    phase: frame.detail.phase ?? null,
    rollout_count: frame.detail.rolloutCount ?? null,
    heldout_reward: frame.detail.heldoutReward ?? null,
    train_reward: frame.detail.trainReward ?? null,
    best_candidate_id: frame.detail.bestCandidateId ?? null,
    cost_usd: frame.detail.costUsd ?? null,
    total_tokens: frame.detail.totalTokens ?? null,
    org_spend_today_usd: orgSpendTodayUsd ?? null,
    artifact_names: frame.detail.artifactNames,
    latest_event_seq: frame.detail.latestEventSeq ?? null,
    lines,
  }
}

function writeWatchEvidence(
  config: StackConfig,
  evidence: {
    runId: string
    mode: "poll" | "once" | "replay"
    startedAt: string
    frames: WatchEvidenceFrame[]
    replayEventCount?: number
    replayTimeline?: string[]
    terminalStatus?: string
    notified: boolean
  },
): string {
  const dir = join(config.stackDataRoot, ".stack", "evidence", "watch")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${safePathSegment(evidence.runId)}-${timestampForPath()}.json`)
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schema_version: "stack.watch.evidence.v1",
        run_id: evidence.runId,
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        mode: evidence.mode,
        started_at: evidence.startedAt,
        finished_at: new Date().toISOString(),
        terminal_status: evidence.terminalStatus ?? null,
        notified: evidence.notified,
        frame_count: evidence.frames.length,
        frames: evidence.frames,
        ...(evidence.replayEventCount !== undefined ? { replay_event_count: evidence.replayEventCount } : {}),
        ...(evidence.replayTimeline ? { replay_timeline: evidence.replayTimeline } : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  return path
}

async function readOrgSpendTodayUsd(config: StackConfig): Promise<number | undefined> {
  try {
    const usage = await readRemoteInferenceUsage(config)
    return usage.spendTodayUsd
  } catch {
    return undefined
  }
}

function printWatchHelp(): void {
  console.log("Usage:")
  console.log("  stack watch <run-id> [--interval <seconds>] [--max-minutes <n>] [--once] [--replay] [--json] [--no-evidence]")
  console.log("")
  console.log("Watches a hosted optimizer run until it reaches a terminal status: phase, rollouts,")
  console.log("best score, cost, artifacts as they land, and a terminal notification. --once reads a")
  console.log("single frame; --replay folds the recorded event feed into the same lifecycle first.")
  console.log("Evidence lands under .stack/evidence/watch/ unless --no-evidence is set.")
}

function readNumericFlag(args: string[], flag: string): number | undefined {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const raw = args[index + 1]
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  if (!Number.isFinite(parsed)) throw new Error(`${flag} requires a numeric value`)
  return parsed
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned || "run"
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
