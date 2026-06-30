#!/usr/bin/env bun

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stackChannel, stackVersion } from "../src/version.ts"

type PacketItem = {
  id: string
  owner: string
  status: "ready" | "partial" | "missing"
  evidence: string
  next_action: string
}

type CandidateProof = {
  path: string
  candidate_state: "selected" | "not_ready" | "not_selected" | string
  short_sha?: string
  dirty?: boolean
  advertised_channel?: string
}

const stackRoot = join(import.meta.dir, "..")
const args = new Set(process.argv.slice(2))
const writeEvidence = args.has("--write-evidence")
const bombadilB0 = latestPassingProof("bombadil-b0", "AT-STACK-BOMBADIL-B0")
const docsAlignment = latestLaunchDocsAlignmentProof()
const telemetryContract = latestOkSummary("telemetry-contract")
const installerApplyRollback = latestOkSummary("installer-apply-rollback")
const releaseArtifact = latestReleaseArtifactProof()
const releaseSiteContract = latestOkSummary("release-site-contract")
const artifactSecurity = latestArtifactSecurityProof()
const candidateProof = latestCandidateProof()
const cutPlanProof = latestCutPlanProof()
const essentialsProof = latestEssentialsProof()
const growthIngestion = latestOkSummary("growth-ingestion")
const distributionProofs = [
  installerApplyRollback ? `installer apply/rollback ${installerApplyRollback}` : undefined,
  releaseArtifact ? `release artifact ${releaseArtifact}` : undefined,
  releaseSiteContract ? `release-site activation ${releaseSiteContract}` : undefined,
  artifactSecurity ? `artifact security ${artifactSecurity}` : undefined,
].filter((entry): entry is string => Boolean(entry))

const items: PacketItem[] = [
  item("prod-channel", "stack", candidateProof?.candidate_state === "selected" ? "ready" : exists("docs/NIGHTLY_1.md") && exists("docs/RELEASE.md") ? "partial" : "missing",
    candidateProof
      ? `docs/NIGHTLY_1.md; docs/RELEASE.md; candidate ${candidateProof.candidate_state} ${candidateProof.short_sha ?? "unknown-sha"} ${candidateProof.advertised_channel ?? "unknown-channel"} dirty=${String(candidateProof.dirty)} proof ${candidateProof.path}${cutPlanProof ? `; cut-plan ${cutPlanProof}` : ""}`
      : "docs/NIGHTLY_1.md; docs/RELEASE.md; no candidate proof found",
    candidateProof?.candidate_state === "selected"
      ? "Publish immutable nightly artifacts and rerun clean install/use proof against the selected SHA."
      : cutPlanProof
      ? `Review the cut-plan pathspecs, split the launch candidate slice, then run launch:candidate -- --select and record it in Jstack before announcing.${essentialsProof ? ` Essentials proof: ${essentialsProof}.` : ""}`
      : "Select the actual candidate commit/channel with launch:candidate -- --select and record it in Jstack before announcing."),
  item("distribution-downloads", "stack", exists("docs/DISTRIBUTION.md") ? "partial" : "missing",
    distributionProofs.length > 0
      ? `docs/DISTRIBUTION.md; packaging/install.sh; ${distributionProofs.join("; ")}`
      : exists("packaging/install.sh") && exists("src/update.ts") && exists("packaging/manifests/nightly.example.json")
      ? "docs/DISTRIBUTION.md; packaging/install.sh; smoke:installer:contract; smoke:installer:apply-rollback; smoke:release-artifact:local; smoke:release-site:contract; stack update --check; packaging/manifests/nightly.example.json"
      : exists("src/update.ts") && exists("packaging/manifests/nightly.example.json")
      ? "docs/DISTRIBUTION.md; stack update --check is wired; packaging/manifests/nightly.example.json"
      : "docs/DISTRIBUTION.md",
    exists("packaging/install.sh") && exists("src/update.ts") && exists("packaging/manifests/nightly.example.json")
      ? "Select the candidate, publish immutable artifacts, wire hosted/public download ingestion, and rerun clean install/use proof against the candidate."
      : exists("src/update.ts") && exists("packaging/manifests/nightly.example.json")
      ? "Build installer download/apply/rollback, publish immutable artifacts, and wire download events."
      : "Build manifest-backed installer, publish immutable artifacts, and wire download events."),
  item("telemetry-privacy", "stack+backend", exists("docs/TELEMETRY.md") ? "partial" : "missing",
    telemetryContract && growthIngestion && exists("crates/stackd/src/handlers/telemetry.rs")
      ? `docs/TELEMETRY.md; docs/TELEMETRY_EVENTS.json; docs/GROWTH_INGESTION.md; telemetry contract ${telemetryContract}; growth ingestion ${growthIngestion}; smoke:stackd:telemetry; GET /telemetry/status; POST /telemetry/events`
      : telemetryContract && exists("crates/stackd/src/handlers/telemetry.rs")
      ? `docs/TELEMETRY.md; docs/TELEMETRY_EVENTS.json; telemetry contract ${telemetryContract}; smoke:stackd:telemetry; GET /telemetry/status; POST /telemetry/events`
      : exists("docs/TELEMETRY_EVENTS.json") && exists("crates/stackd/src/handlers/telemetry.rs")
      ? "docs/TELEMETRY.md; docs/TELEMETRY_EVENTS.json; smoke:telemetry:contract; smoke:stackd:telemetry; GET /telemetry/status; POST /telemetry/events"
      : exists("docs/TELEMETRY_EVENTS.json") ? "docs/TELEMETRY.md; docs/TELEMETRY_EVENTS.json; smoke:telemetry:contract" : "docs/TELEMETRY.md",
    exists("docs/TELEMETRY_EVENTS.json") && exists("crates/stackd/src/handlers/telemetry.rs")
      ? "Run staging/prod live POST proof for download/signup/use events against the growth endpoint before decision-grade readouts; keep local product telemetry opt-in."
      : exists("docs/TELEMETRY_EVENTS.json")
      ? "Implement stackd-owned telemetry status/config/emission and backend stack-events endpoint against the allowlist before decision-grade readouts."
      : "Implement stackd-owned telemetry config/emission and backend stack-events endpoint before decision-grade readouts."),
  item("tui-bombadil-b0", "stack", bombadilB0 ? "ready" : exists("scripts/smoke_bombadil_b0.ts") ? "partial" : "missing",
    bombadilB0 ?? (exists("scripts/smoke_bombadil_b0.ts") ? "smoke:bombadil:b0 is wired; no passing durable proof found" : "smoke:bombadil:b0 missing"),
    bombadilB0
      ? "Add B1 handoff/update/auth rail scenarios after Nightly 1 essentials are stable."
      : "Run bun run smoke:bombadil:b0 and cite the durable proof before broad dogfood."),
  item("docs", "stack+docs", docsAlignment ? "ready" : exists("README.md") && exists("docs/LAUNCH_READINESS.md") ? "partial" : "missing",
    docsAlignment
      ? `smoke:launch-docs-alignment proof ${docsAlignment}`
      : exists("scripts/smoke_launch_docs_alignment.ts")
      ? "README.md; docs/LAUNCH_READINESS.md; docs/QUALITY.md; smoke:launch-docs-alignment wired"
      : "README.md; docs/LAUNCH_READINESS.md; docs/QUALITY.md",
    docsAlignment
      ? "Rerun docs alignment smoke on the selected candidate and before announcement copy changes."
      : exists("scripts/smoke_launch_docs_alignment.ts")
      ? "Run docs alignment smoke and cite the proof before announcement copy changes."
      : "Verify Mintlify Stack overview/changelog agree with repo docs before public announcement."),
  item("marketing", "growth", exists("../growth/src/marketing/blogs/planned/stack-handoffs/README.md") ? "partial" : "missing",
    "../growth/src/marketing/blogs/planned/stack-handoffs/README.md",
    "Keep blog draft private until proof packet and launch checklist are green."),
  item("first-value", "stack", exists("scripts/smoke_first_run_local.ts") ? "ready" : exists("src/doctor.ts") && exists("src/demo.ts") ? "partial" : exists("src/doctor.ts") ? "partial" : "missing",
    exists("scripts/smoke_first_run_local.ts")
      ? "smoke:first-run:local proves stack doctor --json, stack demo --json receipt, and stack update --check --json."
      : exists("src/doctor.ts") && exists("src/demo.ts") ? "stack doctor and stack demo are wired; demo writes a local receipt." : exists("src/doctor.ts") ? "stack doctor is wired; receipt-producing demo remains open." : "No stack demo/doctor receipt command is wired in this packet yet.",
    exists("scripts/smoke_first_run_local.ts")
      ? "Rerun make smoke-first-run-local on the selected candidate and cite the proof directory in the Jstack ship record."
      : "Run stack demo on the selected candidate and cite the receipt path in the Jstack ship record."),
]

const packet = {
  generated_at: new Date().toISOString(),
  packet_id: "stack-nightly-1",
  stack_version: stackVersion(stackRoot),
  stack_channel: stackChannel(stackRoot),
  launch_state: "not_launched",
  items,
  summary: summarize(items),
}

console.log(`Stack Nightly 1 packet · ${packet.stack_version} · ${packet.stack_channel} · ${packet.launch_state}`)
for (const entry of items) {
  console.log(`${entry.id.padEnd(24)} ${entry.status.padEnd(8)} ${entry.owner} · ${entry.evidence}`)
  if (entry.status !== "ready") console.log(`  next: ${entry.next_action}`)
}
console.log(`summary ${JSON.stringify(packet.summary)}`)

if (writeEvidence) {
  const dir = process.env.STACK_NIGHTLY1_EVIDENCE_DIR?.trim() || join(stackRoot, ".stack", "evidence", "nightly-1")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "latest.json")
  writeFileSync(path, `${JSON.stringify(packet, null, 2)}\n`)
  console.log(`stack_nightly1_packet_evidence ${path}`)
}

console.log("stack_nightly1_packet_ok")

function exists(relativePath: string): boolean {
  return existsSync(join(stackRoot, relativePath))
}

function latestPassingProof(area: string, checkId: string): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", area)
  if (!existsSync(evidenceRoot)) return undefined
  const proofPaths = readdirSync(evidenceRoot)
    .sort()
    .reverse()
    .map((entry) => join(evidenceRoot, entry, "proof.json"))
    .filter((path) => existsSync(path))
  for (const proofPath of proofPaths) {
    try {
      const proof = JSON.parse(readFileSync(proofPath, "utf8")) as { check_id?: unknown; status?: unknown }
      if (proof.check_id === checkId && proof.status === "pass") return proofPath
    } catch {
      // Ignore malformed old proof files.
    }
  }
  return undefined
}

function latestLaunchDocsAlignmentProof(): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", "launch-docs-alignment")
  if (!existsSync(evidenceRoot)) return undefined
  const summaryPaths = readdirSync(evidenceRoot)
    .sort()
    .reverse()
    .map((entry) => join(evidenceRoot, entry, "summary.json"))
    .filter((path) => existsSync(path))
  for (const summaryPath of summaryPaths) {
    try {
      const proof = JSON.parse(readFileSync(summaryPath, "utf8")) as { ok?: unknown }
      if (proof.ok === true) return summaryPath
    } catch {
      // Ignore malformed old proof files.
    }
  }
  return undefined
}

function latestOkSummary(area: string): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", area)
  if (!existsSync(evidenceRoot)) return undefined
  const summaryPaths = readdirSync(evidenceRoot)
    .sort()
    .reverse()
    .map((entry) => join(evidenceRoot, entry, "summary.json"))
    .filter((path) => existsSync(path))
  for (const summaryPath of summaryPaths) {
    try {
      const proof = JSON.parse(readFileSync(summaryPath, "utf8")) as { ok?: unknown }
      if (proof.ok === true) return summaryPath
    } catch {
      // Ignore malformed old proof files.
    }
  }
  return undefined
}

function latestReleaseArtifactProof(): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", "release-artifact")
  if (!existsSync(evidenceRoot)) return undefined
  const summaryPaths = readdirSync(evidenceRoot)
    .sort()
    .reverse()
    .map((entry) => join(evidenceRoot, entry, "summary.json"))
    .filter((path) => existsSync(path))
  for (const summaryPath of summaryPaths) {
    try {
      const proof = JSON.parse(readFileSync(summaryPath, "utf8")) as { ok?: unknown; publishable?: unknown }
      if (proof.ok === true && proof.publishable === true) return summaryPath
    } catch {
      // Ignore malformed old proof files.
    }
  }
  return undefined
}

function latestArtifactSecurityProof(): string | undefined {
  const path = join(stackRoot, ".stack", "evidence", "artifact-security", "latest.json")
  if (!existsSync(path)) return undefined
  try {
    const proof = JSON.parse(readFileSync(path, "utf8")) as { ok?: unknown; proof?: unknown }
    if (proof.ok === true && typeof proof.proof === "string") return proof.proof
    if (proof.ok === true) return path
  } catch {
    return undefined
  }
  return undefined
}

function latestProof(area: string): string | undefined {
  const path = join(stackRoot, ".stack", "evidence", area, "latest.json")
  if (!existsSync(path)) return undefined
  try {
    const proof = JSON.parse(readFileSync(path, "utf8")) as { ok?: unknown; proof?: unknown }
    if (proof.ok === true && typeof proof.proof === "string") return proof.proof
    if (proof.ok === true) return path
  } catch {
    return undefined
  }
  return undefined
}

function latestCandidateProof(): CandidateProof | undefined {
  const path = join(stackRoot, ".stack", "evidence", "nightly-candidate", "latest.json")
  if (!existsSync(path)) return undefined
  try {
    const proof = JSON.parse(readFileSync(path, "utf8")) as {
      proof?: unknown
      candidate_state?: unknown
      short_sha?: unknown
      dirty?: unknown
      advertised_channel?: unknown
    }
    return {
      path: typeof proof.proof === "string" ? proof.proof : path,
      candidate_state: typeof proof.candidate_state === "string" ? proof.candidate_state : "not_ready",
      short_sha: typeof proof.short_sha === "string" ? proof.short_sha : undefined,
      dirty: typeof proof.dirty === "boolean" ? proof.dirty : undefined,
      advertised_channel: typeof proof.advertised_channel === "string" ? proof.advertised_channel : undefined,
    }
  } catch {
    return undefined
  }
}

function latestCutPlanProof(): string | undefined {
  const path = join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest.json")
  if (!existsSync(path)) return undefined
  try {
    const proof = JSON.parse(readFileSync(path, "utf8")) as { proof?: unknown }
    return typeof proof.proof === "string" ? proof.proof : path
  } catch {
    return undefined
  }
}

function latestEssentialsProof(): string | undefined {
  const path = join(stackRoot, ".stack", "evidence", "nightly-1-essentials", "latest.json")
  if (!existsSync(path)) return undefined
  try {
    const proof = JSON.parse(readFileSync(path, "utf8")) as { proof?: unknown }
    return typeof proof.proof === "string" ? proof.proof : path
  } catch {
    return undefined
  }
}

function item(
  id: string,
  owner: string,
  status: PacketItem["status"],
  evidence: string,
  next_action: string,
): PacketItem {
  return { id, owner, status, evidence, next_action }
}

function summarize(entries: PacketItem[]): Record<PacketItem["status"], number> {
  return entries.reduce(
    (summary, entry) => {
      summary[entry.status] += 1
      return summary
    },
    { ready: 0, partial: 0, missing: 0 },
  )
}
