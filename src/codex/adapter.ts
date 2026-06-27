import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { StackConfig } from "../config.js"
import { STACK_HARNESS_NAME } from "../harness.js"
import type { LocalContextFile } from "../local/workspace.js"
import type { StackCodexTurn } from "../session.js"

export type CodexRunOptions = {
  config: StackConfig
  userPrompt: string
  selectedFiles: LocalContextFile[]
  priorTurns: StackCodexTurn[]
  onOutput: (chunk: string) => void
}

export async function runCodexTurn(options: CodexRunOptions): Promise<StackCodexTurn> {
  const startedAt = new Date().toISOString()
  const prompt = await buildPrompt(options)
  const args = [...options.config.codexArgs, "-C", options.config.workspaceRoot, "-"]
  const proc = Bun.spawn([options.config.codexCommand, ...args], {
    cwd: options.config.workspaceRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  proc.stdin.write(prompt)
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    collectStream(proc.stdout, options.onOutput),
    collectStream(proc.stderr, (chunk) => options.onOutput(`\n[stderr] ${chunk}`)),
    proc.exited,
  ])

  return {
    id: randomUUID(),
    prompt: options.userPrompt,
    selectedPaths: options.selectedFiles.map((file) => file.path),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    stdout,
    stderr,
  }
}

async function buildPrompt(options: CodexRunOptions): Promise<string> {
  const selectedContext = await Promise.all(
    options.selectedFiles.map(async (file) => {
      const text = await readShortFile(join(options.config.workspaceRoot, file.path))
      return `### ${file.path}\n${text}`
    }),
  )
  const recentTranscript = options.priorTurns
    .slice(-3)
    .map((turn, index) => {
      const answer = truncate(turn.stdout || turn.stderr || "(no output)", 3000)
      return `Turn ${index + 1}\nUser: ${turn.prompt}\nCodex: ${answer}`
    })
    .join("\n\n")

  return [
    `You are running inside ${STACK_HARNESS_NAME}, a local OpenTUI Codex cockpit.`,
    "Stack shows live SMR, Factory, hosted optimizer, and local optimizer status in the left rail.",
    "When the Stack live-ops MCP tools are available, use them for mediated live operations instead of bypassing backend owner routes.",
    "Use Stack MCP for live status, live SMR messages/control, Factory-project messages, hosted optimizer cancel, and README-smoke launch/status.",
    "If Stack MCP reports missing auth, offline routes, or no active target, say that directly and do not fall back to raw databases, Redis keys, or compatibility projections.",
    "Keep the answer concise and actionable.",
    "",
    "## User prompt",
    options.userPrompt,
    "",
    "## Recent Stack transcript",
    recentTranscript || "(none)",
    "",
    "## Selected local context",
    selectedContext.join("\n\n") || "(none selected)",
  ].join("\n")
}

async function readShortFile(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) return "(missing)"
  if (file.size > 100_000) return `(omitted: ${file.size} bytes, larger than Prototype 0 context limit)`
  return truncate(await file.text(), 12_000)
}

async function collectStream(stream: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    output += chunk
    onChunk(chunk)
  }

  const trailing = decoder.decode()
  if (trailing) {
    output += trailing
    onChunk(trailing)
  }

  return output
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...(truncated ${value.length - maxLength} chars)`
}
