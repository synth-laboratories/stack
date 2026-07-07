import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { readCodexAccountSnapshot, readCodexAuthFileSnapshot, type CodexAccountSnapshot } from "./account.js"
import { personalCodexHome } from "./isolation.js"

export const CODEX_ACCOUNTS_SCHEMA_VERSION = "stack.codex_accounts.v1" as const

export type CodexAccountSource = "isolated" | "personal" | "profile"

export type CodexAccountStatus = "active" | "stale" | "revoked" | "unknown"

export type CodexAccountRecord = {
  account_id: string
  email?: string
  auth_mode: string
  label: string
  first_seen_at: string
  last_seen_at: string
  last_refresh?: string
  status: CodexAccountStatus
  sources: CodexAccountSource[]
  profile_slug?: string
}

export type CodexAccountsRegistry = {
  schema_version: typeof CODEX_ACCOUNTS_SCHEMA_VERSION
  active_account_id?: string
  updated_at: string
  accounts: CodexAccountRecord[]
}

export function codexAccountsRegistryPath(stackRoot: string): string {
  return join(stackRoot, ".stack", "codex", "accounts.json")
}

export function readCodexAccountsRegistry(stackRoot: string): CodexAccountsRegistry {
  const path = codexAccountsRegistryPath(stackRoot)
  if (!existsSync(path)) return emptyRegistry()
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CodexAccountsRegistry
    if (parsed?.schema_version !== CODEX_ACCOUNTS_SCHEMA_VERSION || !Array.isArray(parsed.accounts)) {
      return emptyRegistry()
    }
    return parsed
  } catch {
    return emptyRegistry()
  }
}

export function writeCodexAccountsRegistry(stackRoot: string, registry: CodexAccountsRegistry): void {
  const path = codexAccountsRegistryPath(stackRoot)
  mkdirSync(join(stackRoot, ".stack", "codex"), { recursive: true })
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8")
}

export function upsertCodexAccountObservation(input: {
  stackRoot: string
  account: CodexAccountSnapshot
  source: CodexAccountSource
  profileSlug?: string
  status?: CodexAccountStatus
  setActive?: boolean
}): CodexAccountsRegistry {
  const registry = readCodexAccountsRegistry(input.stackRoot)
  const now = new Date().toISOString()
  const accountId = resolveAccountId(input.account)
  const label = input.account.email ?? accountId.slice(0, 12)
  const existing = registry.accounts.find((entry) => entry.account_id === accountId)
  const sources = mergeSources(existing?.sources ?? [], input.source)
  const next: CodexAccountRecord = {
    account_id: accountId,
    email: input.account.email,
    auth_mode: input.account.authMode,
    label,
    first_seen_at: existing?.first_seen_at ?? now,
    last_seen_at: now,
    last_refresh: input.account.lastRefresh ?? existing?.last_refresh,
    status: input.status ?? existing?.status ?? "unknown",
    sources,
    ...(input.profileSlug ? { profile_slug: input.profileSlug } : existing?.profile_slug ? { profile_slug: existing.profile_slug } : {}),
  }
  const accounts = existing
    ? registry.accounts.map((entry) => (entry.account_id === accountId ? next : entry))
    : [...registry.accounts, next]
  const updated: CodexAccountsRegistry = {
    schema_version: CODEX_ACCOUNTS_SCHEMA_VERSION,
    active_account_id: input.setActive ? accountId : registry.active_account_id,
    updated_at: now,
    accounts,
  }
  writeCodexAccountsRegistry(input.stackRoot, updated)
  return updated
}

export function setActiveCodexAccount(stackRoot: string, accountId: string): CodexAccountsRegistry {
  const registry = readCodexAccountsRegistry(stackRoot)
  if (!registry.accounts.some((entry) => entry.account_id === accountId)) {
    throw new Error(`unknown codex account: ${accountId}`)
  }
  const updated: CodexAccountsRegistry = {
    ...registry,
    active_account_id: accountId,
    updated_at: new Date().toISOString(),
    accounts: registry.accounts.map((entry) =>
      entry.account_id === accountId
        ? { ...entry, status: "active", last_seen_at: new Date().toISOString() }
        : entry.status === "active"
          ? { ...entry, status: "stale" }
          : entry,
    ),
  }
  writeCodexAccountsRegistry(stackRoot, updated)
  return updated
}

export function markCodexAccountRevoked(stackRoot: string, accountId?: string): CodexAccountsRegistry {
  const registry = readCodexAccountsRegistry(stackRoot)
  const targetId = accountId ?? registry.active_account_id
  if (!targetId) return registry
  const updated: CodexAccountsRegistry = {
    ...registry,
    active_account_id: registry.active_account_id === targetId ? undefined : registry.active_account_id,
    updated_at: new Date().toISOString(),
    accounts: registry.accounts.map((entry) =>
      entry.account_id === targetId ? { ...entry, status: "revoked", last_seen_at: new Date().toISOString() } : entry,
    ),
  }
  writeCodexAccountsRegistry(stackRoot, updated)
  return updated
}

export async function scanPersonalCodexProfileAccounts(
  personalHome = personalCodexHome(),
): Promise<CodexAccountRecord[]> {
  const profilesDir = join(personalHome, "profiles")
  if (!existsSync(profilesDir)) return []
  const now = new Date().toISOString()
  const records: CodexAccountRecord[] = []
  for (const name of readdirSync(profilesDir)) {
    if (!name.endsWith(".json")) continue
    const profileSlug = basename(name, ".json")
    const profilePath = join(profilesDir, name)
    const snapshot = await readCodexAuthFileSnapshot(profilePath)
    if (snapshot.authMode === "missing") continue
    records.push({
      account_id: resolveAccountId(snapshot),
      email: snapshot.email,
      auth_mode: snapshot.authMode,
      label: snapshot.email ?? profileSlug,
      first_seen_at: now,
      last_seen_at: now,
      last_refresh: snapshot.lastRefresh,
      status: "unknown",
      sources: ["profile"],
      profile_slug: profileSlug,
    })
  }
  return records
}

export function mergeProfileScanIntoRegistry(
  stackRoot: string,
  scanned: CodexAccountRecord[],
): CodexAccountsRegistry {
  let registry = readCodexAccountsRegistry(stackRoot)
  for (const record of scanned) {
    registry = upsertCodexAccountObservation({
      stackRoot,
      account: {
        authMode: record.auth_mode,
        email: record.email,
        accountId: record.account_id,
        lastRefresh: record.last_refresh,
        checkedAt: record.last_seen_at,
      },
      source: "profile",
      profileSlug: record.profile_slug,
    })
  }
  return readCodexAccountsRegistry(stackRoot)
}

export function resolveCodexAccountSelector(
  registry: CodexAccountsRegistry,
  selector: string,
  personalHome = personalCodexHome(),
): { account: CodexAccountRecord; profilePath?: string } {
  const needle = selector.trim().toLowerCase()
  if (!needle) throw new Error("account selector required")

  const byEmail = registry.accounts.filter((entry) => entry.email?.toLowerCase() === needle)
  if (byEmail.length === 1) return { account: byEmail[0]! }

  const byEmailPartial = registry.accounts.filter((entry) => entry.email?.toLowerCase().includes(needle))
  if (byEmailPartial.length === 1) return { account: byEmailPartial[0]! }

  const byId = registry.accounts.filter(
    (entry) => entry.account_id.toLowerCase() === needle || entry.account_id.toLowerCase().startsWith(needle),
  )
  if (byId.length === 1) return { account: byId[0]! }

  const byProfile = registry.accounts.filter(
    (entry) => entry.profile_slug?.toLowerCase() === needle || entry.profile_slug?.toLowerCase().includes(needle),
  )
  if (byProfile.length === 1) {
    const slug = byProfile[0]!.profile_slug
    return {
      account: byProfile[0]!,
      profilePath: slug ? join(personalHome, "profiles", `${slug}.json`) : undefined,
    }
  }

  const profilePath = join(personalHome, "profiles", `${selector.trim()}.json`)
  if (existsSync(profilePath)) {
    const slug = basename(profilePath, ".json")
    const existing = registry.accounts.find((entry) => entry.profile_slug === slug)
    if (existing) return { account: existing, profilePath }
    throw new Error(`profile ${slug} found on disk but not in registry; run stack codex accounts scan`)
  }

  throw new Error(`no codex account matches ${selector}`)
}

function emptyRegistry(): CodexAccountsRegistry {
  return {
    schema_version: CODEX_ACCOUNTS_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    accounts: [],
  }
}

function resolveAccountId(account: CodexAccountSnapshot): string {
  if (account.accountId?.trim()) return account.accountId.trim()
  if (account.email?.trim()) return `email:${account.email.trim().toLowerCase()}`
  return "unknown:anonymous"
}

function mergeSources(existing: CodexAccountSource[], source: CodexAccountSource): CodexAccountSource[] {
  if (existing.includes(source)) return existing
  return [...existing, source]
}
