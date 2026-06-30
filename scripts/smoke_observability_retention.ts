#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

const evidenceDir = readArg("--evidence-dir") ?? process.env.STACK_OBSERVABILITY_EVIDENCE_DIR
const slot = process.env.STACK_VL_SLOT ?? "slot1"
const container = process.env.STACK_VL_CONTAINER ?? `synth-${slot}-victorialogs-1`
const metricsUrl = process.env.STACK_VL_METRICS_URL ?? metricsUrlForSlot(slot)
const expectedRetention = process.env.STACK_VL_EXPECTED_RETENTION ?? "7d"
const expectedDiskCapBytes = parseBytes(process.env.STACK_VL_EXPECTED_DISK_CAP ?? "2GiB")

const inspect = await run(["docker", "inspect", container, "--format", "{{json .Args}} {{.Created}}"])
if (inspect.exitCode !== 0) {
  fail(`docker inspect failed for ${container}: ${inspect.stderr || inspect.stdout}`)
}
const argsEnd = inspect.stdout.indexOf("] ")
if (argsEnd < 0) fail(`unexpected docker inspect output for ${container}: ${inspect.stdout}`)
const args = JSON.parse(inspect.stdout.slice(0, argsEnd + 1)) as string[]
const createdAt = inspect.stdout.slice(argsEnd + 2).trim()

const disk = await run(["docker", "exec", container, "du", "-sb", "/victoria-logs-data"])
if (disk.exitCode !== 0) fail(`docker exec du failed for ${container}: ${disk.stderr || disk.stdout}`)
const usedBytes = Number(disk.stdout.trim().split(/\s+/)[0])
if (!Number.isFinite(usedBytes)) fail(`unexpected du output for ${container}: ${disk.stdout}`)

const metricsResponse = await fetch(metricsUrl)
if (!metricsResponse.ok) {
  fail(`VictoriaLogs metrics failed at ${metricsUrl}: HTTP ${metricsResponse.status}`)
}
const metrics = await metricsResponse.text()
const retentionMetric = readFlag(metrics, "retentionPeriod")
const diskCapMetric = readFlag(metrics, "retention.maxDiskSpaceUsageBytes")

const hasRetentionArg = args.includes(`-retentionPeriod=${expectedRetention}`)
const hasDiskCapArg = args.includes(`-retention.maxDiskSpaceUsageBytes=${formatGiB(expectedDiskCapBytes)}`)
const retentionLive = retentionMetric?.value === expectedRetention && retentionMetric.isSet
const diskCapLive = Number(diskCapMetric?.value ?? 0) === expectedDiskCapBytes && diskCapMetric?.isSet === true
const underCap = usedBytes < expectedDiskCapBytes

const errors: string[] = []
if (!hasRetentionArg) errors.push(`missing live arg -retentionPeriod=${expectedRetention}`)
if (!hasDiskCapArg) errors.push(`missing live arg -retention.maxDiskSpaceUsageBytes=${formatGiB(expectedDiskCapBytes)}`)
if (!retentionLive) {
  errors.push(`metrics flag retentionPeriod=${retentionMetric?.value ?? "missing"} is_set=${retentionMetric?.isSet ?? false}`)
}
if (!diskCapLive) {
  errors.push(`metrics flag retention.maxDiskSpaceUsageBytes=${diskCapMetric?.value ?? "missing"} is_set=${diskCapMetric?.isSet ?? false}`)
}
if (!underCap) errors.push(`data size ${usedBytes} >= cap ${expectedDiskCapBytes}`)

const summary = {
  slot,
  container,
  created_at: createdAt,
  metrics_url: metricsUrl,
  expected_retention: expectedRetention,
  expected_disk_cap_bytes: expectedDiskCapBytes,
  args,
  metrics_retention: retentionMetric,
  metrics_disk_cap: diskCapMetric,
  data_size_bytes: usedBytes,
  under_cap: underCap,
}

if (errors.length > 0) {
  const result = { ok: false, errors, ...summary }
  writeEvidence(result)
  console.error(JSON.stringify(result, null, 2))
  process.exit(1)
}

const result = { ok: true, ...summary }
writeEvidence(result)
console.log(JSON.stringify(result, null, 2))

async function run(command: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

function readFlag(metrics: string, name: string): { value: string; isSet: boolean } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`^flag\\{name="${escaped}", value="([^"]*)", is_set="(true|false)"\\} 1$`, "m")
  const match = metrics.match(pattern)
  if (!match) return null
  return { value: match[1] ?? "", isSet: match[2] === "true" }
}

function metricsUrlForSlot(value: string): string {
  const match = value.match(/^slot(\d+)$/)
  if (!match) return "http://127.0.0.1:9428/metrics"
  const slotNumber = Number(match[1])
  if (!Number.isFinite(slotNumber) || slotNumber < 1) return "http://127.0.0.1:9428/metrics"
  return `http://127.0.0.1:${9427 + slotNumber}/metrics`
}

function parseBytes(value: string): number {
  const match = value.trim().match(/^(\d+)(GiB|MiB|KiB|B)?$/)
  if (!match) fail(`invalid byte value: ${value}`)
  const amount = Number(match[1])
  const unit = match[2] ?? "B"
  const multiplier = unit === "GiB" ? 1024 ** 3 : unit === "MiB" ? 1024 ** 2 : unit === "KiB" ? 1024 : 1
  return amount * multiplier
}

function formatGiB(bytes: number): string {
  if (bytes % (1024 ** 3) === 0) return `${bytes / (1024 ** 3)}GiB`
  return `${bytes}B`
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function writeEvidence(value: Record<string, unknown>): void {
  if (!evidenceDir) return
  const dir = resolve(evidenceDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "retention_smoke_result.json"), `${JSON.stringify(value, null, 2)}\n`)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
