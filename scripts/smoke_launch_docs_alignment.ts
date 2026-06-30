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
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const evidenceDir = resolve(stackRoot, ".stack", "evidence", "launch-docs-alignment", stamp)

const surfaces: Surface[] = [
  {
    id: "repo-readme",
    path: join(stackRoot, "README.md"),
    required: [
      "public alpha",
      "usesynth.ai/keys",
      "git clone https://github.com/synth-laboratories/stack.git",
      "stack doctor",
      "stack demo",
      "first-party installer",
      "MIT",
    ],
    forbidden: [
      "Private repo access required",
      "no public release yet",
      "stack is production ready",
      "stack is ga",
      "brew install stack          # stable",
      "synth-ai/.env",
    ],
  },
  {
    id: "distribution-doc",
    path: join(stackRoot, "docs", "DISTRIBUTION.md"),
    required: [
      "single first-party installer",
      "make smoke-release-site-contract",
    ],
    forbidden: ["brew install stack is the default"],
  },
  {
    id: "release-doc",
    path: join(stackRoot, "docs", "RELEASE.md"),
    required: ["version.json", "make sync-version", "QUALITY.md"],
  },
  {
    id: "security-doc",
    path: join(stackRoot, "SECURITY.md"),
    required: ["security@usesynth.ai", "~/.codex"],
  },
]

const results: SurfaceResult[] = []
const failures: string[] = []

for (const surface of surfaces) {
  if (!existsSync(surface.path)) {
    results.push({
      id: surface.id,
      path: surface.path,
      status: surface.optional ? "pass" : "missing",
      missing_required: surface.optional ? [] : [`file missing: ${surface.path}`],
      found_forbidden: [],
    })
    if (!surface.optional) failures.push(`${surface.id}: missing ${surface.path}`)
    continue
  }

  const text = readFileSync(surface.path, "utf8")
  const missingRequired = surface.required.filter((needle) => !text.includes(needle))
  const foundForbidden = (surface.forbidden ?? []).filter((needle) => text.includes(needle))
  const status =
    missingRequired.length > 0 ? "fail" : foundForbidden.length > 0 ? "fail" : "pass"
  results.push({
    id: surface.id,
    path: surface.path,
    status,
    missing_required: missingRequired,
    found_forbidden: foundForbidden,
  })
  if (status !== "pass") {
    failures.push(
      `${surface.id}: missing=[${missingRequired.join(", ")}] forbidden=[${foundForbidden.join(", ")}]`,
    )
  }
}

mkdirSync(evidenceDir, { recursive: true })
const summary = {
  ok: failures.length === 0,
  stamp,
  evidence_dir: evidenceDir,
  surfaces: results,
  failures,
}
writeFileSync(join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`launch_docs_alignment_failed: ${failures.join("; ")}`)
  process.exit(1)
}

console.log("launch_docs_alignment_ok")
console.log(JSON.stringify(summary, null, 2))
