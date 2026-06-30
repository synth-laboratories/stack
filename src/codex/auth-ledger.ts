import { createHash, randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CodexAccountSnapshot } from "./account.js"
import { formatCodexBudgetSuffix, type CodexRateLimitsSnapshot } from "./rate-limits.js"

export type CodexAuthLedgerEventType =
  | "codex.auth.signin"
  | "codex.auth.signout"
  | "codex.auth.session"
  | "codex.usage.updated"

export type CodexAuthLedgerRateLimits = {
  plan_type?: string
  rate_limit_reached?: string
  primary?: CodexRateLimitWindowRecord
  secondary?: CodexRateLimitWindowRecord
  budget_summary?: string
}

export type CodexAuthLedgerEvent = {
  event_id: string
  type: CodexAuthLedgerEventType
  observed_at: string
  auth_mode: string
  auth_plan: string
  email?: string
  account_id?: string
  identity_key: string
  stack_session_id?: string
  last_refresh?: string
  rate_limits?: CodexAuthLedgerRateLimits
  previous_identity_key?: string
  previous_email?: string
  previous_account_id?: string
}

type CodexRateLimitWindowRecord = {
  used_percent: number
  window_minutes: number
  remaining_percent: number
  resets_at?: number
}

type CodexAuthLedgerState = {
  identity_key?: string
  email?: string
  account_id?: string
  auth_mode?: string
  last_refresh?: string
  last_usage_fingerprint?: string
  last_observed_at?: string
  last_stack_session_id?: string
  last_rate_limits?: CodexAuthLedgerRateLimits
}

export function codexAuthLedgerPath(stackRoot: string): string {
  return join(stackRoot, ".stack", "codex", "auth_ledger.jsonl")
}

export function recordCodexAuthObservation(input: {
  stackRoot: string
  stackSessionId?: string
  authPlan: string
  account: CodexAccountSnapshot
  rateLimits?: CodexRateLimitsSnapshot
  forceSession?: boolean
}): CodexAuthLedgerEvent[] {
  const state = readLedgerState(input.stackRoot)
  const now = new Date().toISOString()
  const identityKey = buildIdentityKey(input.account)
  const events: CodexAuthLedgerEvent[] = []
  const serializedLimits = serializeRateLimits(input.authPlan, input.rateLimits)
  const usageFingerprint = usageFingerprintFor(serializedLimits)

  if (state.identity_key && state.identity_key !== identityKey) {
    events.push(
      buildEvent({
        type: "codex.auth.signout",
        observedAt: now,
        authPlan: input.authPlan,
        account: accountFromState(state),
        identityKey: state.identity_key,
        stackSessionId: input.stackSessionId,
        rateLimits: state.last_rate_limits,
        previousIdentityKey: state.identity_key,
        previousEmail: state.email,
        previousAccountId: state.account_id,
      }),
    )
    events.push(
      buildEvent({
        type: "codex.auth.signin",
        observedAt: now,
        authPlan: input.authPlan,
        account: input.account,
        identityKey,
        stackSessionId: input.stackSessionId,
        rateLimits: serializedLimits,
        previousIdentityKey: state.identity_key,
        previousEmail: state.email,
        previousAccountId: state.account_id,
      }),
    )
  } else if (!state.identity_key && identityKey !== "unknown:anonymous") {
    events.push(
      buildEvent({
        type: "codex.auth.signin",
        observedAt: now,
        authPlan: input.authPlan,
        account: input.account,
        identityKey,
        stackSessionId: input.stackSessionId,
        rateLimits: serializedLimits,
      }),
    )
  } else if (
    input.forceSession ||
    (input.stackSessionId &&
      input.stackSessionId !== state.last_stack_session_id &&
      identityKey !== "unknown:anonymous")
  ) {
    events.push(
      buildEvent({
        type: "codex.auth.session",
        observedAt: now,
        authPlan: input.authPlan,
        account: input.account,
        identityKey,
        stackSessionId: input.stackSessionId,
        rateLimits: serializedLimits,
      }),
    )
  }

  if (
    serializedLimits &&
    usageFingerprint &&
    usageFingerprint !== state.last_usage_fingerprint &&
    identityKey !== "unknown:anonymous"
  ) {
    events.push(
      buildEvent({
        type: "codex.usage.updated",
        observedAt: now,
        authPlan: input.authPlan,
        account: input.account,
        identityKey,
        stackSessionId: input.stackSessionId,
        rateLimits: serializedLimits,
      }),
    )
  }

  for (const event of events) appendLedgerEvent(input.stackRoot, event)

  writeLedgerState(input.stackRoot, {
    identity_key: identityKey,
    email: input.account.email,
    account_id: input.account.accountId,
    auth_mode: input.account.authMode,
    last_refresh: input.account.lastRefresh,
    last_usage_fingerprint: usageFingerprint ?? state.last_usage_fingerprint,
    last_observed_at: now,
    last_stack_session_id: input.stackSessionId ?? state.last_stack_session_id,
    last_rate_limits: serializedLimits ?? state.last_rate_limits,
  })

  return events
}

export function readCodexAuthLedger(stackRoot: string, limit = 20): CodexAuthLedgerEvent[] {
  const path = codexAuthLedgerPath(stackRoot)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
  const events: CodexAuthLedgerEvent[] = []
  for (const line of lines.slice(-Math.max(1, limit))) {
    try {
      const parsed = JSON.parse(line) as CodexAuthLedgerEvent
      if (parsed?.event_id && parsed.type) events.push(parsed)
    } catch {
      continue
    }
  }
  return events
}

export function codexAuthLedgerSummaryLines(stackRoot: string, limit = 4): string[] {
  const all = readCodexAuthLedger(stackRoot, Math.max(limit * 4, 24))
  const events = all
    .filter((event) => event.type !== "codex.usage.updated" || !eventsIncludeSigninNear(all, event))
    .slice(-limit)
  if (events.length === 0) return []
  const lines = ["Codex auth history"]
  for (const event of [...events].reverse()) {
    lines.push(`  ${formatLedgerEventLine(event)}`)
  }
  return lines
}

function eventsIncludeSigninNear(all: CodexAuthLedgerEvent[], event: CodexAuthLedgerEvent): boolean {
  const index = all.findIndex((entry) => entry.event_id === event.event_id)
  if (index < 0) return false
  const window = all.slice(Math.max(0, index - 2), index + 1)
  return window.some((entry) => entry.type === "codex.auth.signin" || entry.type === "codex.auth.session")
}

function formatLedgerEventLine(event: CodexAuthLedgerEvent): string {
  const stamp = event.observed_at.replace("T", " ").slice(0, 16)
  const who = event.email ?? event.account_id?.slice(0, 8) ?? event.auth_mode
  const label =
    event.type === "codex.auth.signin"
      ? "sign-in"
      : event.type === "codex.auth.signout"
        ? "sign-out"
        : event.type === "codex.auth.session"
          ? "session"
          : "usage"
  const budget = event.rate_limits?.budget_summary
  return budget ? `${stamp} ${label} ${who} · ${budget}` : `${stamp} ${label} ${who}`
}

function buildEvent(input: {
  type: CodexAuthLedgerEventType
  observedAt: string
  authPlan: string
  account: CodexAccountSnapshot
  identityKey: string
  stackSessionId?: string
  rateLimits?: CodexAuthLedgerRateLimits
  previousIdentityKey?: string
  previousEmail?: string
  previousAccountId?: string
}): CodexAuthLedgerEvent {
  return {
    event_id: `codex_auth_${randomUUID()}`,
    type: input.type,
    observed_at: input.observedAt,
    auth_mode: input.account.authMode,
    auth_plan: input.authPlan,
    email: input.account.email,
    account_id: input.account.accountId,
    identity_key: input.identityKey,
    stack_session_id: input.stackSessionId,
    last_refresh: input.account.lastRefresh,
    rate_limits: input.rateLimits,
    previous_identity_key: input.previousIdentityKey,
    previous_email: input.previousEmail,
    previous_account_id: input.previousAccountId,
  }
}

function accountFromState(state: CodexAuthLedgerState): CodexAccountSnapshot {
  return {
    authMode: state.auth_mode ?? "unknown",
    email: state.email,
    accountId: state.account_id,
    lastRefresh: state.last_refresh,
    checkedAt: state.last_observed_at ?? new Date().toISOString(),
  }
}

function buildIdentityKey(account: CodexAccountSnapshot): string {
  if (account.accountId) return `${account.authMode}:${account.accountId}`
  if (account.email) return `${account.authMode}:${account.email.toLowerCase()}`
  return `${account.authMode}:anonymous`
}

function serializeRateLimits(
  authPlan: string,
  limits?: CodexRateLimitsSnapshot,
): CodexAuthLedgerRateLimits | undefined {
  if (!limits) return undefined
  const budgetSummary = formatCodexBudgetSuffix(authPlan, limits)
  return {
    plan_type: limits.planType,
    rate_limit_reached: limits.rateLimitReached,
    primary: serializeWindow(limits.primary),
    secondary: serializeWindow(limits.secondary),
    budget_summary: budgetSummary,
  }
}

function serializeWindow(window: CodexRateLimitsSnapshot["primary"]): CodexRateLimitWindowRecord | undefined {
  if (!window) return undefined
  return {
    used_percent: window.usedPercent,
    window_minutes: window.windowMinutes,
    remaining_percent: Math.max(0, Math.round(100 - window.usedPercent)),
    resets_at: window.resetsAt,
  }
}

function usageFingerprintFor(limits?: CodexAuthLedgerRateLimits): string | undefined {
  if (!limits) return undefined
  const payload = JSON.stringify({
    plan_type: limits.plan_type,
    rate_limit_reached: limits.rate_limit_reached,
    primary: limits.primary,
    secondary: limits.secondary,
  })
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

function appendLedgerEvent(stackRoot: string, event: CodexAuthLedgerEvent): void {
  const path = codexAuthLedgerPath(stackRoot)
  mkdirSync(join(stackRoot, ".stack", "codex"), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`)
}

function ledgerStatePath(stackRoot: string): string {
  return join(stackRoot, ".stack", "codex", "auth_ledger_state.json")
}

function readLedgerState(stackRoot: string): CodexAuthLedgerState {
  const path = ledgerStatePath(stackRoot)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CodexAuthLedgerState
  } catch {
    return {}
  }
}

function writeLedgerState(stackRoot: string, state: CodexAuthLedgerState): void {
  mkdirSync(join(stackRoot, ".stack", "codex"), { recursive: true })
  writeFileSync(ledgerStatePath(stackRoot), `${JSON.stringify(state, null, 2)}\n`)
}
