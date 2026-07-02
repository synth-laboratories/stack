import { environmentAuthStatus, type StackConfig, type StackAuthStatus } from "../config.js"

export const SYNTH_KEYS_URL = "https://usesynth.ai/keys"
export const SYNTH_SIGNUP_URL = "https://usesynth.ai/signup"

export type RemoteAccountStatus = "connected" | "missing-auth" | "invalid-auth" | "offline" | "unknown"

export type RemoteAccountSnapshot = {
  environmentName: string
  environmentLabel: string
  apiBaseUrl: string
  authEnv: string
  hasAuth: boolean
  auth: StackAuthStatus
  status: RemoteAccountStatus
  checkedAt: string
  keyHint?: string
  userEmail?: string
  orgName?: string
  orgId?: string
  message?: string
}

export function maskApiKeyHint(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return "sk_…"
  if (trimmed.length <= 10) return `${trimmed.slice(0, 4)}…`
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`
}

export function authSetupHint(auth: StackAuthStatus): string {
  const command = "stack auth open signin"
  if (auth.envFile) {
    return `Local ready · Sign in to Synth with ${command} · ${auth.authEnv} may live in ${auth.envFile}`
  }
  return `Local ready · Sign in to Synth with ${command} · keys ${SYNTH_KEYS_URL} · signup ${SYNTH_SIGNUP_URL}`
}

export async function readRemoteAccountSnapshot(config: StackConfig): Promise<RemoteAccountSnapshot> {
  const auth = environmentAuthStatus(config.environment)
  const hasAuth = auth.hasAuth
  const token = hasAuth ? process.env[config.environment.authEnv] : undefined
  const keyHint = token ? maskApiKeyHint(token) : undefined
  const base: RemoteAccountSnapshot = {
    environmentName: config.environmentName,
    environmentLabel: config.environment.label,
    apiBaseUrl: config.environment.apiBaseUrl,
    authEnv: config.environment.authEnv,
    hasAuth,
    auth,
    keyHint,
    status: hasAuth ? "unknown" : "missing-auth",
    checkedAt: new Date().toISOString(),
    message: hasAuth ? undefined : authSetupHint(auth),
  }

  if (!hasAuth) return base

  try {
    const [response, mePayload] = await Promise.all([
      fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}/smr/projects?limit=1`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(2500),
      }),
      fetchMe(config, token),
    ])
    const me = asRecord(mePayload)
    const identity = {
      userEmail: readString(me?.user_email),
      orgName: readString(me?.org_name),
      orgId: readString(me?.org_id),
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ...base,
        ...identity,
        status: "invalid-auth",
        checkedAt: new Date().toISOString(),
        message: `${config.environment.authEnv} rejected (${response.status}). Regenerate at ${SYNTH_KEYS_URL}`,
      }
    }
    const emailLabel = identity.userEmail ?? keyHint
    return {
      ...base,
      ...identity,
      status: response.ok ? "connected" : "offline",
      checkedAt: new Date().toISOString(),
      message: response.ok
        ? emailLabel
          ? `connected as ${emailLabel}`
          : `connected as ${keyHint ?? config.environment.authEnv}`
        : `api ${response.status} ${response.statusText}`,
    }
  } catch (error) {
    return {
      ...base,
      status: "offline",
      checkedAt: new Date().toISOString(),
      message: errorMessage(error),
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function fetchMe(config: StackConfig, token: string | undefined): Promise<unknown> {
  if (!token) return undefined
  try {
    const response = await fetch(`${config.environment.apiBaseUrl.replace(/\/+$/, "")}/api/v1/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}
