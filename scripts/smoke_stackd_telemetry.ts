#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { stackdHealth, stackdRecordTelemetryEvent, stackdTelemetryStatus } from "../src/client/stackd.ts"

const appRoot = resolve(import.meta.dir, "..")
process.env.STACK_ROOT = appRoot

const port = 19240 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const stackdBin = join(appRoot, "target/debug/stackd")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)
const proofDir = join(appRoot, ".stack", "evidence", "stackd-telemetry", `${stamp}-${randomUUID().slice(0, 8)}`)
const outboxPath = join(proofDir, "telemetry-events.jsonl")
await mkdir(proofDir, { recursive: true })

const failures: string[] = []

await withStackd({ telemetry: "0", outboxPath }, async () => {
  const status = await stackdTelemetryStatus(baseUrl)
  const names = new Set(status.events.map((event) => event.name))

  if (!status.ok) failures.push("status ok=false")
  if (status.schema_version !== 1) failures.push(`unexpected schema ${status.schema_version}`)
  if (status.local_product_telemetry.enabled) failures.push("local telemetry should default off")
  if (status.local_product_telemetry.default !== "off") failures.push("default local telemetry should be off")
  if (status.event_count !== 15) failures.push(`expected 15 events, got ${status.event_count}`)
  for (const required of ["stack_download_clicked", "stack_receipt_created", "stack_update_check"]) {
    if (!names.has(required)) failures.push(`missing event ${required}`)
  }
  for (const forbidden of ["prompt", "transcript", "raw_path", "secret", "raw_ip"]) {
    if (!status.forbidden_fields.includes(forbidden)) failures.push(`missing forbidden field ${forbidden}`)
  }

  const skipped = await stackdRecordTelemetryEvent({
    name: "stack_update_check",
    payload: { requested_channel: "nightly", status: "current" },
  }, baseUrl)
  if (!skipped.accepted) failures.push("default-off telemetry event should validate")
  if (skipped.emitted) failures.push("default-off telemetry event should not emit")
  if (existsSync(outboxPath)) failures.push("default-off telemetry wrote an outbox event")
})

await withStackd({ telemetry: "1", outboxPath }, async () => {
  const emitted = await stackdRecordTelemetryEvent({
    name: "stack_update_check",
    payload: { requested_channel: "nightly", status: "available" },
  }, baseUrl)
  if (!emitted.accepted) failures.push("opt-in telemetry event should validate")
  if (!emitted.emitted) failures.push("opt-in telemetry event should emit")
  if (emitted.outbox_path !== outboxPath) failures.push("opt-in telemetry event used unexpected outbox path")

  const text = await readFile(outboxPath, "utf8").catch(() => "")
  const rows = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
  if (rows.length !== 1) failures.push(`expected one telemetry outbox row, got ${rows.length}`)
  const payload = rows[0]?.payload as Record<string, unknown> | undefined
  if (rows[0]?.name !== "stack_update_check") failures.push("outbox event name mismatch")
  if (payload?.requested_channel !== "nightly") failures.push("outbox requested_channel mismatch")
  if (payload?.status !== "available") failures.push("outbox status mismatch")
  if (typeof payload?.version !== "string") failures.push("outbox missing server-filled version")
  if (typeof payload?.channel !== "string") failures.push("outbox missing server-filled channel")
  if (typeof payload?.target !== "string") failures.push("outbox missing server-filled target")
  for (const forbidden of ["prompt", "transcript", "raw_path", "secret", "raw_ip"]) {
    if (text.includes(forbidden)) failures.push(`outbox includes forbidden marker ${forbidden}`)
  }

  await expectBadRequest({
    name: "stack_update_check",
    payload: { requested_channel: "nightly", status: "available", path: "/tmp/secret" },
  }, "forbidden payload field")
  await expectBadRequest({
    name: "stack_download_clicked",
    payload: { campaign: "nightly-1" },
  }, "non-stackd event")
})

  if (failures.length > 0) {
    console.error(`stackd_telemetry_smoke_failed: ${failures.join("; ")}`)
    process.exit(1)
  }

  console.log("stackd_telemetry_smoke_ok")
  console.log(JSON.stringify({
    proof_dir: proofDir,
    outbox_path: outboxPath,
    emitted_rows: 1,
    default_local_product_telemetry: "off",
  }, null, 2))

async function waitForStackd(baseUrl: string): Promise<void> {
  let lastError = "unknown"
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const health = await stackdHealth(baseUrl)
      if (health.ok) return
      lastError = JSON.stringify(health)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(250)
  }
  throw new Error(`stackd health failed: ${lastError}`)
}

async function withStackd(
  options: { telemetry: "0" | "1"; outboxPath: string },
  fn: () => Promise<void>,
): Promise<void> {
  const proc = Bun.spawn([stackdBin, "serve", "--port", String(port)], {
    cwd: appRoot,
    env: {
      ...process.env,
      STACK_ROOT: appRoot,
      STACKD_MONITOR_SCHEDULER: "0",
      STACK_TELEMETRY: options.telemetry,
      STACK_TELEMETRY_OUTBOX: options.outboxPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    await waitForStackd(baseUrl)
    await fn()
  } finally {
    proc.kill()
    await proc.exited.catch(() => undefined)
    await Bun.sleep(100)
  }
}

async function expectBadRequest(body: unknown, label: string): Promise<void> {
  const response = await fetch(new URL("/telemetry/events", `${baseUrl}/`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (response.status !== 400) {
    failures.push(`${label}: expected 400, got ${response.status}`)
  }
}
