import { stackdRecordTelemetryEvent } from "../client/stackd.js"
import { readCodexAccountSnapshot } from "../codex/account.js"
import { stackChannel, stackVersion } from "../version.js"

// Activation-funnel sensors (see .jstack/product/specs/stack_activation_funnel.md).
// Emission is best-effort and opt-in-gated server-side by stackd's telemetry
// handler — it must never delay or break the cockpit.

function targetTriple(): string {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  if (process.platform === "darwin") return `${arch}-apple-darwin`
  if (process.platform === "linux") return `${arch}-unknown-linux-musl`
  return `${arch}-${process.platform}`
}

export async function emitFunnelEvent(
  name: string,
  payload: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  try {
    await stackdRecordTelemetryEvent({
      name,
      payload: { channel: stackChannel(), version: stackVersion(), target: targetTriple(), ...payload },
    })
  } catch {
    // Telemetry is best-effort; swallow all errors (stackd down, opted out, etc.).
  }
}

// Emit the per-session funnel sensors: which agent backend is configured, the
// auth signals, and session start. Detection is read-only (never copies tokens).
export async function emitSessionFunnel(): Promise<void> {
  const account = await readCodexAccountSnapshot().catch(() => undefined)
  const authMode = account?.authMode ?? "missing"
  const codexAuthed = authMode !== "missing" && authMode !== "unknown"
  const hasSynthAuth = Boolean(process.env.SYNTH_API_KEY?.trim())
  const agentBackend = codexAuthed ? "codex" : hasSynthAuth ? "synth_nemotron" : "none"

  await emitFunnelEvent("stack_session_started", { agent_backend: agentBackend, has_synth_auth: hasSynthAuth })
  if (codexAuthed) {
    await emitFunnelEvent("stack_codex_authenticated", { auth_mode: authMode })
    await emitFunnelEvent("stack_agent_backend_configured", { backend: "codex", detected_via: "codex_auth_json" })
  } else if (hasSynthAuth) {
    await emitFunnelEvent("stack_agent_backend_configured", { backend: "synth_nemotron", detected_via: "synth_api_key" })
  }
  if (hasSynthAuth) {
    await emitFunnelEvent("stack_synth_authenticated", { environment: "configured", org_present: false })
  }
}

// The activation moment: the first agent turn of the process. Fires at most once.
let firstTurnEmitted = false
export async function emitFirstAgentTurn(agentBackend = "codex"): Promise<void> {
  if (firstTurnEmitted) return
  firstTurnEmitted = true
  await emitFunnelEvent("stack_first_agent_turn", { agent_backend: agentBackend })
}

// Repeat-usage signal: an optimizer run kicked off.
export async function emitOptimizerRunStarted(optimizer: string, mode: string): Promise<void> {
  await emitFunnelEvent("stack_optimizer_run_started", { optimizer, mode })
}

// Advanced tier (approval-gated server-side): coarse session length at exit.
const sessionStartedAtMs = Date.now()

function sessionDurationBucket(): string {
  const minutes = (Date.now() - sessionStartedAtMs) / 60_000
  if (minutes < 5) return "under_5m"
  if (minutes < 30) return "5m_30m"
  if (minutes < 60) return "30m_1h"
  if (minutes < 240) return "1h_4h"
  return "over_4h"
}

let sessionEndedEmitted = false
export async function emitSessionEnded(): Promise<void> {
  if (sessionEndedEmitted) return
  sessionEndedEmitted = true
  await emitFunnelEvent("stack_session_ended", { duration_bucket: sessionDurationBucket() })
}

// Advanced tier: feature adoption. feature_id must be in the contract enum; the
// stackd gate refuses anything else. Fires at most once per feature per session.
const emittedFeatures = new Set<string>()
export async function emitFeatureUsed(featureId: string): Promise<void> {
  if (emittedFeatures.has(featureId)) return
  emittedFeatures.add(featureId)
  await emitFunnelEvent("stack_feature_used", { feature_id: featureId })
}
