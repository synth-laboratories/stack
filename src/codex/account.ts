import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { defaultCodexHome } from "./agent-context.js"

export type CodexAccountSnapshot = {
  authMode: string
  email?: string
  accountId?: string
  lastRefresh?: string
  checkedAt: string
}

type CodexAuthJson = {
  auth_mode?: string
  last_refresh?: string
  tokens?: {
    id_token?: string
    account_id?: string
  }
}

export async function readCodexAccountSnapshot(codexHome = defaultCodexHome()): Promise<CodexAccountSnapshot> {
  const checkedAt = new Date().toISOString()
  try {
    const parsed = JSON.parse(await readFile(join(codexHome, "auth.json"), "utf8")) as CodexAuthJson
    const authMode = typeof parsed.auth_mode === "string" && parsed.auth_mode.trim() ? parsed.auth_mode.trim() : "unknown"
    const accountId = readOptionalString(parsed.tokens?.account_id)
    const email =
      authMode === "chatgpt" && typeof parsed.tokens?.id_token === "string"
        ? readEmailFromIdToken(parsed.tokens.id_token)
        : undefined
    return {
      authMode,
      email,
      accountId,
      lastRefresh: readOptionalString(parsed.last_refresh),
      checkedAt,
    }
  } catch {
    return { authMode: "missing", checkedAt }
  }
}

export async function readCodexAccountEmail(codexHome = defaultCodexHome()): Promise<string | undefined> {
  return (await readCodexAccountSnapshot(codexHome)).email
}

export function readEmailFromIdToken(idToken: string): string | undefined {
  const parts = idToken.split(".")
  if (parts.length < 2) return undefined
  try {
    const payload = parts[1]
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4)
    const claims = JSON.parse(Buffer.from(padded, "base64url").toString("utf8")) as { email?: string }
    return typeof claims.email === "string" && claims.email.includes("@") ? claims.email.trim() : undefined
  } catch {
    return undefined
  }
}

export function isChatGptAuthPlan(authPlan: string): boolean {
  return authPlan.toLowerCase().includes("chatgpt")
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}
