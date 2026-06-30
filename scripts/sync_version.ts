#!/usr/bin/env bun

import { join } from "node:path"
import {
  readVersionFile,
  syncPackageJsonVersion,
  writeVersionFile,
  type StackVersionFile,
} from "../src/version-file.ts"
import { isSemver, stackVersion } from "../src/version.ts"

const stackRoot = join(import.meta.dir, "..")

export function applyVersionFile(appRoot: string, meta: StackVersionFile): void {
  if (!isSemver(meta.version)) {
    throw new Error(`version is not semver: ${meta.version}`)
  }
  writeVersionFile(appRoot, meta)
  syncPackageJsonVersion(appRoot, meta.version)
}

export function syncVersionFromFile(appRoot: string): StackVersionFile {
  const meta = readVersionFile(appRoot)
  syncPackageJsonVersion(appRoot, meta.version)
  if (stackVersion(appRoot) !== meta.version) {
    throw new Error(`version sync failed: expected ${meta.version}, got ${stackVersion(appRoot)}`)
  }
  return meta
}

if (import.meta.main) {
  const meta = syncVersionFromFile(stackRoot)
  console.log(`sync-version ok · ${meta.version} (${meta.channel})`)
}
