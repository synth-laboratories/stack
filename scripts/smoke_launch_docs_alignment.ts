#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type Surface = {
  id: string
  path: string
  required: string[]
  forbidden?: string[]
  optional?: boolean
}

type SurfaceResult = {
  id: string
  path: string
  status: "pass" | "missing" | "fail"
  missing_required: string[]
  found_forbidden: string[]
}

const stackRoot = resolve(import.meta.dir, "..")
const workspaceRoot = resolve(stackRoot, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const evidenceDir = resolve(stackRoot, ".stack", "evidence", "launch-docs-alignment", stamp)

const surfaces: Surface[] = [
  {
    id: "repo-readme",
    path: join(stackRoot, "README.md"),
    required: [
      "no public release yet",
      "Private repo access required today",
      "Public installer (planned",
      "first-party installer",
      "stack demo",
      "make smoke-release-site-contract",
      "make smoke-stackd-telemetry",
    ],
    forbidden: ["stack is production ready", "stack is ga", "brew install stack          # stable"],
  },
  {
    id: "nightly1-packet",
    path: join(stackRoot, "docs", "NIGHTLY_1.md"),
    required: [
      "not launched",
      "manifest-first installer",
      "publishable: true",
      "Telemetry on (anonymous)",
      "Hosted Synth features are optional",
      "make smoke-release-site-contract",
    ],
    forbidden: ["nightly 1 is production ready", "nightly 1 is ga", "public nightly is live"],
  },
  {
    id: "distribution-doc",
    path: join(stackRoot, "docs", "DISTRIBUTION.md"),
    required: [
      "single first-party installer",
      "make smoke-release-site-contract",
      "release-site contract smoke",
      "publishable: true",
      "Download measurement",
    ],
    forbidden: ["installer url is live", "package-manager channels are live"],
  },
  {
    id: "telemetry-doc",
    path: join(stackRoot, "docs", "TELEMETRY.md"),
    required: [
      "Telemetry: on by default",
      "GET /telemetry/status",
      "POST /telemetry/events",
      "Never send",
      "Local ready · Synth sign-in optional",
    ],
    forbidden: ["Authenticate to continue"],
  },
  {
    id: "release-doc",
    path: join(stackRoot, "docs", "RELEASE.md"),
    required: ["dev / nightly", "stable", "make smoke-release-site-contract", "Changelog split"],
    forbidden: ["Homebrew/npm/Docker/OS package-manager channels are live"],
  },
  {
    id: "mintlify-overview",
    path: join(workspaceRoot, "docs", "docs", "stack", "overview.mdx"),
    optional: true,
    required: [
      "internal alpha",
      "runs locally without Synth signup",
      "Public installer paths will be listed here after",
      "stack update --check",
    ],
    forbidden: ["public nightly is live", "requires Synth signup"],
  },
  {
    id: "mintlify-changelog",
    path: join(workspaceRoot, "docs", "docs", "stack", "changelog.mdx"),
    optional: true,
    required: ["nightly", "planning", "internal alpha", "Public package-manager"],
    forbidden: ["stack is ga", "stack is production ready"],
  },
  {
    id: "growth-nightly-marketing",
    path: join(workspaceRoot, "growth", "src", "marketing", "blogs", "planned", "stack-handoffs", "NIGHTLY1_MARKETING.md"),
    optional: true,
    required: [
      "planning only; do not publish",
      "Nightly 1 is not launched",
      "coming soon",
      "Hosted Synth features are optional",
      "Disallowed Nightly 1 copy",
    ],
    forbidden: ["draft: false"],
  },
  {
    id: "growth-blog-draft",
    path: join(workspaceRoot, "growth", "src", "marketing", "blogs", "draft", "stack-handoffs", "index.mdx"),
    optional: true,
    required: ["draft: true"],
    forbidden: ["draft: false", "GameBench improvement"],
  },
]

const results = surfaces.map(checkSurface)
const failures = results.filter((result) => result.status === "fail")
const requiredMissing = results.filter((result) => result.status === "missing")
const optionalMissing = results.filter((result) => result.status === "missing" && surfaceById(result.id)?.optional)
const hardMissing = requiredMissing.filter((result) => !surfaceById(result.id)?.optional)

const summary = {
  stamp,
  ok: failures.length === 0 && hardMissing.length === 0,
  checked: results.filter((result) => result.status !== "missing").length,
  skipped_optional: optionalMissing.map((result) => result.id),
  results,
}

mkdirSync(evidenceDir, { recursive: true })
writeFileSync(join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

if (!summary.ok) {
  console.error("launch_docs_alignment_smoke_failed")
  console.error(JSON.stringify(summary, null, 2))
  process.exit(1)
}

console.log("launch_docs_alignment_smoke_ok")
console.log(JSON.stringify({ proof_dir: evidenceDir, ...summary }, null, 2))

function checkSurface(surface: Surface): SurfaceResult {
  if (!existsSync(surface.path)) {
    return {
      id: surface.id,
      path: surface.path,
      status: "missing",
      missing_required: surface.required,
      found_forbidden: [],
    }
  }

  const text = normalize(readFileSync(surface.path, "utf8"))
  const missingRequired = surface.required.filter((value) => !text.includes(normalize(value)))
  const foundForbidden = (surface.forbidden ?? []).filter((value) => text.includes(normalize(value)))

  return {
    id: surface.id,
    path: surface.path,
    status: missingRequired.length === 0 && foundForbidden.length === 0 ? "pass" : "fail",
    missing_required: missingRequired,
    found_forbidden: foundForbidden,
  }
}

function surfaceById(id: string): Surface | undefined {
  return surfaces.find((surface) => surface.id === id)
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_>#{}\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
