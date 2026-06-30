#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type TelemetryContract = {
  schema_version: number
  default_local_product_telemetry: string
  forbidden_fields: string[]
  events: Array<{
    name: string
    class: string
    owner: string
    payload: string[]
  }>
}

const appRoot = resolve(import.meta.dir, "..")
const path = resolve(appRoot, "docs", "TELEMETRY_EVENTS.json")
const contract = JSON.parse(readFileSync(path, "utf8")) as TelemetryContract
const stamp = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`
const proofDir = resolve(appRoot, ".stack", "evidence", "telemetry-contract", stamp)
const failures: string[] = []

if (contract.schema_version !== 1) failures.push("schema_version must be 1")
if (contract.default_local_product_telemetry !== "off") failures.push("local product telemetry must default off")

const names = new Set<string>()
for (const event of contract.events) {
  if (!/^stack_[a-z0-9_]+$/.test(event.name)) failures.push(`${event.name}: event name must be stack_snake_case`)
  if (names.has(event.name)) failures.push(`${event.name}: duplicate event`)
  names.add(event.name)
  if (!event.owner) failures.push(`${event.name}: missing owner`)
  if (!event.class) failures.push(`${event.name}: missing class`)
  for (const field of event.payload) {
    if (!/^[a-z0-9_]+$/.test(field)) failures.push(`${event.name}: payload field ${field} must be snake_case`)
    if (contract.forbidden_fields.includes(field)) failures.push(`${event.name}: forbidden payload field ${field}`)
  }
}

const acquisitionEvents = [
  "stack_docs_cta_clicked",
  "stack_download_clicked",
  "stack_release_asset_downloaded",
  "stack_installer_started",
  "stack_installer_succeeded",
  "stack_installer_failed",
]
const localProductEvents = [
  "stack_first_launch",
  "stack_doctor_run",
  "stack_local_demo_started",
  "stack_local_demo_succeeded",
  "stack_receipt_created",
  "stack_update_check",
  "stack_meta_thread_created",
  "stack_handoff_sealed",
  "stack_handoff_continued",
]

for (const required of [...acquisitionEvents, ...localProductEvents]) {
  if (!names.has(required)) failures.push(`missing required event ${required}`)
}

for (const name of acquisitionEvents) {
  const event = contract.events.find((candidate) => candidate.name === name)
  if (event?.class !== "public_acquisition" && event?.class !== "installer") {
    failures.push(`${name}: acquisition/download event has unexpected class ${event?.class ?? "missing"}`)
  }
  if (event?.owner !== "docs_frontend" && event?.owner !== "release_edge") {
    failures.push(`${name}: acquisition/download event has unexpected owner ${event?.owner ?? "missing"}`)
  }
}

for (const name of localProductEvents) {
  const event = contract.events.find((candidate) => candidate.name === name)
  if (event?.class !== "local_product_opt_in") {
    failures.push(`${name}: local product event must be opt-in`)
  }
  if (event?.owner !== "stackd") {
    failures.push(`${name}: local product event must be stackd-owned`)
  }
}

for (const forbidden of ["prompt", "transcript", "source_code", "artifact_body", "raw_path", "path", "secret", "env", "command", "raw_ip"]) {
  if (!contract.forbidden_fields.includes(forbidden)) failures.push(`missing forbidden field ${forbidden}`)
}

mkdirSync(proofDir, { recursive: true })
const summary = {
  ok: failures.length === 0,
  path,
  proof_dir: proofDir,
  event_count: contract.events.length,
  acquisition_events: acquisitionEvents,
  local_product_events: localProductEvents,
  default_local_product_telemetry: contract.default_local_product_telemetry,
  forbidden_fields_checked: ["prompt", "transcript", "source_code", "artifact_body", "raw_path", "path", "secret", "env", "command", "raw_ip"],
}
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`telemetry_contract_smoke_failed: ${failures.join("; ")}`)
  console.error(JSON.stringify(summary, null, 2))
  process.exit(1)
}

console.log("telemetry_contract_smoke_ok")
console.log(JSON.stringify(summary, null, 2))
