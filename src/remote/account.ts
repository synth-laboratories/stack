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
  message?: string
}

export function maskApiKeyHint(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return "sk_…"
  if (trimmed.length <= 10) return `${trimmed.slice(0, 4)}…`
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`
}

export function authSetupHint(auth: StackAuthStatus): string {
  if (auth.envFile) {
    return `Set ${auth.authEnv} in ${auth.envFile} · keys ${SYNTH_KEYS_URL} · signup ${SYNTH_SIGNUP_URL}`
  }
  return `Set ${auth.authEnv} · keys ${SYNTH_KEYS_URL} · signup ${SYNTH_SIGNUP_URL}`
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
    const response = await fetch(
      `${config.environment.apiBaseUrl.replace(/\/+$/, "")}/smr/projects?limit=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(2500),
      },
    )
    if (response.status === 401 || response.status === 403) {
      return {
        ...base,
        status: "invalid-auth",
        checkedAt: new Date().toISOString(),
        message: `${config.environment.authEnv} rejected (${response.status}). Regenerate at ${SYNTH_KEYS_URL}`,
      }
    }
    return {
      ...base,
      status: response.ok ? "connected" : "offline",
      checkedAt: new Date().toISOString(),
      message: response.ok
        ? `connected as ${keyHint ?? config.environment.authEnv}`
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
