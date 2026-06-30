#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type DoctorReport = {
  stack_version?: string
  channel?: string
  local_ready?: boolean
  synth_sign_in_optional?: boolean
  checks?: Array<{ id?: string; level?: string; summary?: string }>
}

type DemoResult = {
  receipt?: {
    run_id?: string
    mode?: string
    status?: string
    validator?: { status?: string; checks?: string[] }
    work_product?: string
    trace?: string
    artifact?: string
    privacy_class?: string
  }
  receipt_path?: string
}

type UpdateReport = {
  current_version?: string
  current_channel?: string
  requested_channel?: string
  manifest_source?: string
  status?: string
  latest_version?: string
  target?: string
  mutates?: boolean
}

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = resolve(appRoot, ".stack", "evidence", "first-run-local", stamp)
const stackDataRoot = join(proofDir, "stack-data")
const sessionDir = join(stackDataRoot, ".stack", "sessions")
const manifestPath = join(appRoot, "packaging", "manifests", "nightly.example.json")
const failures: string[] = []

mkdirSync(sessionDir, { recursive: true })

const baseEnv = smokeEnv()
const doctor = runStack(["doctor", "--json"], baseEnv)
const doctorReport = parseJson<DoctorReport>(doctor.stdout, "doctor")
if (doctorReport.local_ready !== true) failures.push("doctor local_ready must be true")
if (doctorReport.synth_sign_in_optional !== true) failures.push("doctor synth_sign_in_optional must be true")
if (!doctorReport.checks?.some((check) => check.id === "local-mode" && check.level === "pass")) {
  failures.push("doctor must report local-mode pass")
}
if (!doctorReport.checks?.some((check) => check.id === "telemetry" && check.level === "pass")) {
  failures.push("doctor must report telemetry posture")
}
if (containsKnownSecret(doctor.stdout)) failures.push("doctor output contains a known secret value")

const demo = runStack(["demo", "--json"], baseEnv)
const demoResult = parseJson<DemoResult>(demo.stdout, "demo")
const receiptPath = demoResult.receipt_path
if (!receiptPath || !existsSync(receiptPath)) failures.push("demo receipt_path must exist")
if (receiptPath && !resolve(receiptPath).startsWith(resolve(stackDataRoot))) {
  failures.push("demo receipt must be written under isolated stack data root")
}
if (demoResult.receipt?.mode !== "local") failures.push("demo receipt mode must be local")
if (demoResult.receipt?.status !== "passed") failures.push("demo receipt status must be passed")
if (demoResult.receipt?.validator?.status !== "passed") failures.push("demo validator status must be passed")
if (demoResult.receipt?.privacy_class !== "local-only") failures.push("demo privacy_class must be local-only")
if (!demoResult.receipt?.validator?.checks?.some((check) => check.includes("without Synth signup"))) {
  failures.push("demo validator must prove no Synth signup requirement")
}

const receipt = receiptPath && existsSync(receiptPath)
  ? JSON.parse(readFileSync(receiptPath, "utf8")) as NonNullable<DemoResult["receipt"]>
  : demoResult.receipt
for (const key of ["work_product", "trace", "artifact"] as const) {
  const relativePath = receipt?.[key]
  if (!relativePath || !existsSync(join(stackDataRoot, relativePath))) failures.push(`demo ${key} file must exist`)
}
const tracePath = receipt?.trace ? join(stackDataRoot, receipt.trace) : undefined
if (tracePath && existsSync(tracePath)) {
  const trace = readFileSync(tracePath, "utf8")
  if (!trace.includes("stack_local_demo_started")) failures.push("demo trace must include stack_local_demo_started")
  if (!trace.includes("stack_receipt_created")) failures.push("demo trace must include stack_receipt_created")
}

const update = runStack([
  "update",
  "--check",
  "--channel",
  "nightly",
  "--manifest",
  manifestPath,
  "--json",
], baseEnv)
const updateReport = parseJson<UpdateReport>(update.stdout, "update")
const allowedUpdateStatuses = new Set(["available", "current", "unsupported-target"])
if (updateReport.mutates !== false) failures.push("update --check must report mutates=false")
if (updateReport.requested_channel !== "nightly") failures.push("update --check must use nightly channel")
if (!allowedUpdateStatuses.has(updateReport.status ?? "")) {
  failures.push(`update --check returned unexpected status ${updateReport.status ?? "missing"}`)
}
if (containsKnownSecret(update.stdout)) failures.push("update output contains a known secret value")
if (containsKnownSecret(demo.stdout)) failures.push("demo output contains a known secret value")

const summary = {
  stamp,
  ok: failures.length === 0,
  proof_dir: proofDir,
  stack_data_root: stackDataRoot,
  doctor: {
    stack_version: doctorReport.stack_version,
    channel: doctorReport.channel,
    local_ready: doctorReport.local_ready,
    synth_sign_in_optional: doctorReport.synth_sign_in_optional,
    checks: doctorReport.checks?.map((check) => ({ id: check.id, level: check.level })),
  },
  demo: {
    run_id: demoResult.receipt?.run_id,
    receipt_path: receiptPath,
    receipt_mode: demoResult.receipt?.mode,
    receipt_status: demoResult.receipt?.status,
    privacy_class: demoResult.receipt?.privacy_class,
  },
  update: {
    status: updateReport.status,
    current_version: updateReport.current_version,
    latest_version: updateReport.latest_version,
    target: updateReport.target,
    mutates: updateReport.mutates,
  },
  failures,
}

writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`first_run_local_smoke_failed: ${failures.join("; ")}`)
  console.error(JSON.stringify(summary, null, 2))
  process.exit(1)
}

console.log("first_run_local_smoke_ok")
console.log(JSON.stringify(summary, null, 2))

function runStack(args: string[], env: NodeJS.ProcessEnv): { stdout: string; stderr: string } {
  const result = spawnSync("bun", ["src/main.ts", ...args], {
    cwd: appRoot,
    env,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    console.error(`stack ${args.join(" ")} failed`)
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(result.status ?? 1)
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

function parseJson<T>(stdout: string, label: string): T {
  const start = stdout.indexOf("{")
  if (start < 0) throw new Error(`${label} JSON output not found`)
  return JSON.parse(stdout.slice(start)) as T
}

function smokeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/(TOKEN|SECRET|API_KEY|ACCESS_KEY|PASSWORD)/.test(key)) delete env[key]
  }
  env.STACK_ENVIRONMENT = "staging"
  env.STACK_SESSION_DIR = sessionDir
  env.STACK_VOICE_ENABLED = "0"
  env.STACK_TELEMETRY = "0"
  return env
}

function containsKnownSecret(text: string): boolean {
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 12) continue
    if (!/(TOKEN|SECRET|API_KEY|ACCESS_KEY|PASSWORD)/.test(key)) continue
    if (text.includes(value)) return true
  }
  return false
}
