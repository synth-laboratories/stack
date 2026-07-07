import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { StackConfig } from "../config.js"
import {
  markCodexAccountRevoked,
  mergeProfileScanIntoRegistry,
  readCodexAccountsRegistry,
  resolveCodexAccountSelector,
  scanPersonalCodexProfileAccounts,
  setActiveCodexAccount,
  upsertCodexAccountObservation,
} from "./accounts-registry.js"
import { readCodexAuthFileSnapshot, type CodexAccountSnapshot } from "./account.js"
import { personalCodexHome, stackCodexEnv, type StackCodexIsolationConfig } from "./isolation.js"
import { readCodexRateLimitsFromAppServer } from "./rate-limits.js"

export type CodexAuthHomeSnapshot = CodexAccountSnapshot & {
  path: string
  present: boolean
}

export type CodexAuthStatus = {
  isolated: CodexAuthHomeSnapshot
  personal: CodexAuthHomeSnapshot
  active_account_id?: string
  drift: boolean
  stale: boolean
  healthy: boolean
  probe_error?: string
  registry_path: string
  auto_sync_recommended: boolean
}

export type CodexAuthSyncResult = {
  copied: boolean
  source_path: string
  target_path: string
  account: CodexAccountSnapshot
  reason: string
}

export type CodexAuthActivateResult = {
  account_id: string
  email?: string
  source_path: string
  target_path: string
}

function isolatedAuthPath(config: StackCodexIsolationConfig): string {
  return join(config.codexHome, "auth.json")
}

function personalAuthPath(personalHome = personalCodexHome()): string {
  return join(personalHome, "auth.json")
}

async function snapshotForAuthPath(path: string): Promise<CodexAuthHomeSnapshot> {
  const present = existsSync(path)
  const account = present ? await readCodexAuthFileSnapshot(path) : { authMode: "missing", checkedAt: new Date().toISOString() }
  return { ...account, path, present }
}

export async function readCodexAuthStatus(config: StackConfig, probe = true): Promise<CodexAuthStatus> {
  const personalHome = personalCodexHome()
  const isolatedPath = isolatedAuthPath(config)
  const personalPath = personalAuthPath(personalHome)
  const isolated = await snapshotForAuthPath(isolatedPath)
  const personal = await snapshotForAuthPath(personalPath)
  const registry = readCodexAccountsRegistry(config.stackDataRoot)
  const drift = authIdentityKey(isolated) !== authIdentityKey(personal) && personal.present
  const stale =
    !isolated.present ||
    isolated.authMode === "missing" ||
    isOlderRefresh(isolated.lastRefresh, personal.lastRefresh) ||
    drift

  let healthy = isolated.present && isolated.authMode !== "missing"
  let probe_error: string | undefined
  if (probe && healthy && config.codexIsolationMode !== "personal_dev_override") {
    try {
      await readCodexRateLimitsFromAppServer(config.codexCommand, config.codexArgs ?? [], stackCodexEnv(config))
    } catch (error) {
      healthy = false
      probe_error = error instanceof Error ? error.message : String(error)
    }
  }

  upsertCodexAccountObservation({
    stackRoot: config.stackDataRoot,
    account: isolated,
    source: "isolated",
    status: healthy ? "active" : stale ? "stale" : "unknown",
    setActive: true,
  })
  if (personal.present && personal.authMode !== "missing") {
    upsertCodexAccountObservation({
      stackRoot: config.stackDataRoot,
      account: personal,
      source: "personal",
    })
  }

  return {
    isolated,
    personal,
    active_account_id: registry.active_account_id,
    drift,
    stale,
    healthy,
    ...(probe_error ? { probe_error } : {}),
    registry_path: join(config.stackDataRoot, ".stack", "codex", "accounts.json"),
    auto_sync_recommended: stale || drift,
  }
}

export function syncCodexAuthToIsolatedHome(input: {
  config: StackConfig
  force?: boolean
  profileSlug?: string
  sourceAuthPath?: string
}): CodexAuthSyncResult {
  const targetPath = isolatedAuthPath(input.config)
  mkdirSync(input.config.codexHome, { recursive: true })

  let sourcePath = input.sourceAuthPath
  let reason = "manual"
  if (!sourcePath && input.profileSlug) {
    sourcePath = join(personalCodexHome(), "profiles", `${input.profileSlug}.json`)
    reason = `profile ${input.profileSlug}`
  }
  if (!sourcePath) {
    sourcePath = personalAuthPath()
    reason = "personal"
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`source auth missing: ${sourcePath}`)
  }

  const targetSnapshot = existsSync(targetPath) ? readCodexAuthFileSnapshotSync(targetPath) : undefined
  const sourceSnapshot = readCodexAuthFileSnapshotSync(sourcePath)
  const shouldCopy =
    input.force === true ||
    !targetSnapshot ||
    targetSnapshot.authMode === "missing" ||
    authIdentityKey(sourceSnapshot) !== authIdentityKey(targetSnapshot) ||
    isOlderRefresh(targetSnapshot.lastRefresh, sourceSnapshot.lastRefresh)

  if (!shouldCopy) {
    return {
      copied: false,
      source_path: sourcePath,
      target_path: targetPath,
      account: targetSnapshot ?? sourceSnapshot,
      reason: "already up to date",
    }
  }

  copyAuthFile(sourcePath, targetPath)
  upsertCodexAccountObservation({
    stackRoot: input.config.stackDataRoot,
    account: sourceSnapshot,
    source: input.profileSlug ? "profile" : sourcePath.includes("/profiles/") ? "profile" : "personal",
    profileSlug: input.profileSlug,
    status: "active",
    setActive: true,
  })
  setActiveCodexAccount(input.config.stackDataRoot, resolveAccountId(sourceSnapshot))

  return {
    copied: true,
    source_path: sourcePath,
    target_path: targetPath,
    account: sourceSnapshot,
    reason,
  }
}

export function maybeAutoSyncCodexAuth(config: StackConfig): CodexAuthSyncResult | undefined {
  if (process.env.STACK_CODEX_AUTO_SYNC === "0") return undefined
  if (config.codexIsolationMode === "personal_dev_override") return undefined
  try {
    const result = syncCodexAuthToIsolatedHome({ config })
    return result.copied ? result : undefined
  } catch {
    return undefined
  }
}

export async function activateCodexAccount(config: StackConfig, selector: string): Promise<CodexAuthActivateResult> {
  const registry = readCodexAccountsRegistry(config.stackDataRoot)
  const { account, profilePath } = resolveCodexAccountSelector(registry, selector)
  const sourcePath =
    profilePath ??
    (account.sources.includes("profile") && account.profile_slug
      ? join(personalCodexHome(), "profiles", `${account.profile_slug}.json`)
      : personalAuthPath())
  if (!existsSync(sourcePath)) {
    throw new Error(`auth file missing for ${selector}: ${sourcePath}`)
  }
  const sync = syncCodexAuthToIsolatedHome({
    config,
    force: true,
    sourceAuthPath: sourcePath,
    profileSlug: account.profile_slug,
  })
  setActiveCodexAccount(config.stackDataRoot, account.account_id)
  return {
    account_id: account.account_id,
    email: account.email,
    source_path: sync.source_path,
    target_path: sync.target_path,
  }
}

export function runCodexLogin(config: StackConfig, noBrowser = false): number {
  const env = stackCodexEnv(config)
  const args = ["login", ...(noBrowser ? ["--device-auth"] : [])]
  const result = spawnSync(config.codexCommand, args, {
    env,
    stdio: "inherit",
    encoding: "utf8",
  })
  if ((result.status ?? 1) !== 0) return result.status ?? 1
  const account = readCodexAuthFileSnapshotSync(isolatedAuthPath(config))
  upsertCodexAccountObservation({
    stackRoot: config.stackDataRoot,
    account,
    source: "isolated",
    status: "active",
    setActive: true,
  })
  setActiveCodexAccount(config.stackDataRoot, resolveAccountId(account))
  return 0
}

export function runCodexLogout(config: StackConfig): number {
  const env = stackCodexEnv(config)
  const before = existsSync(isolatedAuthPath(config))
    ? readCodexAuthFileSnapshotSync(isolatedAuthPath(config))
    : undefined
  const result = spawnSync(config.codexCommand, ["logout"], {
    env,
    stdio: "inherit",
    encoding: "utf8",
  })
  if (before) markCodexAccountRevoked(config.stackDataRoot, resolveAccountId(before))
  return result.status ?? 1
}

export async function scanCodexAccounts(config: StackConfig) {
  const scanned = await scanPersonalCodexProfileAccounts()
  return mergeProfileScanIntoRegistry(config.stackDataRoot, scanned)
}

function copyAuthFile(sourcePath: string, targetPath: string): void {
  copyFileSync(sourcePath, targetPath)
  try {
    chmodSync(targetPath, 0o600)
  } catch {
    // best effort
  }
}

function readCodexAuthFileSnapshotSync(authFilePath: string): CodexAccountSnapshot {
  const checkedAt = new Date().toISOString()
  try {
    const parsed = JSON.parse(readFileSync(authFilePath, "utf8")) as {
      auth_mode?: string
      last_refresh?: string
      tokens?: { id_token?: string; account_id?: string }
    }
    const authMode = typeof parsed.auth_mode === "string" && parsed.auth_mode.trim() ? parsed.auth_mode.trim() : "unknown"
    const accountId = typeof parsed.tokens?.account_id === "string" ? parsed.tokens.account_id.trim() : undefined
    let email: string | undefined
    if (authMode === "chatgpt" && typeof parsed.tokens?.id_token === "string") {
      const parts = parsed.tokens.id_token.split(".")
      if (parts.length >= 2) {
        try {
          const payload = parts[1]!
          const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4)
          const claims = JSON.parse(Buffer.from(padded, "base64url").toString("utf8")) as { email?: string }
          email = typeof claims.email === "string" && claims.email.includes("@") ? claims.email.trim() : undefined
        } catch {
          email = undefined
        }
      }
    }
    return {
      authMode,
      email,
      accountId,
      lastRefresh: typeof parsed.last_refresh === "string" ? parsed.last_refresh : undefined,
      checkedAt,
    }
  } catch {
    return { authMode: "missing", checkedAt }
  }
}

function authIdentityKey(snapshot: CodexAccountSnapshot): string {
  if (snapshot.accountId?.trim()) return `${snapshot.authMode}:${snapshot.accountId.trim()}`
  if (snapshot.email?.trim()) return `${snapshot.authMode}:${snapshot.email.trim().toLowerCase()}`
  return `${snapshot.authMode}:anonymous`
}

function resolveAccountId(account: CodexAccountSnapshot): string {
  if (account.accountId?.trim()) return account.accountId.trim()
  if (account.email?.trim()) return `email:${account.email.trim().toLowerCase()}`
  return "unknown:anonymous"
}

function isOlderRefresh(left?: string, right?: string): boolean {
  if (!right) return false
  if (!left) return true
  const leftMs = Date.parse(left)
  const rightMs = Date.parse(right)
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return false
  return leftMs < rightMs
}

export function formatCodexAuthStatusLines(status: CodexAuthStatus): string[] {
  const lines = [
    `isolated ${status.isolated.email ?? status.isolated.authMode}${status.isolated.last_refresh ? ` · refreshed ${status.isolated.last_refresh}` : ""}`,
    `personal ${status.personal.email ?? status.personal.authMode}${status.personal.last_refresh ? ` · refreshed ${status.personal.last_refresh}` : ""}`,
    `drift ${status.drift ? "yes" : "no"} · stale ${status.stale ? "yes" : "no"} · healthy ${status.healthy ? "yes" : "no"}`,
    status.isolated.path,
  ]
  if (status.probe_error) lines.push(`probe ${status.probe_error}`)
  if (status.auto_sync_recommended) lines.push("hint: stack codex sync")
  return lines
}

export function codexAuthAttentionLabel(status: Pick<CodexAuthStatus, "healthy" | "stale" | "drift">): string | undefined {
  if (status.healthy && !status.stale && !status.drift) return undefined
  if (!status.healthy) return "auth expired · stack codex login"
  if (status.drift || status.stale) return "auth stale · stack codex sync"
  return undefined
}
