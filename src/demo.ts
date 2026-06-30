import { mkdir, writeFile } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { randomUUID } from "node:crypto"
import type { StackConfig } from "./config.js"
import { stackChannel, stackVersion } from "./version.js"

type DemoReceipt = {
  run_id: string
  mode: "local"
  stack_version: string
  channel: string
  started_at: string
  ended_at: string
  status: "passed"
  validator: {
    name: "stack-local-demo"
    status: "passed"
    checks: string[]
  }
  git_sha?: string
  work_product: string
  trace: string
  artifact: string
  privacy_class: "local-only"
}

export async function runLocalDemo(config: StackConfig, argv: string[]): Promise<number> {
  const json = argv.includes("--json")
  const startedAt = new Date().toISOString()
  const runId = `stack_local_${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}_${randomUUID().slice(0, 8)}`
  const runDir = join(config.stackDataRoot, ".stack", "runs", runId)
  const receiptPath = join(runDir, "receipt.json")
  const workProductPath = join(runDir, "work_product.md")
  const tracePath = join(runDir, "trace.jsonl")
  const artifactPath = join(runDir, "artifact.md")

  await mkdir(runDir, { recursive: true })

  const gitSha = await git(["rev-parse", "HEAD"], config.workspaceRoot).catch(() => undefined)
  const checks = [
    "local command executed without Synth signup",
    "receipt directory created",
    "work product written",
    "trace written",
  ]

  const workProduct = [
    "# Stack Local Demo",
    "",
    "Stack ran a signed-out local demo and wrote an inspectable receipt.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Run id | \`${runId}\` |`,
    `| Mode | local |`,
    `| Stack version | \`${stackVersion(config.appRoot)}\` |`,
    `| Channel | \`${stackChannel(config.appRoot)}\` |`,
    `| Workspace | \`${basename(config.workspaceRoot)}\` |`,
    gitSha ? `| Git SHA | \`${gitSha}\` |` : "| Git SHA | unavailable |",
    "",
    "This demo does not call Synth APIs, does not require auth, and does not send telemetry.",
    "",
  ].join("\n")

  const traceEvents = [
    {
      ts: startedAt,
      event: "stack_local_demo_started",
      run_id: runId,
      mode: "local",
      channel: stackChannel(config.appRoot),
    },
    {
      ts: new Date().toISOString(),
      event: "stack_receipt_created",
      run_id: runId,
      privacy_class: "local-only",
    },
  ]

  const endedAt = new Date().toISOString()
  const receipt: DemoReceipt = {
    run_id: runId,
    mode: "local",
    stack_version: stackVersion(config.appRoot),
    channel: stackChannel(config.appRoot),
    started_at: startedAt,
    ended_at: endedAt,
    status: "passed",
    validator: {
      name: "stack-local-demo",
      status: "passed",
      checks,
    },
    git_sha: gitSha,
    work_product: relative(config.stackDataRoot, workProductPath),
    trace: relative(config.stackDataRoot, tracePath),
    artifact: relative(config.stackDataRoot, artifactPath),
    privacy_class: "local-only",
  }

  await writeFile(workProductPath, workProduct)
  await writeFile(artifactPath, workProduct)
  await writeFile(tracePath, `${traceEvents.map((event) => JSON.stringify(event)).join("\n")}\n`)
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)

  if (json) {
    console.log(JSON.stringify({ receipt, receipt_path: receiptPath }, null, 2))
  } else {
    console.log("Stack local demo complete")
    console.log("Local ready · Synth sign-in optional")
    console.log(`receipt: ${receiptPath}`)
    console.log(`work_product: ${workProductPath}`)
  }

  return 0
}

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`)
  return stdout.trim()
}
