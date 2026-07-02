import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
import { loadConfig, environmentAuthStatus, type StackConfig } from "./config.js"
import { openUrlInSystemBrowser } from "./remote/actions.js"
import { readRemoteAccountSnapshot, SYNTH_KEYS_URL } from "./remote/account.js"

export const SYNTH_SIGNIN_PATH = "/signin"
export const SYNTH_SIGNUP_PRODUCT = "stack"

export type AuthUrlKind = "signup" | "signin" | "keys"

export function buildSynthAuthUrl(kind: AuthUrlKind, base = "https://www.usesynth.ai"): string {
  if (kind === "keys") return SYNTH_KEYS_URL
  const root = base.replace(/\/+$/, "")
  const path = kind === "signup" ? "/signup" : SYNTH_SIGNIN_PATH
  const url = new URL(path, `${root}/`)
  url.searchParams.set("product", SYNTH_SIGNUP_PRODUCT)
  url.searchParams.set("utm_source", "stack")
  url.searchParams.set("utm_medium", "cli")
  return url.toString()
}

export async function runAuthCli(config: StackConfig, argv: string[]): Promise<number> {
  const sub = argv[0]
  const action = argv[1]
  const json = argv.includes("--json")

  if (sub !== "auth" || !action) {
    console.error("usage: stack auth <open|verify|status|urls|test> …")
    console.error("  stack auth open signup|signin|keys [--no-browser]")
    console.error("  stack auth verify|status [--json]")
    console.error("  stack auth urls [--json]")
    console.error("  stack auth test signup|signin  # run Playwright auth harness (testing repo)")
    return 2
  }

  if (action === "urls") {
    const payload = {
      signup: buildSynthAuthUrl("signup"),
      signin: buildSynthAuthUrl("signin"),
      keys: buildSynthAuthUrl("keys"),
      product: SYNTH_SIGNUP_PRODUCT,
      environment: config.environmentName,
      api_base: config.environment.apiBaseUrl,
    }
    if (json) {
      console.log(JSON.stringify(payload, null, 2))
    } else {
      console.log(`signup ${payload.signup}`)
      console.log(`signin ${payload.signin}`)
      console.log(`keys   ${payload.keys}`)
    }
    return 0
  }

  if (action === "verify" || action === "status") {
    const auth = environmentAuthStatus(config.environment)
    const snapshot = await readRemoteAccountSnapshot(config)
    const payload = {
      environment: config.environmentName,
      auth_env: config.environment.authEnv,
      has_auth: auth.hasAuth,
      auth_source: auth.source,
      remote_status: snapshot.status,
      user_email: snapshot.userEmail,
      org_name: snapshot.orgName,
      message: snapshot.message,
      synth_sign_in_optional: true,
    }
    if (json) {
      console.log(JSON.stringify(payload, null, 2))
    } else {
      console.log(
        snapshot.status === "connected"
          ? `Synth auth OK (${snapshot.userEmail ?? snapshot.keyHint ?? config.environment.authEnv})`
          : `Synth auth ${snapshot.status}: ${snapshot.message ?? "unknown"}`,
      )
    }
    return snapshot.status === "connected" ? 0 : snapshot.status === "missing-auth" ? 0 : 1
  }

  if (action === "open") {
    const target = argv[2] as AuthUrlKind | undefined
    if (!target || !["signup", "signin", "keys"].includes(target)) {
      console.error("usage: stack auth open signup|signin|keys [--no-browser]")
      return 2
    }
    const url = buildSynthAuthUrl(target)
    const noBrowser = argv.includes("--no-browser")
    if (json) {
      console.log(JSON.stringify({ url, opened: !noBrowser }, null, 2))
    } else {
      console.log(url)
    }
    if (noBrowser) return 0
    const res = await openUrlInSystemBrowser(url)
    if (!res.ok) {
      console.error(res.message)
      return 1
    }
    if (!json) console.error(`opened ${url}`)
    return 0
  }

  if (action === "test") {
    const flow = argv[2]
    if (flow !== "signup" && flow !== "signin") {
      console.error("usage: stack auth test signup|signin")
      return 2
    }
    const testingRoot = resolve(process.env.STACK_TESTING_ROOT ?? join(config.appRoot, "..", "testing"))
    const script = resolve(testingRoot, "stack", "end_to_end", "auth", "playwright_synth_auth.ts")
    const url = buildSynthAuthUrl(flow)
    const result = spawnSync("bun", ["run", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        STACK_AUTH_FLOW: flow,
        STACK_AUTH_TARGET_URL: url,
      },
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    return result.status ?? 1
  }

  console.error(`unknown stack auth command: ${action}`)
  return 2
}
