import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"

// Stack-owned Codex namespace. Stack background automation (workers, monitors,
// gardeners, wakeups, eval players) must never create, resume, or mutate
// threads in the user's personal Codex home (~/.codex): those threads surface
// in the Codex desktop sidebar. "serviceName: stack" is metadata, not a
// privacy boundary — the boundary is CODEX_HOME.

export const CODEX_ISOLATION_MODES = ["ephemeral_exec", "isolated_app_server", "personal_dev_override"] as const
export type StackCodexIsolationMode = (typeof CODEX_ISOLATION_MODES)[number]

export type StackCodexActorRole = "worker" | "monitor" | "gardener" | "wakeup" | "eval" | "probe"

export type StackCodexTransport = "exec" | "app_server"

/** Roles that run without a human watching the turn. Background exec turns
 * must be --ephemeral; background app-server threads are only allowed inside
 * an isolated Codex home. */
const BACKGROUND_ROLES: ReadonlySet<StackCodexActorRole> = new Set(["monitor", "gardener", "wakeup", "eval"])

/** Roles for which app-server transport creates persistent threads. `probe`
 * launches app-server only for metadata reads (usage/rate limits) and never
 * calls thread/start, so it is exempt from the app-server thread restriction
 * while still running against the isolated home. */
const APP_SERVER_THREAD_ROLES: ReadonlySet<StackCodexActorRole> = new Set([
  "worker",
  "monitor",
  "gardener",
  "wakeup",
  "eval",
])

export type StackCodexIsolationConfig = {
  codexHome: string
  codexIsolationMode: StackCodexIsolationMode
}

export function personalCodexHome(): string {
  // $HOME first (matches the Rust core and lets tests relocate the personal
  // namespace); Bun's homedir() ignores a changed $HOME.
  const home = process.env.HOME?.trim() || homedir()
  return join(home, ".codex")
}

export function defaultStackCodexHome(stackDataRoot: string): string {
  return join(stackDataRoot, ".stack", "codex-home")
}

export function isBackgroundCodexActor(role: StackCodexActorRole): boolean {
  return BACKGROUND_ROLES.has(role)
}

/** Create the Stack-owned Codex home and seed ONLY auth material from the
 * personal Codex home. Sessions, archived_sessions, history.jsonl,
 * session_index.jsonl, and plugin caches are never copied — Stack traffic
 * must start from an empty, Stack-only namespace. */
export function ensureStackCodexHome(codexHome: string, personalHome = personalCodexHome()): string {
  if (resolvedPath(codexHome) === resolvedPath(personalHome)) {
    throw new Error(
      `stack codex home must not be the personal Codex home (${personalHome}); refusing to prepare it`,
    )
  }
  mkdirSync(codexHome, { recursive: true })
  const authTarget = join(codexHome, "auth.json")
  const authSource = join(personalHome, "auth.json")
  if (!existsSync(authTarget) && existsSync(authSource)) {
    copyFileSync(authSource, authTarget)
  }
  const configTarget = join(codexHome, "config.toml")
  if (!existsSync(configTarget)) {
    writeFileSync(
      configTarget,
      [
        "# Stack-owned Codex home (background automation namespace).",
        "# Created by Stack; personal ~/.codex is never used for Stack actors.",
        "",
      ].join("\n"),
      "utf8",
    )
  }
  return codexHome
}

/** Environment for every Codex subprocess Stack launches. This is the single
 * approved way to build that environment — raw process.env inheritance leaks
 * Stack threads into the user's Codex app. */
export function stackCodexEnv(config: StackCodexIsolationConfig): Record<string, string | undefined> {
  if (config.codexIsolationMode === "personal_dev_override") {
    return { ...process.env }
  }
  return {
    ...process.env,
    CODEX_HOME: config.codexHome,
    STACK_CODEX_ISOLATED: "1",
  }
}

/** Insert --ephemeral into a `codex exec ...` argv. Throws when the argv is
 * not an exec invocation — background actors have no non-exec CLI path. */
export function withEphemeralExecArgs(args: readonly string[]): string[] {
  if (args.includes("--ephemeral")) return [...args]
  const execIndex = args.indexOf("exec")
  if (execIndex === -1) {
    throw new Error(`cannot add --ephemeral: codex args are not an exec invocation (${args.join(" ")})`)
  }
  const next = [...args]
  next.splice(execIndex + 1, 0, "--ephemeral")
  return next
}

export function withExecSandboxMode(args: readonly string[], mode: "read-only" | "workspace-write" | "danger-full-access"): string[] {
  const next = [...args]
  const existingIndex = next.findIndex((arg) => arg === "--sandbox" || arg === "-s")
  if (existingIndex >= 0) {
    next.splice(existingIndex, 2, "--sandbox", mode)
    return next
  }
  const execIndex = next.indexOf("exec")
  if (execIndex === -1) {
    throw new Error(`cannot set sandbox mode: codex args are not an exec invocation (${args.join(" ")})`)
  }
  next.splice(execIndex + 1, 0, "--sandbox", mode)
  return next
}

export type StackCodexLaunchCheck = {
  transport: StackCodexTransport
  args?: readonly string[]
}

const warnedOnce = new Set<string>()

function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return
  warnedOnce.add(key)
  console.warn(message)
}

/** Hard preflight guard before any Stack Codex launch. Throws when the launch
 * would write Stack worker/monitor/gardener/eval traffic into the user's
 * personal Codex namespace. */
export function assertStackCodexIsolation(
  config: StackCodexIsolationConfig,
  actorRole: StackCodexActorRole,
  launch: StackCodexLaunchCheck,
  personalHome = personalCodexHome(),
): void {
  if (config.codexIsolationMode === "personal_dev_override") {
    if (process.env.STACK_CODEX_UNSAFE_PERSONAL !== "1") {
      throw new Error(
        "codexIsolationMode=personal_dev_override requires STACK_CODEX_UNSAFE_PERSONAL=1; " +
          "this mode runs Stack actors against the personal ~/.codex and WILL surface Stack threads in the Codex app",
      )
    }
    warnOnce(
      "personal-dev-override",
      "[stack] UNSAFE: personal_dev_override active — Stack Codex traffic is using the personal ~/.codex namespace",
    )
    return
  }

  const codexHome = config.codexHome?.trim()
  if (!codexHome) {
    throw new Error("stack codex isolation: config.codexHome is missing; refusing to launch codex")
  }
  if (resolvedPath(codexHome) === resolvedPath(personalHome)) {
    throw new Error(
      `stack codex isolation: codexHome resolves to the personal Codex home (${personalHome}); refusing to launch`,
    )
  }
  for (const entry of ["sessions", "archived_sessions", "history.jsonl", "session_index.jsonl"]) {
    const candidate = join(codexHome, entry)
    if (isSymlinkInto(candidate, personalHome)) {
      throw new Error(
        `stack codex isolation: ${candidate} is a symlink into ${personalHome}; refusing to launch`,
      )
    }
  }

  if (launch.transport === "exec" && isBackgroundCodexActor(actorRole)) {
    if (!launch.args?.includes("--ephemeral")) {
      throw new Error(
        `stack codex isolation: background actor "${actorRole}" must run codex exec --ephemeral (args: ${launch.args?.join(" ") ?? "(none)"})`,
      )
    }
  }

  if (launch.transport === "app_server" && APP_SERVER_THREAD_ROLES.has(actorRole)) {
    if (config.codexIsolationMode !== "isolated_app_server" && process.env.STACK_CODEX_UNSAFE_APP_SERVER !== "1") {
      throw new Error(
        `stack codex isolation: app-server transport for actor "${actorRole}" is disabled in mode "${config.codexIsolationMode}"; ` +
          "use codexIsolationMode=isolated_app_server or set STACK_CODEX_UNSAFE_APP_SERVER=1",
      )
    }
    warnOnce(
      "isolated-app-server",
      "[stack] codex app-server threads are being created inside the isolated Stack codex home " +
        `(${codexHome}); they are invisible to the personal Codex app but persist under that home`,
    )
  }
}

function resolvedPath(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

function isSymlinkInto(candidate: string, personalHome: string): boolean {
  try {
    if (!lstatSync(candidate).isSymbolicLink()) return false
  } catch {
    return false
  }
  const target = resolvedPath(candidate)
  const personal = resolvedPath(personalHome)
  return target === personal || target.startsWith(`${personal}${sep}`)
}
