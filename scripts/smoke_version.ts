#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { harnessDisplayName, harnessSpeakerLabel, stackChannel, stackVersion, stackVersionLabel } from "../src/version.ts"

const stackRoot = join(import.meta.dir, "..")
const pkg = JSON.parse(readFileSync(join(stackRoot, "package.json"), "utf8")) as { version?: string }

if (stackVersion(stackRoot) !== pkg.version) {
  console.error("version mismatch between version.json and package.json")
  process.exit(1)
}

const label = harnessSpeakerLabel(stackRoot)
if (!label.startsWith(`${harnessDisplayName()} · `) || !label.includes(pkg.version ?? "")) {
  console.error("unexpected harness label", label)
  process.exit(1)
}

if (!stackVersionLabel(stackRoot).includes(pkg.version ?? "")) {
  console.error("unexpected version label")
  process.exit(1)
}

console.log("stack_version_smoke_ok", stackVersionLabel(stackRoot), stackChannel(stackRoot))
