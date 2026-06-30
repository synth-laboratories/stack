#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { nextDevLineAfterRelease, promoteReleaseVersion } from "../src/version-file.ts"
import { applyVersionFile } from "./sync_version.ts"

const stackRoot = join(import.meta.dir, "..")
const release = process.argv[2]?.trim()
const reopenDev = process.argv.includes("--reopen-dev")

if (!release) {
  console.error("usage: bun scripts/release_promote.ts <semver> [--reopen-dev]")
  process.exit(1)
}

applyVersionFile(stackRoot, promoteReleaseVersion(release))

const changelogPath = join(stackRoot, "CHANGELOG.md")
const changelog = readFileSync(changelogPath, "utf8")
if (!changelog.includes(`## [${release}]`)) {
  console.error(`CHANGELOG.md missing ## [${release}] — add release notes before promote`)
  process.exit(1)
}

if (reopenDev) {
  applyVersionFile(stackRoot, nextDevLineAfterRelease(release))
  const meta = readFileSync(join(stackRoot, "version.json"), "utf8")
  console.log(`release-promote ok · stable ${release}, reopened dev line`)
  console.log(meta.trim())
} else {
  console.log(`release-promote ok · stable ${release}`)
}
