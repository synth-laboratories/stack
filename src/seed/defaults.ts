import { cpSync, existsSync, mkdirSync, readdirSync, type Dirent } from "node:fs"
import { join } from "node:path"
import { stackAppRoot } from "../version.js"

export function bundledDefaultsRoot(appRoot = stackAppRoot()): string {
  return join(appRoot, "bundled")
}

export function ensureStackDefaults(stackDataRoot: string, appRoot = stackAppRoot()): void {
  const bundledRoot = bundledDefaultsRoot(appRoot)
  if (!existsSync(bundledRoot)) return

  for (const subdir of ["monitors", "gardeners", "remote_gardeners", "guidance"] as const) {
    const source = join(bundledRoot, subdir)
    if (!existsSync(source)) continue
    copyTreeIfMissing(source, join(stackDataRoot, ".stack", subdir))
  }

  mkdirSync(join(stackDataRoot, ".stack", "meta-threads"), { recursive: true })
  mkdirSync(join(stackDataRoot, ".stack", "sessions"), { recursive: true })
}

function copyTreeIfMissing(source: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  let entries: Dirent[]
  try {
    entries = readdirSync(source, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const srcPath = join(source, entry.name)
    const dstPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyTreeIfMissing(srcPath, dstPath)
      continue
    }
    if (entry.isFile() && !existsSync(dstPath)) {
      cpSync(srcPath, dstPath)
    }
  }
}
