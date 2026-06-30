import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

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
}

export type StackTuiSession = {
  term: Terminal
  smokeDir: string
  backendName: StackTuiE2eBackend
  cleanup: () => Promise<void>
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

export function stackTuiSmokeEnv(smokeDir: string, repoRoot: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.STACK_SESSION_DIR = smokeDir
  env.STACK_WORKING_DIR = smokeDir
  env.STACK_OPTIMIZER_SERVICE_URL = "http://127.0.0.1:65534"
  env.STACK_OPTIMIZER_DB = join(smokeDir, "gepa-service.sqlite")
  env.STACK_OPTIMIZER_LOG = join(smokeDir, "gepa-service.log")
  env.STACK_OPTIMIZER_PID = join(smokeDir, "gepa-service.pid")
  env.STACK_CODEX_TRANSPORT = "exec"
  env.STACK_MONITOR_ENABLED = "0"
  env.STACK_CODEX_COMMAND = "bun"
  env.STACK_CODEX_ARGS = `run ${join(repoRoot, "scripts/fake_codex_jsonl.ts")}`
  env.TERM = "xterm-ghostty"
  env.TERM_PROGRAM = "ghostty"
  delete env.SYNTH_API_KEY
  delete env.SYNTH_STAGING_API_KEY
  return env
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
  const cols = options.cols ?? 160
  const rows = options.rows ?? 45
  const backendImpl = await createStackTuiBackend(backendName)

  const term = createTerminal({
    backend: backendImpl,
    cols,
    rows,
  })

  await term.spawn([join(repoRoot, "bin/stack")], {
    cwd: repoRoot,
    env: stackTuiSmokeEnv(smokeDir, repoRoot),
  })

  const cleanup = async () => {
    await term.close()
    if (!options.keepSmokeDir && !options.smokeDir) {
      rmSync(smokeDir, { force: true, recursive: true })
    }
  }

  return { term, smokeDir, backendName, cleanup }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
