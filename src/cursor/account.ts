import { CursorAcpClient, cursorAcpArgs } from "./acp-client.js"
import type { StackConfig } from "../config.js"

export type CursorAccountSnapshot = {
  email?: string
  subscriptionTier?: string
  modelLabel?: string
  authenticated: boolean
  checkedAt: string
}

export async function readCursorAccountSnapshot(
  cursorCommand = "cursor",
): Promise<CursorAccountSnapshot> {
  const checkedAt = new Date().toISOString()
  const [status, about] = await Promise.all([
    runCursorJson([cursorCommand, "agent", "status", "--format", "json"]),
    runCursorJson([cursorCommand, "agent", "about", "--format", "json"]),
  ])
  const statusRecord = asRecord(status)
  const aboutRecord = asRecord(about)
  const userInfo = asRecord(statusRecord?.userInfo)
  return {
    email: readString(userInfo?.email) ?? readString(aboutRecord?.userEmail),
    subscriptionTier: readString(aboutRecord?.subscriptionTier),
    modelLabel: readString(aboutRecord?.model),
    authenticated: statusRecord?.isAuthenticated === true || statusRecord?.status === "authenticated",
    checkedAt,
  }
}

export function formatCursorBudgetSuffix(
  authPlan: string,
  account?: CursorAccountSnapshot,
  configuredModel?: string,
): string | undefined {
  if (!account?.authenticated) return "login required"
  const parts: string[] = []
  const model = configuredModel ?? account.modelLabel
  if (model) parts.push(model)
  if (account.subscriptionTier) parts.push(account.subscriptionTier)
  return parts.length > 0 ? parts.join(" · ") : authPlan
}

export function isCursorAuthPlan(authPlan: string): boolean {
  return authPlan.toLowerCase().includes("cursor")
}

export async function probeCursorHarnessAvailability(config: StackConfig): Promise<boolean> {
  const { probeCursorAcpAvailability } = await import("./acp-client.js")
  return probeCursorAcpAvailability({
    command: config.cursorCommand,
    args: cursorAcpArgs(),
    cwd: config.workspaceRoot,
  })
}

async function runCursorJson(command: string[]): Promise<unknown> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (exitCode !== 0) return undefined
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
