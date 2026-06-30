#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stackChannel, stackVersion } from "../src/version.ts"

type GateState = "ready" | "needs_candidate" | "needs_live_proof" | "missing"

type Gate = {
  id: string
  state: GateState
  evidence: string
  next_action: string
}

type CandidateProof = {
  candidate_state?: string
  dirty?: boolean
  short_sha?: string
  proof?: string
}

type CutPlanProof = {
  proof?: string
  pathspec_dry_run?: Record<string, { ok?: boolean }>
  buckets?: Record<string, number>
  candidate_phases?: Record<string, unknown[]>
}

const stackRoot = join(import.meta.dir, "..")
const args = new Set(process.argv.slice(2))
const writeEvidence = args.has("--write-evidence")
const generatedAt = new Date().toISOString()
const stamp = `${generatedAt.replace(/[-:.]/g, "").slice(0, 15)}Z`

const candidate = readJson<CandidateProof>(".stack/evidence/nightly-candidate/latest.json")
const cutPlan = readJson<CutPlanProof>(".stack/evidence/nightly-cut-plan/latest.json")
const nightlyPacket = readJson<{ summary?: Record<string, number> }>(".stack/evidence/nightly-1/latest.json")
const readiness = readJson<{ summary?: Record<string, number> }>(".stack/evidence/launch-readiness/latest.json")

const gates: Gate[] = [
  gate(
    "candidate-cut-plan",
    cutPlanReady() ? "ready" : cutPlan ? "needs_candidate" : "missing",
    cutPlan?.proof ?? ".stack/evidence/nightly-cut-plan/latest.json missing",
    cutPlanReady()
      ? "Use the generated phase pathspecs to split the Nightly 1 candidate slice."
      : "Run bun run launch:cut-plan and fix any pathspec dry-run failures.",
  ),
  gate(
    "candidate-selected",
    candidate?.candidate_state === "selected" ? "ready" : candidate ? "needs_candidate" : "missing",
    candidate
      ? `candidate=${candidate.candidate_state ?? "unknown"} sha=${candidate.short_sha ?? "unknown"} dirty=${String(candidate.dirty)} proof=${candidate.proof ?? ".stack/evidence/nightly-candidate/latest.json"}`
      : ".stack/evidence/nightly-candidate/latest.json missing",
    candidate?.candidate_state === "selected"
      ? "Rerun clean install/use proof against this selected SHA."
      : "Land/split the launch slice onto a clean worktree, then run bun run launch:candidate -- --select --write-evidence.",
  ),
  gate(
    "nightly-packet",
    nightlyPacket && (nightlyPacket.summary?.missing ?? 1) === 0 ? "ready" : nightlyPacket ? "needs_candidate" : "missing",
    nightlyPacket ? `summary=${JSON.stringify(nightlyPacket.summary)}` : ".stack/evidence/nightly-1/latest.json missing",
    "Refresh with bun run launch:nightly1 -- --write-evidence after candidate selection.",
  ),
  gate(
    "launch-readiness",
    readiness && (readiness.summary?.fail ?? 1) === 0 ? "ready" : readiness ? "needs_candidate" : "missing",
    readiness ? `summary=${JSON.stringify(readiness.summary)}` : ".stack/evidence/launch-readiness/latest.json missing",
    "Refresh with bun run launch:readiness -- --write-evidence after candidate selection.",
  ),
  gate(
    "first-local-value",
    latestOkSummary("first-run-local") ? "ready" : "missing",
    latestOkSummary("first-run-local") ?? ".stack/evidence/first-run-local/*/summary.json missing",
    "Run make smoke-first-run-local on the selected candidate.",
  ),
  gate(
    "download-artifact-local",
    latestReleaseArtifactProof() && latestOkSummary("release-site-contract") ? "ready" : "missing",
    [latestReleaseArtifactProof(), latestOkSummary("release-site-contract")].filter(Boolean).join("; ") || "release artifact or release-site proof missing",
    "Publish immutable nightly artifacts and rerun clean install/use proof against the hosted manifest.",
  ),
  gate(
    "telemetry-privacy-local",
    latestOkSummary("telemetry-contract") && latestOkSummary("growth-ingestion") ? "ready" : "missing",
    [latestOkSummary("telemetry-contract"), latestOkSummary("growth-ingestion")].filter(Boolean).join("; ") || "telemetry/growth local proof missing",
    "Keep local product telemetry opt-in and rerun growth ingestion after event changes.",
  ),
  gate(
    "growth-live-proof",
    latestLiveGrowthProof() ? "ready" : "needs_live_proof",
    latestLiveGrowthProof() ?? "no successful live staging/prod growth POST proof recorded",
    "Run staging live POST proof first, then prod only after candidate SHA and public copy are approved.",
  ),
  gate(
    "docs-marketing-alignment",
    latestOkSummary("launch-docs-alignment") ? "ready" : "missing",
    latestOkSummary("launch-docs-alignment") ?? ".stack/evidence/launch-docs-alignment/*/summary.json missing",
    "Rerun make smoke-launch-docs-alignment before announcement copy changes.",
  ),
  gate(
    "bombadil-b0",
    latestBombadilProof() ? "ready" : "missing",
    latestBombadilProof() ?? ".stack/evidence/bombadil-b0/*/proof.json missing",
    "Rerun bun run smoke:bombadil:b0 only if TUI/Bombadil launch files change.",
  ),
]

const report = {
  generated_at: generatedAt,
  stack_version: stackVersion(stackRoot),
  stack_channel: stackChannel(stackRoot),
  launch_state: "not_launched",
  public_nightly_ready: gates.every((entry) => entry.state === "ready"),
  summary: summarize(gates),
  gates,
  cut_plan_counts: cutPlan
    ? {
      buckets: cutPlan.buckets ?? null,
      phases: cutPlan.candidate_phases
        ? Object.fromEntries(Object.entries(cutPlan.candidate_phases).map(([key, rows]) => [key, rows.length]))
        : null,
    }
    : null,
  next_actions: gates.filter((entry) => entry.state !== "ready").map((entry) => `${entry.id}: ${entry.next_action}`),
}

console.log(`Stack Nightly 1 essentials · ${report.stack_version} · ${report.stack_channel} · ready=${report.public_nightly_ready}`)
for (const entry of gates) {
  console.log(`${entry.id.padEnd(24)} ${entry.state.padEnd(16)} ${entry.evidence}`)
  if (entry.state !== "ready") console.log(`  next: ${entry.next_action}`)
}
console.log(`summary ${JSON.stringify(report.summary)}`)

if (writeEvidence) {
  const dir = join(stackRoot, ".stack", "evidence", "nightly-1-essentials", stamp)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`)
  const latestDir = join(stackRoot, ".stack", "evidence", "nightly-1-essentials")
  mkdirSync(latestDir, { recursive: true })
  writeFileSync(join(latestDir, "latest.json"), `${JSON.stringify({ ...report, proof: join(dir, "summary.json") }, null, 2)}\n`)
  console.log(`stack_nightly1_essentials_evidence ${join(dir, "summary.json")}`)
}

console.log("stack_nightly1_essentials_ok")

function cutPlanReady(): boolean {
  if (!cutPlan?.pathspec_dry_run) return false
  return Object.values(cutPlan.pathspec_dry_run).every((entry) => entry.ok === true)
}

function gate(id: string, state: GateState, evidence: string, next_action: string): Gate {
  return { id, state, evidence, next_action }
}

function summarize(entries: Gate[]): Record<GateState, number> {
  return entries.reduce(
    (summary, entry) => {
      summary[entry.state] += 1
      return summary
    },
    { ready: 0, needs_candidate: 0, needs_live_proof: 0, missing: 0 },
  )
}

function latestOkSummary(area: string): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", area)
  if (!existsSync(evidenceRoot)) return undefined
  const summaryPaths = Array.from(new Bun.Glob("*/summary.json").scanSync(evidenceRoot))
    .sort()
    .reverse()
    .map((path) => join(evidenceRoot, path))
  for (const summaryPath of summaryPaths) {
    try {
      const proof = JSON.parse(readFileSync(summaryPath, "utf8")) as { ok?: unknown }
      if (proof.ok === true) return summaryPath
    } catch {
      // Ignore malformed historical evidence files.
    }
  }
  return undefined
}

function latestReleaseArtifactProof(): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", "release-artifact")
  if (!existsSync(evidenceRoot)) return undefined
  const summaryPaths = Array.from(new Bun.Glob("*/summary.json").scanSync(evidenceRoot))
    .sort()
    .reverse()
    .map((path) => join(evidenceRoot, path))
  for (const summaryPath of summaryPaths) {
    try {
      const proof = JSON.parse(readFileSync(summaryPath, "utf8")) as { ok?: unknown; publishable?: unknown }
      if (proof.ok === true && proof.publishable === true) return summaryPath
    } catch {
      // Ignore malformed historical evidence files.
    }
  }
  return undefined
}

function latestLiveGrowthProof(): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", "growth-ingestion")
  if (!existsSync(evidenceRoot)) return undefined
  const summaryPaths = Array.from(new Bun.Glob("*/summary.json").scanSync(evidenceRoot))
    .sort()
    .reverse()
    .map((path) => join(evidenceRoot, path))
  for (const summaryPath of summaryPaths) {
    try {
      const proof = JSON.parse(readFileSync(summaryPath, "utf8")) as { ok?: unknown; live?: unknown; posted?: unknown }
      if (proof.ok === true && proof.live === true && proof.posted === true) return summaryPath
    } catch {
      // Ignore malformed historical evidence files.
    }
  }
  return undefined
}

function latestBombadilProof(): string | undefined {
  const evidenceRoot = join(stackRoot, ".stack", "evidence", "bombadil-b0")
  if (!existsSync(evidenceRoot)) return undefined
  const proofPaths = Array.from(new Bun.Glob("*/proof.json").scanSync(evidenceRoot))
    .sort()
    .reverse()
    .map((path) => join(evidenceRoot, path))
  for (const proofPath of proofPaths) {
    try {
      const proof = JSON.parse(readFileSync(proofPath, "utf8")) as { status?: unknown }
      if (proof.status === "pass") return proofPath
    } catch {
      // Ignore malformed historical evidence files.
    }
  }
  return undefined
}

function readJson<T>(relativePath: string): T | undefined {
  const path = join(stackRoot, relativePath)
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, "utf8")) as T
}
