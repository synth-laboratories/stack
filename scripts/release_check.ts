#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { harnessSpeakerLabel, isSemver, stackChannel, stackVersion, stackVersionMeta } from "../src/version.ts"

const stackRoot = join(import.meta.dir, "..")
const meta = stackVersionMeta(stackRoot)
const pkg = JSON.parse(readFileSync(join(stackRoot, "package.json"), "utf8")) as { version?: string }

if (!isSemver(meta.version)) {
  console.error(`version.json version is not semver: ${meta.version}`)
  process.exit(1)
}

if (stackVersion(stackRoot) !== meta.version) {
  console.error(`stackVersion() reads ${stackVersion(stackRoot)} but version.json is ${meta.version}`)
  process.exit(1)
}

if (pkg.version !== meta.version) {
  console.error(`package.json (${pkg.version}) out of sync with version.json (${meta.version}) — run make sync-version`)
  process.exit(1)
}

if (meta.channel === "stable") {
  const changelog = readFileSync(join(stackRoot, "CHANGELOG.md"), "utf8")
  if (!changelog.includes(`## [${meta.version}]`)) {
    console.error(`CHANGELOG.md missing section for stable ${meta.version}`)
    process.exit(1)
  }
}

if (!harnessSpeakerLabel(stackRoot).includes(meta.version)) {
  console.error(`harness label missing version ${meta.version}`)
  process.exit(1)
}

console.log(`release-check ok · stack ${meta.version} (${stackChannel(stackRoot)})`)
