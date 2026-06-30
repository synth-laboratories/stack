#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type TelemetryContract = {
  forbidden_fields: string[]
  events: Array<{
    name: string
    class: string
    owner: string
    payload: string[]
  }>
}

type GrowthPayload = {
  event_name: string
  correlation_id: string
  product: string
  campaign_id: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content?: string
  growth_action_id: string
  target_url?: string
  referrer_url?: string
  source_page_type?: string
  metadata: Record<string, string | number | boolean>
}

const stackRoot = join(import.meta.dir, "..")
const liveUrl = readArg("--live-url") ?? process.env.STACK_GROWTH_INGESTION_LIVE_URL?.trim()
const allowProdPost = process.argv.includes("--allow-prod-post") || process.env.STACK_GROWTH_ALLOW_PROD_POST === "1"
const stamp = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`
const proofDir = join(stackRoot, ".stack", "evidence", "growth-ingestion", stamp)
const contract = JSON.parse(readFileSync(join(stackRoot, "docs", "TELEMETRY_EVENTS.json"), "utf8")) as TelemetryContract
const failures: string[] = []

const requiredStackEvents = [
  "stack_docs_cta_clicked",
  "stack_download_clicked",
  "stack_release_asset_downloaded",
  "stack_installer_started",
  "stack_installer_succeeded",
  "stack_installer_failed",
]

const backendAllowedNames = new Set([
  "cta_destination_reached",
  "signup_intent",
  "signup_completed",
  "skill_download_clicked",
  "docs_cta_clicked",
  "blog_cta_clicked",
])

const mapping: Record<string, GrowthPayload["event_name"]> = {
  stack_docs_cta_clicked: "docs_cta_clicked",
  stack_download_clicked: "skill_download_clicked",
  stack_release_asset_downloaded: "skill_download_clicked",
  stack_installer_started: "skill_download_clicked",
  stack_installer_succeeded: "cta_destination_reached",
  stack_installer_failed: "skill_download_clicked",
}

const payloads = requiredStackEvents.map((name, index) => buildPayload(name, index))

for (const eventName of requiredStackEvents) {
  const event = contract.events.find((entry) => entry.name === eventName)
  if (!event) failures.push(`missing telemetry event ${eventName}`)
  if (event && event.class !== "public_acquisition" && event.class !== "installer") {
    failures.push(`${eventName}: expected public_acquisition or installer class, got ${event.class}`)
  }
  if (!mapping[eventName]) failures.push(`${eventName}: missing backend mapping`)
}

for (const payload of payloads) {
  if (!backendAllowedNames.has(payload.event_name)) failures.push(`${payload.metadata.stack_event_name}: backend event_name is not allowlisted`)
  if (payload.product !== "stack") failures.push(`${payload.metadata.stack_event_name}: product must be stack`)
  if (payload.campaign_id !== "stack-nightly-1") failures.push(`${payload.metadata.stack_event_name}: campaign_id mismatch`)
  if (payload.utm_campaign !== "stack-nightly-1") failures.push(`${payload.metadata.stack_event_name}: utm_campaign mismatch`)
  if (payload.growth_action_id !== "2026-06-30-stack-nightly-1") failures.push(`${payload.metadata.stack_event_name}: growth_action_id mismatch`)
  for (const forbidden of contract.forbidden_fields) {
    if (containsKey(payload, forbidden)) failures.push(`${payload.metadata.stack_event_name}: includes forbidden key ${forbidden}`)
  }
}

const liveGuardFailure = liveUrl && isProdUrl(liveUrl) && !allowProdPost
if (liveGuardFailure) {
  failures.push("prod live POST requires --allow-prod-post or STACK_GROWTH_ALLOW_PROD_POST=1")
}
const liveResults = liveUrl && !liveGuardFailure ? await postLivePayloads(liveUrl, payloads) : []
for (const result of liveResults) {
  if (!result.ok) {
    const suffix = result.error_class ? ` (${result.error_class})` : ""
    failures.push(`${result.stack_event_name}: live POST failed with ${result.status}${suffix}`)
  }
}
const live = Boolean(liveUrl)
const postAttempted = liveResults.length > 0
const posted = live && liveResults.length === payloads.length && liveResults.every((result) => result.ok)

mkdirSync(proofDir, { recursive: true })
const summary = {
  ok: failures.length === 0,
  route: "/api/v1/growth/funnel-events",
  method: "POST",
  mode: liveUrl ? "live" : "local-contract",
  live,
  post_attempted: postAttempted,
  posted,
  live_url: liveUrl ? redactLiveUrl(liveUrl) : null,
  prod_post_allowed: allowProdPost,
  campaign_id: "stack-nightly-1",
  growth_action_id: "2026-06-30-stack-nightly-1",
  payload_count: payloads.length,
  stack_events: requiredStackEvents,
  backend_event_names: [...new Set(payloads.map((payload) => payload.event_name))],
  payloads,
  live_results: liveResults,
  failures,
}
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
writeFileSync(join(stackRoot, ".stack", "evidence", "growth-ingestion", "latest.json"), `${JSON.stringify({ ...summary, proof: join(proofDir, "summary.json") }, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`growth_ingestion_smoke_failed: ${failures.join("; ")}`)
  console.error(JSON.stringify(summary, null, 2))
  process.exit(1)
}

console.log("growth_ingestion_smoke_ok")
console.log(JSON.stringify(summary, null, 2))

function buildPayload(stackEventName: string, index: number): GrowthPayload {
  const telemetryEvent = contract.events.find((entry) => entry.name === stackEventName)
  const metadata: Record<string, string | number | boolean> = {
    stack_event_name: stackEventName,
    stack_event_owner: telemetryEvent?.owner ?? "unknown",
  }
  for (const field of telemetryEvent?.payload ?? []) {
    metadata[field] = sampleValue(field)
  }
  return {
    event_name: mapping[stackEventName] ?? "skill_download_clicked",
    correlation_id: `stack-nightly-1-${String(index + 1).padStart(2, "0")}`,
    product: "stack",
    campaign_id: "stack-nightly-1",
    utm_source: stackEventName.includes("docs") ? "docs" : "release",
    utm_medium: "cta",
    utm_campaign: "stack-nightly-1",
    utm_content: stackEventName,
    growth_action_id: "2026-06-30-stack-nightly-1",
    target_url: "https://stack.usesynth.ai/install.sh",
    referrer_url: "https://docs.usesynth.ai/stack/overview",
    source_page_type: stackEventName.includes("docs") ? "docs" : "release-edge",
    metadata,
  }
}

function sampleValue(field: string): string {
  switch (field) {
    case "campaign":
      return "stack-nightly-1"
    case "source":
      return "docs"
    case "medium":
      return "cta"
    case "channel":
      return "nightly"
    case "target":
      return "aarch64-apple-darwin"
    case "version":
      return "0.2.0-dev.20260629.1"
    case "asset_kind":
      return "tarball"
    case "installer_version":
      return "0.1.0"
    case "duration_bucket":
      return "lt_60s"
    case "error_code":
      return "checksum_failed"
    default:
      return "unknown"
  }
}

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false
  if (Object.prototype.hasOwnProperty.call(value, key)) return true
  return Object.values(value as Record<string, unknown>).some((entry) => containsKey(entry, key))
}

async function postLivePayloads(baseUrl: string, rows: GrowthPayload[]): Promise<Array<{
  stack_event_name: string
  status: number
  ok: boolean
  event_id?: string
  error_class?: string
}>> {
  const endpoint = new URL("/api/v1/growth/funnel-events", normalizeBaseUrl(baseUrl))
  const results = []
  for (const payload of rows) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      let eventId: string | undefined
      try {
        const body = await response.json() as { event_id?: unknown }
        if (typeof body.event_id === "string") eventId = body.event_id
      } catch {
        // Keep response bodies out of launch evidence.
      }
      results.push({
        stack_event_name: String(payload.metadata.stack_event_name),
        status: response.status,
        ok: response.ok,
        event_id: eventId,
      })
    } catch (error) {
      results.push({
        stack_event_name: String(payload.metadata.stack_event_name),
        status: 0,
        ok: false,
        error_class: classifyNetworkError(error),
      })
    }
  }
  return results
}

function classifyNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_network_error"
  const message = error.message.toLowerCase()
  if (message.includes("dns") || message.includes("resolve") || message.includes("typo")) return "dns_or_unresolved_host"
  if (message.includes("connect") || message.includes("connection") || message.includes("refused")) return "connection_failed"
  if (message.includes("timeout")) return "timeout"
  return error.name ? error.name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase() : "network_error"
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

function redactLiveUrl(value: string): string {
  const url = new URL(normalizeBaseUrl(value))
  url.username = ""
  url.password = ""
  return url.toString().replace(/\/$/, "")
}

function isProdUrl(value: string): boolean {
  const host = new URL(normalizeBaseUrl(value)).hostname.toLowerCase()
  return host === "api.usesynth.ai"
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]?.trim() || undefined
}
