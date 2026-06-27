#!/usr/bin/env bun

import { join } from "node:path"
import { nextDevVersion, readVersionFile } from "../src/version-file.ts"
import { applyVersionFile } from "./sync_version.ts"

const stackRoot = join(import.meta.dir, "..")
const current = readVersionFile(stackRoot)
const version = nextDevVersion(current)
const next = {
  version,
  channel: "dev" as const,
  release: current.release,
}

applyVersionFile(stackRoot, next)
console.log(`bump-dev ok · ${next.version} (stable ${next.release})`)
