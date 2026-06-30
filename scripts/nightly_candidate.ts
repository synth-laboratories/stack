#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stackChannel, stackVersion } from "../src/version.ts"

type PacketSummary = {
  ready?: number
  partial?: number
  missing?: number
}

type ReadinessSummary = {
  pass?: number
  partial?: number
  fail?: number
  waived?: number
  not_applicable?: number
  not_started?: number
}

type CandidateState = "selected" | "not_ready" | "not_selected"

const stackRoot = join(import.meta.dir, "..")
const args = new Set(process.argv.slice(2))
const writeEvidence = args.has("--write-evidence")
const select = args.has("--select")
const allowDirty = args.has("--allow-dirty")
const dirtyEntries = gitLines(["status", "--porcelain=v1"])
const dirtyCount = dirtyEntries.length
const headSha = gitText(["rev-parse", "HEAD"])
const shortSha = gitText(["rev-parse", "--short", "HEAD"])
const branch = gitText(["rev-parse", "--abbrev-ref", "HEAD"])
const generatedAt = new Date().toISOString()
const stamp = generatedAt.replace(/[-:.]/g, "").slice(0, 15) + "Z"
const advertisedChannel = stackChannel(stackRoot) === "dev" ? "nightly" : stackChannel(stackRoot)
const nightlyPacket = readJson<{ summary?: PacketSummary }>(".stack/evidence/nightly-1/latest.json")
const launchReadiness = readJson<{ summary?: ReadinessSummary }>(".stack/evidence/launch-readiness/latest.json")
const proofIssues = candidateIssues()
const candidateState: CandidateState = select && proofIssues.length === 0 ? "selected" : proofIssues.length > 0 ? "not_ready" : "not_selected"

const report = {
  generated_at: generatedAt,
  candidate_state: candidateState,
  selected: candidateState === "selected",
  version: stackVersion(stackRoot),
  source_channel: stackChannel(stackRoot),
  advertised_channel: advertisedChannel,
  branch,
  head_sha: headSha,
  short_sha: shortSha,
  dirty: dirtyCount > 0,
  dirty_count: dirtyCount,
  dirty_sample: dirtyEntries.slice(0, 40),
  allow_dirty: allowDirty,
  launch_readiness_summary: launchReadiness?.summary ?? null,
  nightly_packet_summary: nightlyPacket?.summary ?? null,
  required_next_action: nextAction(),
  issues: proofIssues,
}

if (writeEvidence) {
  const dir = join(stackRoot, ".stack", "evidence", "nightly-candidate", stamp)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`)
  const latestDir = join(stackRoot, ".stack", "evidence", "nightly-candidate")
  mkdirSync(latestDir, { recursive: true })
  writeFileSync(join(latestDir, "latest.json"), `${JSON.stringify({ ...report, proof: join(dir, "summary.json") }, null, 2)}\n`)
}

console.log(`stack_nightly_candidate_${candidateState}`)
console.log(JSON.stringify(report, null, 2))

if (select && proofIssues.length > 0) {
  process.exit(1)
}

function candidateIssues(): string[] {
  const issues: string[] = []
  if (dirtyCount > 0 && !allowDirty) {
    issues.push("worktree has uncommitted or untracked changes; freeze a clean commit or rerun with --allow-dirty for an internal-only waiver")
  }
  if (!headSha) issues.push("git HEAD is unavailable")
  if (!nightlyPacket?.summary) {
    issues.push("missing .stack/evidence/nightly-1/latest.json; run bun run launch:nightly1 -- --write-evidence")
  } else if ((nightlyPacket.summary.missing ?? 0) > 0) {
    issues.push(`nightly packet still has missing=${nightlyPacket.summary.missing}`)
  }
  if (!launchReadiness?.summary) {
    issues.push("missing .stack/evidence/launch-readiness/latest.json; run bun run launch:readiness -- --write-evidence")
  } else if ((launchReadiness.summary.fail ?? 0) > 0) {
    issues.push(`launch readiness still has fail=${launchReadiness.summary.fail}`)
  }
  return issues
}

function nextAction(): string {
  if (candidateState === "selected") return "Publish immutable nightly artifacts and rerun clean install/use proof against this SHA."
  if (proofIssues.length === 0) return "Rerun with --select to freeze this clean SHA as the Nightly 1 candidate."
  return "Resolve candidate issues, refresh launch readiness and nightly packet evidence, then rerun launch:candidate."
}

function readJson<T>(relativePath: string): T | undefined {
  const path = join(stackRoot, relativePath)
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function gitText(args: string[]): string {
  const result = spawnSync("git", args, { cwd: stackRoot, encoding: "utf8" })
  if (result.status !== 0) return ""
  return result.stdout.trim()
}

function gitLines(args: string[]): string[] {
  return gitText(args).split("\n").map((line) => line.trim()).filter(Boolean)
}
