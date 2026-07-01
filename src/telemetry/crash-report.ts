import { randomUUID } from "node:crypto"
import { stackdRecordCrashReport } from "../client/stackd.js"
import { stackChannel, stackVersion } from "../version.js"
import {
  findStackCrashArtifacts,
  primaryCrashClass,
  sanitizeCrashMessage,
} from "./crash-artifacts.js"

export type CrashRuntimeContext = {
  surface?: string
  goalMode?: boolean
  monitorEnabled?: boolean
  sidecarView?: string
  terminalRows?: number
  terminalCols?: number
  focusMode?: string
  environment?: string
}

let runtimeContext: CrashRuntimeContext = {}
let lastClientEventId: string | undefined

function targetTriple(): string {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  if (process.platform === "darwin") return `${arch}-apple-darwin`
  if (process.platform === "linux") return `${arch}-unknown-linux-musl`
  return `${arch}-${process.platform}`
}

function crashReportingDisabled(): boolean {
  const raw = process.env.STACK_CRASH_REPORT?.trim().toLowerCase()
  return raw === "0" || raw === "false" || raw === "off" || raw === "no"
}

export function setCrashRuntimeContext(context: Partial<CrashRuntimeContext>): void {
  runtimeContext = { ...runtimeContext, ...context }
}

export function crashRuntimeContext(): CrashRuntimeContext {
  return { ...runtimeContext }
}

function readTerminalSize(): { rows?: number; cols?: number } {
  const rows = process.stdout.rows
  const cols = process.stdout.columns
  return {
    rows: typeof rows === "number" && rows > 0 ? rows : runtimeContext.terminalRows,
    cols: typeof cols === "number" && cols > 0 ? cols : runtimeContext.terminalCols,
  }
}

function buildMetadata(error: unknown): Record<string, string | number | boolean | null> {
  const size = readTerminalSize()
  return {
    goal_mode: runtimeContext.goalMode ?? false,
    monitor_enabled: runtimeContext.monitorEnabled ?? false,
    sidecar_view: runtimeContext.sidecarView ?? null,
    focus_mode: runtimeContext.focusMode ?? null,
    environment: runtimeContext.environment ?? null,
    terminal_rows: size.rows ?? null,
    terminal_cols: size.cols ?? null,
    platform: process.platform,
    arch: process.arch,
  }
}

export async function reportStackCrash(error: unknown, surface = runtimeContext.surface ?? "tui"): Promise<void> {
  if (crashReportingDisabled()) return

  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : typeof error === "string"
        ? error
        : String(error)
  const artifacts = findStackCrashArtifacts(text)
  const crashClass = primaryCrashClass(artifacts)
  const message = sanitizeCrashMessage(error instanceof Error ? error.message : text)
  const clientEventId = lastClientEventId ?? randomUUID()
  lastClientEventId = clientEventId

  try {
    await Promise.race([
      stackdRecordCrashReport({
        client_event_id: clientEventId,
        observed_at: new Date().toISOString(),
        crash_class: crashClass,
        surface,
        message,
        version: stackVersion(),
        channel: stackChannel(),
        target: targetTriple(),
        metadata: buildMetadata(error),
      }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ])
  } catch {
    // Crash reporting is best-effort and must never recurse into another fatal.
  }
}
