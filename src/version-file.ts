import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type StackChannel = "stable" | "dev"

export type StackVersionFile = {
  version: string
  channel: StackChannel
  release: string
}

export function versionFilePath(appRoot: string): string {
  return join(appRoot, "version.json")
}

export function packageJsonPath(appRoot: string): string {
  return join(appRoot, "package.json")
}

export function readVersionFile(appRoot: string): StackVersionFile {
  const raw = JSON.parse(readFileSync(versionFilePath(appRoot), "utf8")) as StackVersionFile
  if (!raw.version || !raw.channel || !raw.release) {
    throw new Error(`invalid version.json at ${versionFilePath(appRoot)}`)
  }
  return raw
}

export function writeVersionFile(appRoot: string, value: StackVersionFile): void {
  writeFileSync(versionFilePath(appRoot), `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export function syncPackageJsonVersion(appRoot: string, version: string): void {
  const path = packageJsonPath(appRoot)
  const pkg = JSON.parse(readFileSync(path, "utf8")) as { version?: string }
  pkg.version = version
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8")
}

export function utcDateStamp(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}${m}${d}`
}

export function nextDevVersion(current: StackVersionFile, date = new Date()): string {
  const stamp = utcDateStamp(date)
  const devPattern = /^(\d+\.\d+\.\d+)-dev\.(\d{8})\.(\d+)$/
  const match = current.version.match(devPattern)
  if (match && match[2] === stamp) {
    const build = Number.parseInt(match[3] ?? "0", 10) + 1
    return `${match[1]}-dev.${stamp}.${build}`
  }
  const [major, minor] = current.release.split(".").map((part) => Number.parseInt(part, 10))
  const nextMinor = Number.isFinite(minor) ? minor + 1 : 2
  const nextMajor = Number.isFinite(major) ? major : 0
  return `${nextMajor}.${nextMinor}.0-dev.${stamp}.1`
}

export function promoteReleaseVersion(release: string): StackVersionFile {
  if (!/^\d+\.\d+\.\d+$/.test(release)) {
    throw new Error(`release must be plain semver without pre-release: ${release}`)
  }
  return {
    version: release,
    channel: "stable",
    release,
  }
}

export function nextDevLineAfterRelease(release: string, date = new Date()): StackVersionFile {
  const stamp = utcDateStamp(date)
  const [major, minor] = release.split(".").map((part) => Number.parseInt(part, 10))
  const nextMinor = Number.isFinite(minor) ? minor + 1 : 1
  const nextMajor = Number.isFinite(major) ? major : 0
  return {
    version: `${nextMajor}.${nextMinor}.0-dev.${stamp}.1`,
    channel: "dev",
    release,
  }
}
