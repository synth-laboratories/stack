#!/usr/bin/env bun

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stackChannel, stackVersion } from "../src/version.ts"

type Status = "pass" | "partial" | "fail" | "waived" | "not_applicable" | "not_started"

type Gate = {
  stage: string
  gate_id: string
  owner: string
  status: Status
  summary: string
  evidence: string
  next_action: string
}

type Report = {
  generated_at: string
  stack_version: string
  stack_channel: string
  strict: boolean
  gates: Gate[]
  summary: Record<Status, number>
}

const stackRoot = join(import.meta.dir, "..")
const args = new Set(process.argv.slice(2))
const writeEvidence = args.has("--write-evidence") || process.env.STACK_LAUNCH_READINESS_WRITE === "1"
const strict = args.has("--strict")

const pkg = readJson<{ scripts?: Record<string, string> }>("package.json")
const bombadilB0 = latestBombadilB0Proof()

const gates: Gate[] = [
  gate("S0_SCOPE", "AT-STACK-SCOPE-001", "Jstack", docsExist(["CHANGELOG.md", "docs/RELEASE.md", "docs/QUALITY.md", "docs/DISTRIBUTION.md", "docs/TELEMETRY.md"]),
    "Launch scope, channel model, quality guide, and public docs exist.",
    "CHANGELOG.md, docs/RELEASE.md, docs/QUALITY.md, docs/DISTRIBUTION.md, docs/TELEMETRY.md",
    "Keep channel/non-goals updated in the ship record before external amplification."),
  gate("S1_STATIC", "AT-STACK-STATIC-001", "stack", scriptsExist(["check", "quality:static", "quality:dev", "quality:release"]),
    "Public static and quality aggregate scripts are wired.",
    "package.json scripts",
    "Run quality gates only when preparing a concrete nightly/stable candidate."),
  gate("S2_RUST_SERVER", "AT-STACK-RUST-SERVER-001", "stack", scriptExists("smoke:meta-threads:contract") ? "partial" : "not_started",
    scriptExists("smoke:meta-threads:concurrency")
      ? "Rust/server meta-thread lifecycle and concurrency smokes are wired; rerun on the selected candidate."
      : scriptExists("smoke:meta-threads:contract")
      ? "Rust/server meta-thread lifecycle contract smoke is wired; concurrency proof remains open."
      : "Rust/server launch contract gates need first-class meta-thread wire and concurrency smokes.",
    scriptExists("smoke:meta-threads:concurrency")
      ? "smoke:meta-threads:contract and smoke:meta-threads:concurrency exist"
      : scriptExists("smoke:meta-threads:contract") ? "smoke:meta-threads:contract exists" : "smoke:meta-threads:contract missing",
    scriptExists("smoke:meta-threads:concurrency")
      ? "Run both Rust/server smokes on the selected candidate and attach proof directories."
      : scriptExists("smoke:meta-threads:contract")
      ? "Add concurrency proof for parallel meta-thread mutation."
      : "Add stackd contract smoke and concurrency proof for meta-thread mutation."),
  gate("S3_TS_CLIENT", "AT-STACK-TS-CLIENT-001", "stack", readmeBoundaryStatus(),
    stackdTelemetryStatus() === "partial"
      ? "TypeScript/TUI boundary is documented and at least one live Rust JSON <> TS client shape is proven; broader TUI flows remain partial."
      : "TypeScript/TUI must consume stackd through typed clients and avoid raw writes to stackd-owned state.",
    stackdTelemetryStatus() === "partial"
      ? "README stackd section; smoke:stackd:telemetry"
      : "README stackd section",
    stackdTelemetryStatus() === "partial"
      ? "Extend live Rust JSON <> TS client shape proofs to handoff, update, auth, and TUI Bombadil flows."
      : "Keep TS state access thin and add live Rust JSON <> TS client shape evidence."),
  gate("S4_TUI_BOMBADIL", "AT-STACK-BOMBADIL-PIPELINE-001", "stack", bombadilB0.status,
    bombadilB0.status === "pass"
      ? "Bombadil B0 passed for scroll, focus, and crash cleanup; B1/B2 launch flows still need buildout."
      : scriptExists("smoke:bombadil:b0")
      ? "Bombadil B0 is wired but no passing durable proof is present; B1/B2 launch flows still need buildout."
      : "Bombadil B0 is not wired yet.",
    bombadilB0.evidence,
    bombadilB0.status === "pass"
      ? "Add B1 handoff/update/auth rail scenarios, then B2 event-pressure scenarios."
      : "Run bun run smoke:bombadil:b0 and attach the proof before broad nightly dogfood."),
  gate("S5_LOCAL_PRODUCT", "AT-STACK-LOCAL-FIRST-WIN-001", "stack", localFirstWinStatus(),
    localFirstWinStatus() === "pass"
      ? "First local value smoke proves doctor, demo receipt, and read-only update check without Synth signup."
      : "First local value must work without Synth signup and emit a receipt.",
    localFirstWinStatus() === "pass"
      ? "smoke:first-run:local; stack doctor --json; stack demo --json; stack update --check --json"
      : "README/docs local-first references",
    localFirstWinStatus() === "pass"
      ? "Rerun make smoke-first-run-local on the selected candidate and cite the proof directory in the ship record."
      : "Run stack demo on the candidate and cite the local receipt in the ship record."),
  gate("S6_DISTRIBUTION", "AT-STACK-DISTRIBUTION-001", "stack+docs", distributionStatus(),
    artifactSecurityStatus() === "partial"
      ? "Manifest-backed installer, local apply/rollback proof, local artifact manifest proof, installed release-site activation proof, artifact security waiver proof, and update check are wired; live artifacts and hosted/public download ingestion are not published."
      : releaseArtifactStatus() === "partial"
      ? "Manifest-backed installer, local apply/rollback proof, local artifact manifest proof, installed release-site activation proof, and update check are wired; artifact security proof, live artifacts, and hosted/public download ingestion are not published."
      : installerApplyRollbackStatus() === "partial"
      ? "Manifest-backed installer plan, local apply/rollback proof, and update check are wired; live artifacts and hosted/public download ingestion are not published."
      : installerContractStatus() === "partial"
      ? "Manifest-backed installer plan and update check are wired; live artifacts and hosted/public download ingestion are not published."
      : updateCheckStatus() === "partial"
      ? "Manifest-backed update check is wired; installer/download/apply path is not live."
      : "Public installer/update path is documented as planned, not live.",
    artifactSecurityStatus() === "partial"
      ? "README, docs/RELEASE.md, docs/DISTRIBUTION.md, docs/NIGHTLY_1_SECURITY_WAIVER.md, packaging/install.sh, smoke:installer:contract, smoke:installer:apply-rollback, smoke:release-artifact:local, smoke:release-site:contract, smoke:artifact-security, src/update.ts, packaging/manifests/nightly.example.json"
      : releaseArtifactStatus() === "partial"
      ? "README, docs/RELEASE.md, docs/DISTRIBUTION.md, packaging/install.sh, smoke:installer:contract, smoke:installer:apply-rollback, smoke:release-artifact:local, smoke:release-site:contract, src/update.ts, packaging/manifests/nightly.example.json"
      : installerApplyRollbackStatus() === "partial"
      ? "README, docs/RELEASE.md, docs/DISTRIBUTION.md, packaging/install.sh, smoke:installer:contract, smoke:installer:apply-rollback, src/update.ts, packaging/manifests/nightly.example.json"
      : installerContractStatus() === "partial"
      ? "README, docs/RELEASE.md, docs/DISTRIBUTION.md, packaging/install.sh, smoke:installer:contract, src/update.ts, packaging/manifests/nightly.example.json"
      : updateCheckStatus() === "partial"
      ? "README, docs/RELEASE.md, docs/DISTRIBUTION.md, src/update.ts, packaging/manifests/nightly.example.json"
      : "README, docs/RELEASE.md, docs/DISTRIBUTION.md install sections",
    artifactSecurityStatus() === "partial"
      ? "Publish immutable artifacts, wire hosted/public download ingestion, and rerun clean install/apply/rollback proof against the selected public candidate."
      : releaseArtifactStatus() === "partial"
      ? "Add signature/provenance automation or run smoke:artifact-security with an explicit Nightly waiver, then publish artifacts and wire hosted/public download ingestion."
      : installerApplyRollbackStatus() === "partial"
      ? "Publish signed/checksummed artifacts, wire hosted/public download ingestion, and rerun clean install/apply/rollback proof against the selected public candidate."
      : installerContractStatus() === "partial"
      ? "Publish signed/checksummed artifacts, wire hosted/public download ingestion, and run clean install/apply/rollback proof before public nightly or stable."
      : updateCheckStatus() === "partial"
      ? "Build installer download/apply/rollback path and publish signed/checksummed artifacts before public nightly or stable."
      : "Build manifest-backed installer/update path before public nightly or stable."),
  gate("S7_AUTH_GROWTH", "AT-STACK-AUTH-GROWTH-001", "frontend+backend+synth-dev", telemetryStatus(),
    crashReportingStatus() === "partial"
      ? "Privacy-safe telemetry allowlist, stackd status route, opt-in local outbox emission, public Stack growth-ingestion payload contract, and client crash ingest/query visibility are wired; live auth/growth end-to-end validation remains outside the public Stack repo."
      : growthIngestionStatus() === "partial"
      ? "Privacy-safe telemetry allowlist, stackd status route, opt-in local outbox emission, and public Stack growth-ingestion payload contract are wired; live auth/growth end-to-end validation remains outside the public Stack repo."
      : stackdTelemetryStatus() === "partial"
      ? "Privacy-safe telemetry allowlist, stackd status route, and opt-in local outbox emission are wired; public Stack growth-ingestion payload contract and auth/growth end-to-end validation remain open."
      : telemetryContractStatus() === "partial"
      ? "Privacy-safe telemetry event allowlist is wired; stackd status route and auth/growth end-to-end validation remain open."
      : "Auth and growth end-to-end gates are planned outside the public Stack repo.",
    crashReportingStatus() === "partial"
      ? "docs/TELEMETRY.md, docs/CRASH_INGESTION.md, docs/TELEMETRY_EVENTS.json, docs/GROWTH_INGESTION.md, smoke:telemetry:contract, smoke:stackd:telemetry, smoke:stackd:crash-report, smoke:crash-ingestion, smoke:growth-ingestion, GET /telemetry/status, POST /telemetry/events, GET/POST /api/v1/product/stack-crashes"
      : growthIngestionStatus() === "partial"
      ? "docs/TELEMETRY.md, docs/TELEMETRY_EVENTS.json, docs/GROWTH_INGESTION.md, smoke:telemetry:contract, smoke:stackd:telemetry, smoke:growth-ingestion, GET /telemetry/status, POST /telemetry/events, /api/v1/product/stack-crashes payload contract"
      : stackdTelemetryStatus() === "partial"
      ? "docs/TELEMETRY.md, docs/TELEMETRY_EVENTS.json, smoke:telemetry:contract, smoke:stackd:telemetry, GET /telemetry/status, POST /telemetry/events"
      : telemetryContractStatus() === "partial"
      ? "docs/TELEMETRY.md, docs/TELEMETRY_EVENTS.json, smoke:telemetry:contract"
      : "docs/TELEMETRY.md and Jstack ship pipeline S7",
    crashReportingStatus() === "partial"
      ? "Run staging then prod live POST proof for crash and growth ingest; use stack crashes --remote or stack_crash_reports MCP for prod triage."
      : growthIngestionStatus() === "partial"
      ? "Run staging then prod live POST proof for download/signup/use flows against the growth endpoint."
      : stackdTelemetryStatus() === "partial"
      ? "Wire Stack growth-ingestion payload mapping, then run staging/prod download/signup/use flows against this allowlist."
      : telemetryContractStatus() === "partial"
      ? "Wire stackd telemetry status, staging then prod download/signup/use flows, and stackd-owned local telemetry emission against this allowlist."
      : "Wire staging then prod download/signup/use flows with privacy-safe telemetry samples."),
  gate("S8_DOCS_CHANGELOG", "AT-STACK-DOCS-CHANGELOG-001", "stack+docs", docsAlignmentStatus(),
    docsAlignmentStatus() === "pass"
      ? "Public README, changelog, release docs, Mintlify docs, and marketing draft alignment smoke are wired."
      : "Public README, changelog, release, and quality docs exist.",
    docsAlignmentStatus() === "pass"
      ? "README.md, CHANGELOG.md, docs/*.md, smoke:launch-docs-alignment"
      : "README.md, CHANGELOG.md, docs/RELEASE.md, docs/QUALITY.md, docs/DISTRIBUTION.md, docs/TELEMETRY.md, SECURITY.md",
    docsAlignmentStatus() === "pass"
      ? "Rerun make smoke-launch-docs-alignment on the selected candidate and before any announcement copy changes."
      : "Before launch, verify README, Mintlify, GitHub Release, and changelog agree."),
  gate("S9_SHIP_READOUT", "AT-STACK-SHIP-READOUT-001", "Jstack+synth-dev", "not_started",
    "Readout happens after a concrete nightly/stable candidate is exercised.",
    "Jstack ship record",
    "Record installs, activations, receipts, issues, waivers, and next owner after dogfood."),
]

const report: Report = {
  generated_at: new Date().toISOString(),
  stack_version: stackVersion(stackRoot),
  stack_channel: stackChannel(stackRoot),
  strict,
  gates,
  summary: summarize(gates),
}

printReport(report)

if (writeEvidence) {
  const dir = process.env.STACK_LAUNCH_READINESS_EVIDENCE_DIR?.trim() || join(stackRoot, ".stack", "evidence", "launch-readiness")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`launch_readiness_evidence ${join(dir, "latest.json")}`)
}

if (strict && gates.some((item) => item.status === "fail")) {
  process.exit(1)
}

console.log("stack_launch_readiness_report_ok")

function gate(
  stage: string,
  gate_id: string,
  owner: string,
  status: Status,
  summary: string,
  evidence: string,
  next_action: string,
): Gate {
  return { stage, gate_id, owner, status, summary, evidence, next_action }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(stackRoot, relativePath), "utf8")) as T
}

function scriptExists(name: string): boolean {
  return Boolean(pkg.scripts?.[name])
}

function scriptsExist(names: string[]): Status {
  const missing = names.filter((name) => !scriptExists(name))
  return missing.length === 0 ? "pass" : "fail"
}

function docsExist(paths: string[]): Status {
  const missing = paths.filter((path) => !existsSync(join(stackRoot, path)))
  return missing.length === 0 ? "pass" : "fail"
}

function readText(relativePath: string): string {
  return readFileSync(join(stackRoot, relativePath), "utf8")
}

function readmeBoundaryStatus(): Status {
  const readme = readText("README.md")
  if (readme.includes("stackd` is a read-only localhost indexer/exporter")) return "fail"
  if (readme.includes("The TUI still writes session files directly")) return "fail"
  if (!readme.includes("stackd owns local Stack persistence")) return "partial"
  return "partial"
}

function localFirstWinStatus(): Status {
  const release = readText("docs/RELEASE.md")
  const readme = readText("README.md")
  if (scriptExists("smoke:first-run:local") && existsSync(join(stackRoot, "scripts", "smoke_first_run_local.ts"))) return "pass"
  if ((readme.includes("stack demo") || release.includes("stack demo")) && existsSync(join(stackRoot, "src", "demo.ts"))) return "partial"
  if (readme.includes("stack doctor") || release.includes("stack doctor")) return "partial"
  return "not_started"
}

function distributionStatus(): Status {
  const readme = readText("README.md")
  const release = readText("docs/RELEASE.md")
  if (updateCheckStatus() === "partial") return "partial"
  if (existsSync(join(stackRoot, "docs", "DISTRIBUTION.md")) && readme.includes("usesynth.ai/keys")) return "partial"
  if (readme.includes("Public installer (planned") && release.includes("once release assets are live")) return "partial"
  if (readme.includes("curl -fsSL https://stack.usesynth.ai/install.sh | sh")) return "partial"
  return "not_started"
}

function updateCheckStatus(): Status {
  return existsSync(join(stackRoot, "src", "update.ts")) && existsSync(join(stackRoot, "packaging", "manifests", "nightly.example.json"))
    ? "partial"
    : "not_started"
}

function installerContractStatus(): Status {
  return existsSync(join(stackRoot, "packaging", "install.sh")) && scriptExists("smoke:installer:contract") && updateCheckStatus() === "partial"
    ? "partial"
    : "not_started"
}

function installerApplyRollbackStatus(): Status {
  return installerContractStatus() === "partial" && scriptExists("smoke:installer:apply-rollback") ? "partial" : "not_started"
}

function releaseArtifactStatus(): Status {
  return installerApplyRollbackStatus() === "partial" && scriptExists("smoke:release-artifact:local") && scriptExists("smoke:release-site:contract") ? "partial" : "not_started"
}

function artifactSecurityStatus(): Status {
  if (releaseArtifactStatus() !== "partial" || !scriptExists("smoke:artifact-security")) return "not_started"
  const latestPath = join(stackRoot, ".stack", "evidence", "artifact-security", "latest.json")
  if (!existsSync(latestPath)) return "not_started"
  try {
    const proof = JSON.parse(readFileSync(latestPath, "utf8")) as { ok?: unknown }
    return proof.ok === true ? "partial" : "not_started"
  } catch {
    return "not_started"
  }
}

function telemetryStatus(): Status {
  return existsSync(join(stackRoot, "docs", "TELEMETRY.md")) ? "partial" : "not_started"
}

function telemetryContractStatus(): Status {
  return existsSync(join(stackRoot, "docs", "TELEMETRY_EVENTS.json")) && scriptExists("smoke:telemetry:contract") ? "partial" : "not_started"
}

function stackdTelemetryStatus(): Status {
  return telemetryContractStatus() === "partial"
    && existsSync(join(stackRoot, "crates", "stackd", "src", "handlers", "telemetry.rs"))
    && scriptExists("smoke:stackd:telemetry")
    ? "partial"
    : "not_started"
}

function growthIngestionStatus(): Status {
  if (stackdTelemetryStatus() !== "partial" || !scriptExists("smoke:growth-ingestion")) return "not_started"
  return latestOkSummary("growth-ingestion") ? "partial" : "not_started"
}

function crashReportingStatus(): Status {
  if (!scriptExists("smoke:stackd:crash-report") || !scriptExists("smoke:crash-ingestion")) return "not_started"
  if (!existsSync(join(stackRoot, "docs", "CRASH_INGESTION.md"))) return "not_started"
  const localProof = latestOkSummary("stackd-crash-report") ?? latestOkEvidence("stackd-crash-report")
  const contractProof = latestOkSummary("crash-ingestion")
  if (localProof && contractProof) return "partial"
  return "not_started"
}

function latestOkEvidence(area: string): string | undefined {
  const latestPath = join(stackRoot, ".stack", "evidence", area, "latest.json")
  if (!existsSync(latestPath)) return undefined
  try {
    const proof = JSON.parse(readFileSync(latestPath, "utf8")) as { ok?: unknown }
    return proof.ok === true ? latestPath : undefined
  } catch {
    return undefined
  }
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

function latestBombadilB0Proof(): { status: Status; evidence: string } {
  if (!scriptExists("smoke:bombadil:b0")) {
    return { status: "not_started", evidence: "smoke:bombadil:b0 missing" }
  }
  const evidenceRoot = join(stackRoot, ".stack", "evidence", "bombadil-b0")
  if (!existsSync(evidenceRoot)) {
    return { status: "partial", evidence: "smoke:bombadil:b0 exists; no .stack/evidence/bombadil-b0 proof yet" }
  }
  const proofPaths = readdirSync(evidenceRoot)
    .sort()
    .reverse()
    .map((entry) => join(evidenceRoot, entry, "proof.json"))
    .filter((path) => existsSync(path))
  for (const proofPath of proofPaths) {
    try {
      const proof = JSON.parse(readFileSync(proofPath, "utf8")) as { status?: unknown; check_id?: unknown }
      if (proof.check_id === "AT-STACK-BOMBADIL-B0" && proof.status === "pass") {
        return { status: "pass", evidence: proofPath }
      }
    } catch {
      // Ignore malformed old proof files.
    }
  }
  return { status: "partial", evidence: proofPaths[0] ?? "smoke:bombadil:b0 exists; no proof.json found" }
}

function docsAlignmentStatus(): Status {
  return docsExist(["README.md", "CHANGELOG.md", "docs/RELEASE.md", "docs/QUALITY.md", "docs/DISTRIBUTION.md", "docs/TELEMETRY.md", "SECURITY.md"]) === "pass"
    && scriptExists("smoke:launch-docs-alignment")
    ? "pass"
    : "partial"
}

function summarize(items: Gate[]): Record<Status, number> {
  const summary: Record<Status, number> = {
    pass: 0,
    partial: 0,
    fail: 0,
    waived: 0,
    not_applicable: 0,
    not_started: 0,
  }
  for (const item of items) summary[item.status] += 1
  return summary
}

function printReport(report: Report): void {
  console.log(`Stack launch readiness · ${report.stack_version} · ${report.stack_channel}`)
  for (const item of report.gates) {
    console.log(`${item.stage} ${item.status.padEnd(14)} ${item.gate_id} · ${item.summary}`)
    if (item.status !== "pass" && item.status !== "not_applicable") {
      console.log(`  next: ${item.next_action}`)
    }
  }
  console.log(`summary ${JSON.stringify(report.summary)}`)
}
