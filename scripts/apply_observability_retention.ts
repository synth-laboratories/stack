#!/usr/bin/env bun

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

const args = new Set(process.argv.slice(2))
const execute = args.has("--execute")
const allowDegraded = args.has("--allow-degraded")
const slot = readArg("--slot") ?? process.env.STACK_VL_SLOT ?? "slot1"
const waitSeconds = readArg("--wait-seconds") ?? "120"
const stackRoot = resolve(join(import.meta.dir, ".."))
const synthDevRoot = resolve(process.env.STACK_SYNTH_DEV_ROOT ?? join(stackRoot, "..", "synth-dev"))
const evidenceDir = readArg("--evidence-dir") ?? process.env.STACK_OBSERVABILITY_EVIDENCE_DIR
const composeEnv = join(synthDevRoot, "temp", slot, "compose.env")
const composeFile = join(synthDevRoot, "local_dev", "infra", "docker-compose.local-stack.yaml")

if (!existsSync(composeEnv)) fail(`missing compose env: ${composeEnv}`)
if (!existsSync(composeFile)) fail(`missing compose file: ${composeFile}`)

const status = await run(["./scripts/local.sh", "status", slot], synthDevRoot)
if (status.exitCode !== 0) fail(`slot status failed:\n${status.stderr || status.stdout}`)
const statusPreflight = parseSlotStatus(status.stdout, slot)
if (statusPreflight.active_run_count > 0 || statusPreflight.durable_active_runs > 0) {
  fail(
    `slot ${slot} has active runs: activity=${statusPreflight.active_run_count} durable=${statusPreflight.durable_active_runs}`,
  )
}
const slotReadyForExecute = statusPreflight.status === "healthy" && statusPreflight.slot_phase === "healthy"
const compose = await run(
  ["docker", "compose", "--env-file", composeEnv, "-f", composeFile, "config", "victorialogs"],
  synthDevRoot,
)
if (compose.exitCode !== 0) fail(`compose config failed:\n${compose.stderr || compose.stdout}`)

const staticHasRetention = compose.stdout.includes("-retentionPeriod=7d")
const staticHasDiskCap = compose.stdout.includes("-retention.maxDiskSpaceUsageBytes=2GiB")
if (!staticHasRetention || !staticHasDiskCap) {
  fail(`compose config missing retention flags: retention=${staticHasRetention} disk_cap=${staticHasDiskCap}`)
}

const applyCommand = ["./scripts/local.sh", "drain-recreate", slot, "victorialogs", "--wait-seconds", waitSeconds]
const summary: Record<string, unknown> = {
  ok: true,
  mode: execute ? "execute" : "dry-run",
  slot,
  synth_dev_root: synthDevRoot,
  static_compose_retention: {
    retention_period_7d: staticHasRetention,
    disk_cap_2gib: staticHasDiskCap,
  },
  status_preflight: statusPreflight,
  execute_preflight: {
    ready: slotReadyForExecute,
    allow_degraded: allowDegraded,
    reason: slotReadyForExecute ? "slot_healthy" : "slot_status_not_healthy",
  },
  apply_command: {
    cwd: synthDevRoot,
    argv: applyCommand,
  },
}

if (!execute) {
  console.log(JSON.stringify(summary, null, 2))
  writeEvidence(summary)
  console.error("dry-run only; rerun with --execute after operator approval to recreate the shared victorialogs service")
  process.exit(0)
}

if (!slotReadyForExecute && !allowDegraded) {
  summary.ok = false
  writeEvidence(summary)
  console.error(JSON.stringify(summary, null, 2))
  console.error("slot is not healthy; rerun only after resolving warnings or add --allow-degraded after operator review")
  process.exit(2)
}

const apply = await run(applyCommand, synthDevRoot)
summary.apply_exit_code = apply.exitCode
summary.apply_stdout_tail = tail(apply.stdout)
summary.apply_stderr_tail = tail(apply.stderr)
if (apply.exitCode !== 0) {
  writeEvidence(summary)
  console.error(JSON.stringify(summary, null, 2))
  process.exit(apply.exitCode)
}

const retention = await run(
  ["bun", "run", "release-check:observability"],
  stackRoot,
  evidenceDir ? { STACK_OBSERVABILITY_EVIDENCE_DIR: resolve(evidenceDir) } : undefined,
)
summary.retention_exit_code = retention.exitCode
summary.retention_stdout_tail = tail(retention.stdout)
summary.retention_stderr_tail = tail(retention.stderr)
if (retention.exitCode !== 0) {
  writeEvidence(summary)
  console.error(JSON.stringify(summary, null, 2))
  process.exit(retention.exitCode)
}

const smoke = await run(["bun", "run", "smoke:observability"], stackRoot)
summary.smoke_exit_code = smoke.exitCode
summary.smoke_stdout_tail = tail(smoke.stdout)
summary.smoke_stderr_tail = tail(smoke.stderr)
if (smoke.exitCode !== 0) {
  writeEvidence(summary)
  console.error(JSON.stringify(summary, null, 2))
  process.exit(smoke.exitCode)
}

writeEvidence(summary)
console.log(JSON.stringify(summary, null, 2))

async function run(command: string[], cwd: string, extraEnv?: Record<string, string>): Promise<CommandResult> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...extraEnv } })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function tail(value: string): string {
  return value.split("\n").slice(-40).join("\n")
}

function writeEvidence(value: Record<string, unknown>): void {
  if (!evidenceDir) return
  const dir = resolve(evidenceDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "retention_apply_result.json"), `${JSON.stringify(value, null, 2)}\n`)
}

function parseSlotStatus(stdout: string, slot: string): Record<string, unknown> & {
  active_run_count: number
  durable_active_runs: number
} {
  const parsed = JSON.parse(stdout) as { slots?: Array<Record<string, unknown>> }
  const target = parsed.slots?.find((item) => item.slot_id === slot) ?? parsed.slots?.[0]
  if (!target) fail(`slot status JSON did not include ${slot}`)
  const activity = readRecord(target.activity)
  const durable = readRecord(target.durable_state)
  const runtimeState = readRecord(target.runtime_state)
  return {
    slot_id: String(target.slot_id ?? slot),
    status: String(target.status ?? "unknown"),
    state: String(target.state ?? "unknown"),
    slot_phase: String(target.slot_phase ?? "unknown"),
    runtime_state: String(runtimeState.state ?? "unknown"),
    active_run_count: readNumber(activity.active_run_count),
    durable_active_runs: readNumber(durable.active_runs),
    queued_runs: readNumber(durable.queued_runs),
    warnings: Array.isArray(target.warnings) ? target.warnings.slice(0, 12) : [],
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
