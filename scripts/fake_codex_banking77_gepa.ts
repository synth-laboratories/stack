import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function emit(value: unknown): void {
  console.log(JSON.stringify(value))
}

function loadOpenAiKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const envPath = join(process.env.HOME ?? "", "Documents/GitHub/synth-ai/.env")
  if (!existsSync(envPath)) return undefined
  const match = readFileSync(envPath, "utf8").match(/^OPENAI_API_KEY=(.+)$/m)
  return match?.[1]?.trim()
}

function shellReceiptCommand(artifactDir: string, useReal: boolean): string[] {
  if (useReal) {
    const optimizersRoot = join(process.env.HOME ?? "", "Documents/GitHub/optimizers")
    return [
      "/bin/zsh",
      "-lc",
      [
        `cd ${JSON.stringify(optimizersRoot)}`,
        "export SYNTH_OPTIMIZERS_TERMINAL=1",
        "uv run python dev_examples/better_gepa/run_acceptance.py --profile openai_baseline --mode cost_stop",
      ].join(" && "),
    ]
  }
  const mockScript = join(repoRoot, "scripts/mock_banking77_gepa_receipt.sh")
  return ["/bin/bash", mockScript, artifactDir]
}

function summarizeReceipt(stdout: string, stderr: string, exitCode: number, useReal: boolean): string {
  if (useReal) {
    const runMatch = stdout.match(/acceptance_openai_baseline_cost_stop_\d+/g)
    const runId = runMatch?.at(-1) ?? "unknown"
    return [
      "Banking77 GEPA acceptance finished via real harness.",
      exitCode === 0 ? "STACK_GEPA_SMOKE_OK" : "STACK_GEPA_SMOKE_FAILED",
      `run_id=${runId}`,
      `exit_code=${exitCode}`,
      "tier=smoke",
      stderr.trim() ? `stderr_tail=${stderr.trim().split("\n").slice(-3).join(" | ")}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n")
  }

  return [
    "Banking77 GEPA smoke receipt (mock harness — no API spend).",
    stdout.trim(),
    exitCode === 0 ? "" : `exit_code=${exitCode}`,
    stderr.trim() ? `stderr=${stderr.trim()}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n")
}

const prompt = await readStdin()
const artifactDir = process.env.STACK_GEPA_SMOKE_ARTIFACT_DIR ?? "/tmp/stack-gepa-smoke-artifacts"
const useReal =
  process.env.STACK_GEPA_SMOKE_REAL === "1" &&
  (prompt.includes("run_acceptance") || prompt.includes("STACK_GEPA_SMOKE_REAL")) &&
  Boolean(loadOpenAiKey())

emit({
  type: "thread.started",
  thread_id: "stack-gepa-smoke-thread",
})
await sleep(250)
emit({ type: "turn.started" })
await sleep(200)

emit({
  type: "item.completed",
  item: {
    id: "item_preface",
    type: "agent_message",
    text: "Running Banking77 GEPA acceptance smoke. Shell path only — no Stack MCP launch tool required.",
  },
})
await sleep(350)

const commandParts = shellReceiptCommand(artifactDir, useReal)
const commandLabel = commandParts.join(" ")
const env = useReal ? { ...process.env, OPENAI_API_KEY: loadOpenAiKey()! } : process.env

emit({
  type: "item.completed",
  item: {
    id: "item_tool",
    type: "command_execution",
    command: commandLabel,
    aggregated_output: "",
    exit_code: null,
    status: "in_progress",
  },
})
await sleep(300)

const proc = Bun.spawn(commandParts, {
  cwd: useReal ? join(process.env.HOME ?? "", "Documents/GitHub/optimizers") : repoRoot,
  env,
  stdout: "pipe",
  stderr: "pipe",
})

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])

emit({
  type: "item.completed",
  item: {
    id: "item_tool",
    type: "command_execution",
    command: commandLabel,
    aggregated_output: stdout.slice(0, 4000),
    exit_code: exitCode,
    status: exitCode === 0 ? "completed" : "failed",
  },
})

const report = summarizeReceipt(stdout, stderr, exitCode, useReal)
emit({
  type: "item.completed",
  item: {
    id: "item_report",
    type: "agent_message",
    text: report,
  },
})

emit({
  type: "turn.completed",
  usage: {
    input_tokens: 42,
    cached_input_tokens: 8,
    output_tokens: 120,
    reasoning_output_tokens: 16,
  },
})

if (exitCode !== 0) {
  process.exit(exitCode)
}
