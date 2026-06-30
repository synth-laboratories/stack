#!/usr/bin/env bun

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type Manifest = {
  channel?: string
  version?: string
  targets?: Record<string, {
    url?: string
    sha256?: string
    size?: number
    signature_url?: string
    attestation_url?: string
  }>
}

type ReleaseSummary = {
  manifest?: string
  channel?: string
  version?: string
  target?: string
  publishable?: boolean
}

const stackRoot = join(import.meta.dir, "..")
const stamp = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`
const proofDir = join(stackRoot, ".stack", "evidence", "artifact-security", stamp)
const waiverPath = join(stackRoot, "docs", "NIGHTLY_1_SECURITY_WAIVER.md")
const releaseSummaryPath = latestReleaseArtifactSummary()
const failures: string[] = []

const releaseSummary = releaseSummaryPath ? readJson<ReleaseSummary>(releaseSummaryPath) : undefined
if (!releaseSummaryPath) failures.push("no release artifact summary found")
if (releaseSummary?.publishable !== true) failures.push("latest release artifact summary is not publishable")
if (!releaseSummary?.manifest || !existsSync(releaseSummary.manifest)) failures.push("latest release artifact manifest is missing")

const manifest = releaseSummary?.manifest && existsSync(releaseSummary.manifest)
  ? readJson<Manifest>(releaseSummary.manifest)
  : undefined
const targetEntries = Object.entries(manifest?.targets ?? {})
if (targetEntries.length === 0) failures.push("manifest has no targets")

const targetResults = targetEntries.map(([target, entry]) => {
  const hasChecksum = /^[a-f0-9]{64}$/.test(entry.sha256 ?? "")
  const hasSignature = Boolean(entry.signature_url?.trim())
  const hasAttestation = Boolean(entry.attestation_url?.trim())
  if (!entry.url) failures.push(`${target}: missing artifact url`)
  if (!hasChecksum) failures.push(`${target}: missing valid sha256`)
  if (!entry.size || entry.size <= 0) failures.push(`${target}: missing artifact size`)
  return { target, has_checksum: hasChecksum, has_signature: hasSignature, has_attestation: hasAttestation }
})

const channel = manifest?.channel ?? releaseSummary?.channel ?? "unknown"
const waiver = readWaiver()
const requiresSignature = channel === "stable"
const signatureComplete = targetResults.length > 0 && targetResults.every((entry) => entry.has_signature && entry.has_attestation)
const waiverApplies = channel === "nightly" && waiver.active && waiver.nightlyOnly && waiver.shaRequired && waiver.stableExcluded

if (requiresSignature && !signatureComplete) {
  failures.push("stable artifacts require signature_url and attestation_url for every target")
}
if (!requiresSignature && !signatureComplete && !waiverApplies) {
  failures.push("nightly artifacts without signatures require an active Nightly 1 security waiver")
}

mkdirSync(proofDir, { recursive: true })
const summary = {
  ok: failures.length === 0,
  waived: !signatureComplete && waiverApplies,
  channel,
  version: manifest?.version ?? releaseSummary?.version,
  release_summary: releaseSummaryPath,
  manifest: releaseSummary?.manifest,
  waiver_path: waiverPath,
  waiver,
  target_results: targetResults,
  signature_complete: signatureComplete,
  failures,
}
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
writeFileSync(join(stackRoot, ".stack", "evidence", "artifact-security", "latest.json"), `${JSON.stringify({ ...summary, proof: join(proofDir, "summary.json") }, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`artifact_security_smoke_failed: ${failures.join("; ")}`)
  console.error(JSON.stringify(summary, null, 2))
  process.exit(1)
}

console.log("artifact_security_smoke_ok")
console.log(JSON.stringify(summary, null, 2))

function latestReleaseArtifactSummary(): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", "release-artifact")
  if (!existsSync(evidenceRoot)) return undefined
  const paths = readdirSync(evidenceRoot)
    .sort()
    .reverse()
    .map((entry) => join(evidenceRoot, entry, "summary.json"))
    .filter((path) => existsSync(path))
  for (const path of paths) {
    try {
      const summary = readJson<ReleaseSummary>(path)
      if (summary.publishable === true) return path
    } catch {
      // Ignore malformed old proof files.
    }
  }
  return undefined
}

function readWaiver(): { active: boolean; nightlyOnly: boolean; shaRequired: boolean; stableExcluded: boolean; reviewBefore?: string } {
  if (!existsSync(waiverPath)) {
    return { active: false, nightlyOnly: false, shaRequired: false, stableExcluded: false }
  }
  const text = readFileSync(waiverPath, "utf8")
  const review = text.match(/Review before:\s*([0-9-]+)/)?.[1]
  return {
    active: /Status:\s*active for Nightly 1 only\./.test(text),
    nightlyOnly: text.includes("channel: `nightly`") && text.includes("It does not apply to stable releases."),
    shaRequired: text.includes("artifact must include SHA256") && text.includes("installer must verify SHA256"),
    stableExcluded: text.includes("stable release without signature and provenance") && text.includes("signature_url") && text.includes("attestation_url"),
    reviewBefore: review,
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}
