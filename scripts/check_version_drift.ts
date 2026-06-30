#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isSemver, stackVersionMeta } from "../src/version.ts"

const stackRoot = join(import.meta.dir, "..")
const meta = stackVersionMeta(stackRoot)
const pkg = JSON.parse(readFileSync(join(stackRoot, "package.json"), "utf8")) as { version?: string }
const cargoToml = readFileSync(join(stackRoot, "Cargo.toml"), "utf8")
const cargoMatch = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)
const cargoVersion = cargoMatch?.[1]

const failures: string[] = []

if (!isSemver(meta.version)) {
  failures.push(`version.json version is not semver: ${meta.version}`)
}

if (pkg.version !== meta.version) {
  failures.push(`package.json (${pkg.version}) != version.json.version (${meta.version})`)
}

if (!cargoVersion) {
  failures.push("Cargo.toml missing workspace package version")
} else if (cargoVersion !== meta.release) {
  failures.push(`Cargo.toml (${cargoVersion}) != version.json.release (${meta.release})`)
}

if (meta.channel === "dev" && !meta.version.includes("-dev.")) {
  failures.push(`version.json.channel=dev requires -dev. prerelease in version (${meta.version})`)
}

if (failures.length > 0) {
  console.error("version_drift_check_failed:")
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`version_drift_check_ok · pkg=${meta.version} cargo=${meta.release} channel=${meta.channel}`)
