import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { Subprocess } from "bun"
import { createTerminal, type Terminal, type TerminalBackend } from "@termless/core"
import { createGhosttyBackend, initGhostty } from "@termless/ghostty"
import { createXtermBackend } from "@termless/xtermjs"

export const STACK_REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..")

export const BRACKETED_PASTE_START = "\x1b[200~"
export const BRACKETED_PASTE_END = "\x1b[201~"

export type StackTuiE2eBackend = "xtermjs" | "ghostty"

export type StackTuiE2eOptions = {
  repoRoot?: string
  backend?: StackTuiE2eBackend
  cols?: number
  rows?: number
  smokeDir?: string
  keepSmokeDir?: boolean
  monitorEnabled?: boolean
  withStackd?: boolean
  stackApiUrl?: string
  stackArgs?: string[]
}

export type StackTuiWorkspace = {
  smokeDir: string
  stackRoot: string
  sessionLogDir: string
}

export type StackTuiSession = {
  term: Terminal
  smokeDir: string
  workspace: StackTuiWorkspace
  backendName: StackTuiE2eBackend
  stackdProc?: Subprocess
  stackApiUrl?: string
  cleanup: () => Promise<void>
}

export function stackDataRootFromWorkspace(workspace: StackTuiWorkspace): string {
  return workspace.stackRoot
}

export function stackTuiWorkspace(smokeDir: string): StackTuiWorkspace {
  const stackRoot = join(smokeDir, "workspace")
  const sessionLogDir = join(stackRoot, ".stack", "sessions")
  mkdirSync(sessionLogDir, { recursive: true })
  return { smokeDir, stackRoot, sessionLogDir }
}

export function stackRepoRoot(): string {
  return STACK_REPO_ROOT
}

export function repoRootFromImportMeta(_importMetaUrl: string): string {
  return STACK_REPO_ROOT
}

export function bracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`
}

export function stackTuiSmokeEnv(
  workspace: StackTuiWorkspace,
  repoRoot: string,
  options: { monitorEnabled?: boolean; stackApiUrl?: string } = {},
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.STACK_ROOT = workspace.stackRoot
  env.STACK_SESSION_DIR = workspace.sessionLogDir
  env.STACK_WORKING_DIR = workspace.stackRoot
  if (options.stackApiUrl) env.STACK_API_URL = options.stackApiUrl
  env.STACK_OPTIMIZER_SERVICE_URL = "http://127.0.0.1:65534"
  env.STACK_OPTIMIZER_DB = join(workspace.smokeDir, "gepa-service.sqlite")
  env.STACK_OPTIMIZER_LOG = join(workspace.smokeDir, "gepa-service.log")
  env.STACK_OPTIMIZER_PID = join(workspace.smokeDir, "gepa-service.pid")
  env.STACK_CODEX_TRANSPORT = "exec"
  env.STACK_MONITOR_ENABLED = options.monitorEnabled ? "1" : "0"
  if (options.monitorEnabled) {
    env.STACK_MONITOR_PROFILE = "progress-narrator"
    env.STACK_MONITOR_MODEL_WORKER = "deterministic"
  }
  env.STACK_CODEX_COMMAND = "bun"
  env.STACK_CODEX_ARGS = `run ${join(repoRoot, "scripts/fake_codex_jsonl.ts")}`
  env.TERM = "xterm-ghostty"
  env.TERM_PROGRAM = "ghostty"
  delete env.SYNTH_API_KEY
  delete env.SYNTH_STAGING_API_KEY
  return env
}

async function waitForStackdHealth(baseUrl: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`)
      if (response.ok) return
      lastError = `${response.status} ${await response.text()}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(250)
  }
  throw new Error(`stackd health failed: ${lastError}`)
}

async function spawnStackdForSmoke(
  repoRoot: string,
  workspace: StackTuiWorkspace,
): Promise<{ proc: Subprocess; baseUrl: string }> {
  const port = 19200 + Math.floor(Math.random() * 800)
  const baseUrl = `http://127.0.0.1:${port}`
  const stackdBin = join(repoRoot, "target/debug/stackd")
  const proc = Bun.spawn([stackdBin, "serve", "--port", String(port)], {
    cwd: workspace.stackRoot,
    env: {
      ...process.env,
      STACK_ROOT: workspace.stackRoot,
      STACK_SESSION_DIR: workspace.sessionLogDir,
      STACK_API_URL: baseUrl,
      STACKD_MONITOR_SCHEDULER: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  await waitForStackdHealth(baseUrl)
  return { proc, baseUrl }
}

export async function createStackTuiBackend(name: StackTuiE2eBackend): Promise<TerminalBackend> {
  if (name === "ghostty") {
    await initGhostty()
    return createGhosttyBackend()
  }
  return createXtermBackend()
}

export function resolveStackTuiE2eBackend(): StackTuiE2eBackend {
  const raw = (process.env.STACK_TUI_E2E_BACKEND ?? "xtermjs").trim().toLowerCase()
  if (raw === "ghostty") return "ghostty"
  return "xtermjs"
}

export async function spawnStackTui(options: StackTuiE2eOptions = {}): Promise<StackTuiSession> {
  const repoRoot = options.repoRoot ?? STACK_REPO_ROOT
  const backendName = options.backend ?? resolveStackTuiE2eBackend()
  const smokeDir = options.smokeDir ?? mkdtempSync(join(tmpdir(), "stack-tui-e2e-"))
  const workspace = stackTuiWorkspace(smokeDir)
  const cols = options.cols ?? 160
  const rows = options.rows ?? 45
  const backendImpl = await createStackTuiBackend(backendName)

  let stackdProc: Subprocess | undefined
  let stackApiUrl = options.stackApiUrl
  if (options.withStackd) {
    const stackd = await spawnStackdForSmoke(repoRoot, workspace)
    stackdProc = stackd.proc
    stackApiUrl = stackd.baseUrl
  }

  const term = createTerminal({
    backend: backendImpl,
    cols,
    rows,
  })

  const stackArgs = options.stackArgs ?? []
  await term.spawn([join(repoRoot, "bin/stack"), ...stackArgs], {
    cwd: repoRoot,
    env: stackTuiSmokeEnv(workspace, repoRoot, {
      monitorEnabled: options.monitorEnabled,
      stackApiUrl,
    }),
  })

  const cleanup = async () => {
    await term.close()
    if (stackdProc) {
      stackdProc.kill()
      await stackdProc.exited.catch(() => undefined)
    }
    if (!options.keepSmokeDir && !options.smokeDir) {
      rmSync(smokeDir, { force: true, recursive: true })
    }
  }

  return { term, smokeDir, workspace, backendName, stackdProc, stackApiUrl, cleanup }
}

export async function closeStackTuiTerm(session: Pick<StackTuiSession, "term">): Promise<void> {
  await session.term.close()
}

export function terminalText(term: Terminal): string {
  return stripAnsi(term.buffer.getText())
}

export function screenContains(term: Terminal, needle: string): boolean {
  const text = terminalText(term)
  return text.includes(needle)
}

export async function waitForStackPrompt(term: Terminal, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = terminalText(term)
    if (
      text.includes("Build anything") ||
      text.includes("Message gardener") ||
      text.includes("Ask Codex")
    ) {
      return
    }
    await sleep(100)
  }
  throw new Error(`timed out waiting for Stack prompt; screen:\n${terminalText(term).slice(-1500)}`)
}

export async function focusStackAgentInput(term: Terminal): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    term.press("Tab")
    await sleep(60)
  }
}

export async function submitStackExit(session: StackTuiSession): Promise<void> {
  session.term.press("2")
  await sleep(200)
  session.term.press("Escape")
  await sleep(200)
  session.term.type("/exit")
  session.term.press("Enter")
}

export async function waitForResumeCheckpointFile(
  stackDataRoot: string,
  predicate: (checkpoint: {
    metaThreadId?: string
    metaThreadState?: { phase?: string; goalObjective?: string }
  }) => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const { readLatestResumeCheckpoint } = await import("../../src/resume-checkpoint.ts")
  const deadline = Date.now() + timeoutMs
  let lastError = "no checkpoint yet"
  while (Date.now() < deadline) {
    try {
      const checkpoint = await readLatestResumeCheckpoint(stackDataRoot)
      if (checkpoint && predicate(checkpoint)) return
      lastError = checkpoint ? "checkpoint predicate failed" : "missing checkpoint"
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(200)
  }
  throw new Error(`timed out waiting for resume checkpoint: ${lastError}`)
}

export async function waitForScreenText(
  term: Terminal,
  needle: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (screenContains(term, needle)) return
    await sleep(100)
  }
  throw new Error(
    `timed out waiting for ${JSON.stringify(needle)}; screen:\n${terminalText(term).slice(-2000)}`,
  )
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
}

export function assertNoCrashArtifacts(text: string): void {
  const patterns = [
    "Failed to create optimized buffer",
    "OpenTUI buffer allocation crash detected",
    "Segmentation fault",
    "stack fatal:",
    "oh no: Bun has crashed",
  ]
  for (const pattern of patterns) {
    if (text.includes(pattern)) {
      throw new Error(`TUI crash artifact detected: ${pattern}`)
    }
  }
}

export async function waitForGoalShutterLayout(
  term: Terminal,
  timeoutMs = 45_000,
): Promise<void> {
  const { assertGoalShutterLayout } = await import("./layout-assert.ts")
  const deadline = Date.now() + timeoutMs
  let lastCheck: ReturnType<typeof assertGoalShutterLayout> | undefined
  while (Date.now() < deadline) {
    const text = terminalText(term)
    assertNoCrashArtifacts(text)
    lastCheck = assertGoalShutterLayout(text)
    if (lastCheck.ok) return
    await sleep(250)
  }
  throw new Error(
    `goal shutter layout failed:\n${(lastCheck?.failures ?? ["unknown"]).join("\n")}\nscreen tail:\n${terminalText(term).slice(-2500)}`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
