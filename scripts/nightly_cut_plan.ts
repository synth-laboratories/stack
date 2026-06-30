#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type StatusEntry = {
  status: string
  path: string
  bucket: Bucket
  review_group?: ReviewGroup
}

type Bucket =
  | "candidate_include"
  | "candidate_review"
  | "generated_evidence"
  | "owner_review"

type ReviewGroup =
  | "rust_server_runtime"
  | "ts_client_mcp"
  | "tui_bombadil"
  | "proof_smokes"
  | "other_review"

type DryRunResult = {
  ok: boolean
  pathspec: string
  output_lines: number
  error?: string
}

const stackRoot = join(import.meta.dir, "..")
const stamp = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`
const proofDir = join(stackRoot, ".stack", "evidence", "nightly-cut-plan", stamp)

const includePaths = new Set([
  "CHANGELOG.md",
  "Makefile",
  "README.md",
  "docs/DISTRIBUTION.md",
  "docs/GROWTH_INGESTION.md",
  "docs/LAUNCH_READINESS.md",
  "docs/NIGHTLY_1.md",
  "docs/NIGHTLY_1_SECURITY_WAIVER.md",
  "docs/QUALITY.md",
  "docs/RELEASE.md",
  "docs/TELEMETRY.md",
  "docs/TELEMETRY_EVENTS.json",
  "package.json",
  "packaging/install.sh",
  "packaging/manifests/nightly.example.json",
  "scripts/launch_readiness.ts",
  "scripts/nightly1_essentials.ts",
  "scripts/nightly1_packet.ts",
  "scripts/nightly_candidate.ts",
  "scripts/nightly_cut_plan.ts",
  "scripts/package_release_artifact.ts",
  "scripts/smoke_artifact_security.ts",
  "scripts/smoke_first_run_local.ts",
  "scripts/smoke_growth_ingestion.ts",
  "scripts/smoke_installer_apply_rollback.ts",
  "scripts/smoke_installer_contract.ts",
  "scripts/smoke_launch_docs_alignment.ts",
  "scripts/smoke_release_site_contract.ts",
  "scripts/smoke_stackd_telemetry.ts",
  "scripts/smoke_telemetry_contract.ts",
  "src/demo.ts",
  "src/doctor.ts",
  "src/update.ts",
])

const includePrefixes = [
  "packaging/manifests/",
]

const reviewPaths = new Set([
  "Cargo.lock",
  "Cargo.toml",
])

const reviewPrefixes = [
  "crates/",
  "src/client/",
  "src/mcp/",
  "src/tui/",
  "scripts/smoke_bombadil",
  "scripts/smoke_meta_threads",
  "scripts/smoke_tui_",
  "scripts/prove_goal_first_e2e.ts",
  "scripts/tui_smoke_common.tcl",
]

const generatedPrefixes = [
  ".stack/evidence/",
  "target/",
  "node_modules/",
]

const rawStatus = execFileSync("git", ["status", "--porcelain"], {
  cwd: stackRoot,
  encoding: "utf8",
})

const entries = rawStatus
  .split("\n")
  .filter(Boolean)
  .map(parseStatus)
  .map((entry) => {
    const bucket = classify(entry.path)
    return { ...entry, bucket, ...(bucket === "candidate_review" ? { review_group: classifyReviewGroup(entry.path) } : {}) }
  })
  .sort((a, b) => a.path.localeCompare(b.path))

const byBucket = {
  candidate_include: entries.filter((entry) => entry.bucket === "candidate_include"),
  candidate_review: entries.filter((entry) => entry.bucket === "candidate_review"),
  generated_evidence: entries.filter((entry) => entry.bucket === "generated_evidence"),
  owner_review: entries.filter((entry) => entry.bucket === "owner_review"),
}

const byReviewGroup: Record<ReviewGroup, StatusEntry[]> = {
  rust_server_runtime: byBucket.candidate_review.filter((entry) => entry.review_group === "rust_server_runtime"),
  ts_client_mcp: byBucket.candidate_review.filter((entry) => entry.review_group === "ts_client_mcp"),
  tui_bombadil: byBucket.candidate_review.filter((entry) => entry.review_group === "tui_bombadil"),
  proof_smokes: byBucket.candidate_review.filter((entry) => entry.review_group === "proof_smokes"),
  other_review: byBucket.candidate_review.filter((entry) => entry.review_group === "other_review"),
}

const candidatePhases = {
  foundation: byBucket.candidate_include,
  server_contract: uniqEntries([
    ...byBucket.candidate_include,
    ...byReviewGroup.rust_server_runtime,
    ...byReviewGroup.ts_client_mcp,
    ...byReviewGroup.proof_smokes,
  ]),
  cockpit: uniqEntries([
    ...byBucket.candidate_include,
    ...byReviewGroup.rust_server_runtime,
    ...byReviewGroup.ts_client_mcp,
    ...byReviewGroup.proof_smokes,
    ...byReviewGroup.tui_bombadil,
  ]),
  full_review: uniqEntries([...byBucket.candidate_include, ...byBucket.candidate_review]),
}

const pathspecs = {
  candidate_include: join(proofDir, "candidate-include.pathspec"),
  candidate_review: join(proofDir, "candidate-review.pathspec"),
  generated_evidence: join(proofDir, "generated-evidence.pathspec"),
  owner_review: join(proofDir, "owner-review.pathspec"),
  latest_candidate_include: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-candidate-include.pathspec"),
  latest_candidate_review: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-candidate-review.pathspec"),
  latest_review_rust_server_runtime: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-review-rust-server-runtime.pathspec"),
  latest_review_ts_client_mcp: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-review-ts-client-mcp.pathspec"),
  latest_review_tui_bombadil: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-review-tui-bombadil.pathspec"),
  latest_review_proof_smokes: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-review-proof-smokes.pathspec"),
  latest_phase_foundation: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-phase-foundation.pathspec"),
  latest_phase_server_contract: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-phase-server-contract.pathspec"),
  latest_phase_cockpit: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-phase-cockpit.pathspec"),
  latest_phase_full_review: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-phase-full-review.pathspec"),
  latest_owner_review: join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-owner-review.pathspec"),
}

const summary = {
  generated_at: new Date().toISOString(),
  branch: execFileSync("git", ["branch", "--show-current"], { cwd: stackRoot, encoding: "utf8" }).trim(),
  head_sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: stackRoot, encoding: "utf8" }).trim(),
  dirty_count: entries.length,
  buckets: Object.fromEntries(Object.entries(byBucket).map(([bucket, rows]) => [bucket, rows.length])),
  candidate_include_paths: byBucket.candidate_include.map((entry) => entry.path),
  candidate_review_paths: byBucket.candidate_review.map((entry) => entry.path),
  candidate_review_groups: Object.fromEntries(
    Object.entries(byReviewGroup).map(([group, rows]) => [group, rows.map((entry) => entry.path)]),
  ),
  candidate_phases: Object.fromEntries(
    Object.entries(candidatePhases).map(([phase, rows]) => [phase, rows.map((entry) => entry.path)]),
  ),
  generated_evidence_paths: byBucket.generated_evidence.map((entry) => entry.path),
  owner_review_sample: byBucket.owner_review.slice(0, 80).map((entry) => entry.path),
  pathspecs,
  pathspec_dry_run: {} as Record<string, DryRunResult>,
  review_checklist: join(proofDir, "review-checklist.md"),
  next_actions: [
    "Commit or patch candidate_include paths as the Nightly 1 launch-candidate slice.",
    "Review candidate_review paths and include only runtime changes required by Nightly 1.",
    "Do not commit generated_evidence paths unless release engineering explicitly wants local proof artifacts in git.",
    "Leave owner_review paths out of the candidate unless the owner confirms they are part of Nightly 1.",
    "After the split, rerun bun run launch:readiness -- --write-evidence, bun run launch:nightly1 -- --write-evidence, and bun run launch:candidate -- --select --write-evidence.",
  ],
}

mkdirSync(proofDir, { recursive: true })
writePathspec("candidate-include.pathspec", byBucket.candidate_include)
writePathspec("candidate-review.pathspec", byBucket.candidate_review)
writePathspec("review-rust-server-runtime.pathspec", byReviewGroup.rust_server_runtime)
writePathspec("review-ts-client-mcp.pathspec", byReviewGroup.ts_client_mcp)
writePathspec("review-tui-bombadil.pathspec", byReviewGroup.tui_bombadil)
writePathspec("review-proof-smokes.pathspec", byReviewGroup.proof_smokes)
writePathspec("phase-foundation.pathspec", candidatePhases.foundation)
writePathspec("phase-server-contract.pathspec", candidatePhases.server_contract)
writePathspec("phase-cockpit.pathspec", candidatePhases.cockpit)
writePathspec("phase-full-review.pathspec", candidatePhases.full_review)
writePathspec("generated-evidence.pathspec", byBucket.generated_evidence)
writePathspec("owner-review.pathspec", byBucket.owner_review)
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-candidate-include.pathspec"), renderPathspec(byBucket.candidate_include))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-candidate-review.pathspec"), renderPathspec(byBucket.candidate_review))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-review-rust-server-runtime.pathspec"), renderPathspec(byReviewGroup.rust_server_runtime))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-review-ts-client-mcp.pathspec"), renderPathspec(byReviewGroup.ts_client_mcp))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-review-tui-bombadil.pathspec"), renderPathspec(byReviewGroup.tui_bombadil))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-review-proof-smokes.pathspec"), renderPathspec(byReviewGroup.proof_smokes))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-phase-foundation.pathspec"), renderPathspec(candidatePhases.foundation))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-phase-server-contract.pathspec"), renderPathspec(candidatePhases.server_contract))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-phase-cockpit.pathspec"), renderPathspec(candidatePhases.cockpit))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-phase-full-review.pathspec"), renderPathspec(candidatePhases.full_review))
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest-owner-review.pathspec"), renderPathspec(byBucket.owner_review))
summary.pathspec_dry_run = validatePathspecDryRuns(pathspecs)
writeFileSync(join(proofDir, "review-checklist.md"), renderReviewChecklist())
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
writeFileSync(join(stackRoot, ".stack", "evidence", "nightly-cut-plan", "latest.json"), `${JSON.stringify({ ...summary, proof: join(proofDir, "summary.json") }, null, 2)}\n`)

console.log("stack_nightly_cut_plan_ok")
console.log(JSON.stringify(summary, null, 2))

function parseStatus(line: string): Omit<StatusEntry, "bucket"> {
  const status = line.slice(0, 2)
  const path = line.slice(3).replace(/^.* -> /, "")
  return { status, path }
}

function classify(path: string): Bucket {
  if (generatedPrefixes.some((prefix) => path.startsWith(prefix))) return "generated_evidence"
  if (includePaths.has(path)) return "candidate_include"
  if (includePrefixes.some((prefix) => path.startsWith(prefix))) return "candidate_include"
  if (reviewPaths.has(path)) return "candidate_review"
  if (reviewPrefixes.some((prefix) => path.startsWith(prefix))) return "candidate_review"
  return "owner_review"
}

function classifyReviewGroup(path: string): ReviewGroup {
  if (path.startsWith("crates/") || path === "Cargo.toml" || path === "Cargo.lock") return "rust_server_runtime"
  if (path.startsWith("src/client/") || path.startsWith("src/mcp/")) return "ts_client_mcp"
  if (path.startsWith("src/tui/") || path.startsWith("scripts/smoke_tui_") || path.startsWith("scripts/tui_smoke_common") || path.startsWith("scripts/smoke_bombadil")) return "tui_bombadil"
  if (path.startsWith("scripts/prove_goal_first_e2e") || path.startsWith("scripts/smoke_meta_threads")) return "proof_smokes"
  return "other_review"
}

function writePathspec(name: string, rows: StatusEntry[]): void {
  writeFileSync(join(proofDir, name), renderPathspec(rows))
}

function renderPathspec(rows: StatusEntry[]): string {
  return `${rows.map((entry) => entry.path).join("\n")}\n`
}

function uniqEntries(rows: StatusEntry[]): StatusEntry[] {
  const seen = new Set<string>()
  const out: StatusEntry[] = []
  for (const row of rows) {
    if (seen.has(row.path)) continue
    seen.add(row.path)
    out.push(row)
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

function validatePathspecDryRuns(paths: Record<string, string>): Record<string, DryRunResult> {
  const results: Record<string, DryRunResult> = {}
  for (const [name, pathspec] of Object.entries(paths)) {
    if (readFileSync(pathspec, "utf8").trim().length === 0) {
      results[name] = {
        ok: true,
        pathspec,
        output_lines: 0,
      }
      continue
    }
    try {
      const output = execFileSync("git", ["add", "--dry-run", "--pathspec-from-file", pathspec], {
        cwd: stackRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      results[name] = {
        ok: true,
        pathspec,
        output_lines: output.split("\n").filter(Boolean).length,
      }
    } catch (error) {
      results[name] = {
        ok: false,
        pathspec,
        output_lines: 0,
        error: error instanceof Error ? error.message.split("\n")[0] : String(error),
      }
    }
  }
  return results
}

function renderReviewChecklist(): string {
  return [
    "# Stack Nightly 1 Candidate Cut Plan",
    "",
    `Generated: ${summary.generated_at}`,
    `Branch: ${summary.branch}`,
    `HEAD: ${summary.head_sha}`,
    "",
    "## Buckets",
    "",
    `- candidate_include: ${byBucket.candidate_include.length}`,
    `- candidate_review: ${byBucket.candidate_review.length}`,
    `- generated_evidence: ${byBucket.generated_evidence.length}`,
    `- owner_review: ${byBucket.owner_review.length}`,
    "",
    "## Candidate Phases",
    "",
    `- foundation: ${candidatePhases.foundation.length} files - launch docs, distribution, telemetry contract, and local first-value tooling`,
    `- server_contract: ${candidatePhases.server_contract.length} files - foundation plus Rust/server runtime, TS/MCP boundary, and meta-thread proof smokes`,
    `- cockpit: ${candidatePhases.cockpit.length} files - server_contract plus TUI/Bombadil confidence files`,
    `- full_review: ${candidatePhases.full_review.length} files - foundation plus every candidate_review file`,
    "",
    "## Candidate Include",
    "",
    ...renderChecklistRows(byBucket.candidate_include, "Include in first launch-candidate slice."),
    "",
    "## Candidate Review",
    "",
    "### Rust/server runtime",
    "",
    ...renderChecklistRows(byReviewGroup.rust_server_runtime, "Review as Rust/server launch runtime; include if needed for stackd, meta-threads, telemetry, skills, runtime, or candidate build correctness."),
    "",
    "### TS client/MCP boundary",
    "",
    ...renderChecklistRows(byReviewGroup.ts_client_mcp, "Review as TypeScript client or MCP launch boundary; include if needed for Rust <> TS server/client contract."),
    "",
    "### TUI/Bombadil",
    "",
    ...renderChecklistRows(byReviewGroup.tui_bombadil, "Review as TUI or Bombadil launch proof; include if needed for Nightly 1 cockpit confidence."),
    "",
    "### Proof smokes",
    "",
    ...renderChecklistRows(byReviewGroup.proof_smokes, "Review as acceptance proof support; include if needed for candidate evidence."),
    "",
    "### Other review",
    "",
    ...renderChecklistRows(byReviewGroup.other_review, "Include only if required by Nightly 1 runtime behavior."),
    "",
    "## Candidate Review - Flat List",
    "",
    ...renderChecklistRows(byBucket.candidate_review, "Include only if required by Nightly 1 runtime behavior."),
    "",
    "## Owner Review",
    "",
    ...renderChecklistRows(byBucket.owner_review, "Keep out unless owner confirms Nightly 1 scope."),
    "",
    "## Generated Evidence",
    "",
    ...renderChecklistRows(byBucket.generated_evidence, "Do not commit unless release engineering explicitly wants local proof artifacts in git."),
    "",
    "## Commands",
    "",
    "All generated pathspecs are validated with `git add --dry-run --pathspec-from-file`.",
    "",
    "```bash",
    "git add --pathspec-from-file .stack/evidence/nightly-cut-plan/latest-candidate-include.pathspec",
    "git add --pathspec-from-file .stack/evidence/nightly-cut-plan/latest-phase-server-contract.pathspec",
    "git add --pathspec-from-file .stack/evidence/nightly-cut-plan/latest-phase-cockpit.pathspec",
    "bun run launch:readiness -- --write-evidence",
    "bun run launch:nightly1 -- --write-evidence",
    "bun run launch:candidate -- --select --write-evidence",
    "```",
    "",
  ].join("\n")
}

function renderChecklistRows(rows: StatusEntry[], note: string): string[] {
  if (rows.length === 0) return [`- [ ] none - ${note}`]
  return rows.map((entry) => `- [ ] \`${entry.path}\` (${entry.status.trim() || "dirty"}) - ${note}`)
}
