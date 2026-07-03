import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { constants } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { StackConfig } from "./config.js"
import { stackChannel, stackReleaseVersion, stackVersion } from "./version.js"

export type UpdateChannel = "stable" | "nightly"

export type UpdateTarget = {
  url?: string
  sha256?: string
  size?: number
  signature_url?: string
  attestation_url?: string
}

export type UpdateManifest = {
  schema_version: number
  channel: UpdateChannel | string
  version: string
  released_at?: string
  yanked?: boolean
  targets?: Record<string, UpdateTarget>
  notes_url?: string
}

export type UpdateCheckReport = {
  generated_at: string
  current_version: string
  current_channel: string
  requested_channel: UpdateChannel
  manifest_source: string
  status: "available" | "current" | "unavailable" | "unsupported-target" | "yanked"
  latest_version?: string
  target?: string
  artifact_url?: string
  artifact_sha256?: string
  artifact_size?: number
  notes_url?: string
  message: string
  mutates: false
}

export type UpdateApplyReport = Omit<UpdateCheckReport, "mutates" | "status" | "message"> & {
  status: "installed" | "current"
  install_dir: string
  bin_dir: string
  installed_path?: string
  previous_path?: string
  message: string
  mutates: true
}

export async function runUpdate(config: StackConfig, argv: string[]): Promise<number> {
  const check = argv.includes("--check")
  const apply = argv.includes("--apply")
  if (check === apply) {
    console.error("usage: stack update --check|--apply [--channel nightly|stable] [--manifest <url-or-path>] [--json]")
    console.error("       stack update --apply [--install-dir <dir>] [--bin-dir <dir>]")
    return 1
  }

  const json = argv.includes("--json")
  const requestedChannel = parseChannel(argv, config.appRoot)
  if (!requestedChannel.ok) {
    console.error(requestedChannel.message)
    console.error("usage: stack update --check|--apply [--channel nightly|stable] [--manifest <url-or-path>] [--json]")
    return 1
  }

  const manifestArg = readArg(argv, "--manifest")
  if (argv.includes("--manifest") && !manifestArg) {
    console.error("missing value for --manifest")
    console.error("usage: stack update --check|--apply [--channel nightly|stable] [--manifest <url-or-path>] [--json]")
    return 1
  }

  const manifestSource = manifestArg ?? process.env.STACK_UPDATE_MANIFEST_URL?.trim() ?? defaultManifestUrl(requestedChannel.channel)
  let report: UpdateCheckReport | UpdateApplyReport
  try {
    report = check
      ? await checkUpdate(config, requestedChannel.channel, manifestSource)
      : await applyUpdate(config, {
          channel: requestedChannel.channel,
          manifestSource,
          installDir: readArg(argv, "--install-dir"),
          binDir: readArg(argv, "--bin-dir"),
        })
  } catch (error) {
    const message = errorMessage(error)
    if (json) {
      console.log(JSON.stringify({
        generated_at: new Date().toISOString(),
        current_version: stackVersion(config.appRoot),
        current_channel: stackChannel(config.appRoot),
        requested_channel: requestedChannel.channel,
        manifest_source: manifestSource,
        status: "failed",
        message,
        mutates: apply,
      }, null, 2))
    } else {
      console.error(`stack update failed: ${message}`)
    }
    return 1
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else if (report.mutates) {
    printUpdateApplyReport(report)
  } else {
    printUpdateReport(report)
  }

  return 0
}

export async function checkUpdate(
  config: StackConfig,
  channel = defaultUpdateChannel(config.appRoot),
  manifestSource = defaultManifestUrl(channel),
): Promise<UpdateCheckReport> {
  const base = {
    generated_at: new Date().toISOString(),
    current_version: stackVersion(config.appRoot),
    current_channel: stackChannel(config.appRoot),
    requested_channel: channel,
    manifest_source: manifestSource,
    mutates: false as const,
  }

  const manifestResult = await readManifest(manifestSource, config.appRoot)
  if (!manifestResult.ok) {
    return {
      ...base,
      status: "unavailable",
      message: manifestResult.message,
    }
  }

  const manifest = manifestResult.manifest
  const target = currentTargetTriple()
  const artifact = manifest.targets?.[target]
  if (manifest.yanked) {
    return {
      ...base,
      status: "yanked",
      latest_version: manifest.version,
      target,
      notes_url: manifest.notes_url,
      message: `manifest ${manifest.version} is yanked`,
    }
  }

  if (!artifact) {
    return {
      ...base,
      status: "unsupported-target",
      latest_version: manifest.version,
      target,
      notes_url: manifest.notes_url,
      message: `manifest has no artifact for ${target}`,
    }
  }

  const current = stackVersion(config.appRoot)
  const latest = manifest.version
  return {
    ...base,
    status: current === latest ? "current" : "available",
    latest_version: latest,
    target,
    artifact_url: artifact.url,
    artifact_sha256: artifact.sha256,
    artifact_size: artifact.size,
    notes_url: manifest.notes_url,
    message: current === latest ? `already on ${latest}` : `update available: ${current} -> ${latest}`,
  }
}

export async function applyUpdate(
  config: StackConfig,
  options: {
    channel?: UpdateChannel
    manifestSource?: string
    installDir?: string
    binDir?: string
  } = {},
): Promise<UpdateApplyReport> {
  const channel = options.channel ?? defaultUpdateChannel(config.appRoot)
  const manifestSource = options.manifestSource ?? defaultManifestUrl(channel)
  const check = await checkUpdate(config, channel, manifestSource)
  const installDir = resolveInstallDir(config.appRoot, options.installDir)
  const binDir = resolveBinDir(options.binDir)
  const base = {
    generated_at: check.generated_at,
    current_version: check.current_version,
    current_channel: check.current_channel,
    requested_channel: check.requested_channel,
    manifest_source: check.manifest_source,
    latest_version: check.latest_version,
    target: check.target,
    artifact_url: check.artifact_url,
    artifact_sha256: check.artifact_sha256,
    artifact_size: check.artifact_size,
    notes_url: check.notes_url,
    install_dir: installDir,
    bin_dir: binDir,
    mutates: true as const,
  }

  if (check.status === "current") {
    return {
      ...base,
      status: "current",
      message: check.message,
    }
  }
  if (check.status !== "available") {
    throw new Error(check.message)
  }
  if (!check.latest_version) throw new Error("update manifest missing latest version")
  if (!check.artifact_url) throw new Error("update manifest missing artifact url")
  if (!check.artifact_sha256) throw new Error("update manifest target missing sha256")

  const tempRoot = await mkdtemp(join(tmpdir(), "stack-update-"))
  try {
    const archivePath = join(tempRoot, "stack.tar.gz")
    await downloadArtifact(check.artifact_url, archivePath)
    await verifySha256(archivePath, check.artifact_sha256)
    const versionsDir = join(installDir, "versions")
    const versionDir = join(versionsDir, check.latest_version)
    const tempVersionDir = join(versionsDir, `.tmp-${check.latest_version}-${process.pid}`)
    await mkdir(versionsDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await rm(tempVersionDir, { recursive: true, force: true })
    await mkdir(tempVersionDir, { recursive: true })
    extractArchive(archivePath, tempVersionDir)
    await assertExecutable(join(tempVersionDir, "bin", "stack"), "artifact missing executable bin/stack")
    await assertExecutable(join(tempVersionDir, "bin", "stackd"), "artifact missing executable bin/stackd")

    const currentLink = join(installDir, "current")
    const currentTarget = await readSymlinkTarget(currentLink)
    if (currentTarget && currentTarget !== versionDir) {
      const previousNext = join(installDir, "previous.next")
      await rm(previousNext, { force: true })
      await symlink(currentTarget, previousNext)
      await rename(previousNext, join(installDir, "previous"))
    }

    await rm(versionDir, { recursive: true, force: true })
    await rename(tempVersionDir, versionDir)
    const currentNext = join(installDir, "current.next")
    await rm(currentNext, { force: true })
    await symlink(versionDir, currentNext)
    await rm(currentLink, { force: true })
    await rename(currentNext, currentLink)
    await linkExecutable(binDir, "stack", currentLink)
    await linkExecutable(binDir, "stackd", currentLink)
    await linkExecutable(binDir, "stack-mcp", currentLink)

    return {
      ...base,
      status: "installed",
      installed_path: versionDir,
      previous_path: currentTarget,
      message: `installed ${check.latest_version}; restart Stack to use the new version`,
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function parseChannel(argv: string[], appRoot: string): { ok: true; channel: UpdateChannel } | { ok: false; message: string } {
  if (!argv.includes("--channel")) return { ok: true, channel: defaultUpdateChannel(appRoot) }

  const raw = readArg(argv, "--channel")?.toLowerCase()
  if (!raw) return { ok: false, message: "missing value for --channel" }
  if (raw === "nightly" || raw === "dev") return { ok: true, channel: "nightly" }
  if (raw === "stable") return { ok: true, channel: "stable" }
  return { ok: false, message: `unsupported update channel ${raw}` }
}

export function defaultUpdateChannel(appRoot: string): UpdateChannel {
  return stackChannel(appRoot) === "dev" ? "nightly" : "stable"
}

export function defaultManifestUrl(channel: UpdateChannel): string {
  return `https://stack.usesynth.ai/releases/${channel}.json`
}

async function readManifest(source: string, appRoot: string): Promise<
  | { ok: true; manifest: UpdateManifest }
  | { ok: false; message: string }
> {
  try {
    const text = isUrl(source) ? await fetchText(source) : await readFile(resolveManifestPath(source, appRoot), "utf8")
    const parsed = JSON.parse(text) as UpdateManifest
    if (parsed.schema_version !== 1) return { ok: false, message: `unsupported manifest schema ${parsed.schema_version}` }
    if (!parsed.version) return { ok: false, message: "manifest missing version" }
    return { ok: true, manifest: parsed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `manifest unavailable: ${message}` }
  }
}

function resolveManifestPath(path: string, appRoot: string): string {
  return isAbsolute(path) ? path : join(appRoot, path)
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value)
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

async function downloadArtifact(source: string, dest: string): Promise<void> {
  if (!isUrl(source)) {
    await copyFile(source, dest)
    return
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  try {
    const response = await fetch(source, { signal: controller.signal })
    if (!response.ok) throw new Error(`artifact download failed: HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    await writeFile(dest, bytes)
  } finally {
    clearTimeout(timeout)
  }
}

async function verifySha256(path: string, expected: string): Promise<void> {
  const actual = createHash("sha256").update(await readFile(path)).digest("hex")
  if (actual !== expected) throw new Error(`checksum mismatch for downloaded artifact: expected ${expected}, got ${actual}`)
}

function extractArchive(archivePath: string, dest: string): void {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", dest], { encoding: "utf8" })
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
    throw new Error(`artifact extraction failed: ${detail}`)
  }
}

async function assertExecutable(path: string, message: string): Promise<void> {
  try {
    await access(path, constants.X_OK)
  } catch {
    throw new Error(message)
  }
}

async function readSymlinkTarget(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) return undefined
    return await readlink(path)
  } catch {
    return undefined
  }
}

async function linkExecutable(binDir: string, name: string, currentLink: string): Promise<void> {
  const linkPath = join(binDir, name)
  const target = join(currentLink, "bin", name)
  await rm(linkPath, { force: true })
  await symlink(target, linkPath)
}

function resolveInstallDir(appRoot: string, override?: string): string {
  const explicit = override?.trim() || process.env.STACK_INSTALL_DIR?.trim()
  if (explicit) return resolveHome(explicit)
  const installedRoot = inferInstalledRoot(appRoot)
  return installedRoot ? dirname(installedRoot) : join(homedir(), ".local", "share", "synth-stack")
}

function resolveBinDir(override?: string): string {
  const explicit = override?.trim() || process.env.STACK_BIN_DIR?.trim()
  return explicit ? resolveHome(explicit) : join(homedir(), ".local", "bin")
}

function inferInstalledRoot(appRoot: string): string | undefined {
  const suffix = join("share", "stack", "app")
  const normalized = resolve(appRoot)
  return normalized.endsWith(suffix) ? resolve(normalized, "..", "..", "..") : undefined
}

function resolveHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(path)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function currentTargetTriple(): string {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  if (process.platform === "darwin") return `${arch}-apple-darwin`
  if (process.platform === "linux") return `${arch}-unknown-linux-musl`
  return `${arch}-${process.platform}`
}

function printUpdateReport(report: UpdateCheckReport): void {
  console.log(`Stack update check · ${report.current_version} · ${report.current_channel}`)
  console.log(`channel: ${report.requested_channel}`)
  console.log(`manifest: ${report.manifest_source}`)
  console.log(`status: ${report.status}`)
  console.log(report.message)
  if (report.latest_version) console.log(`latest: ${report.latest_version}`)
  if (report.target) console.log(`target: ${report.target}`)
  if (report.artifact_url) console.log(`artifact: ${report.artifact_url}`)
  if (report.artifact_sha256) console.log(`sha256: ${report.artifact_sha256}`)
  if (report.notes_url) console.log(`notes: ${report.notes_url}`)
  if (report.current_channel === "dev") console.log(`stable release: ${stackReleaseVersion()}`)
  console.log("mutates: false")
}

function printUpdateApplyReport(report: UpdateApplyReport): void {
  console.log(`Stack update apply · ${report.current_version} · ${report.current_channel}`)
  console.log(`channel: ${report.requested_channel}`)
  console.log(`manifest: ${report.manifest_source}`)
  console.log(`status: ${report.status}`)
  console.log(report.message)
  if (report.latest_version) console.log(`latest: ${report.latest_version}`)
  if (report.target) console.log(`target: ${report.target}`)
  if (report.artifact_url) console.log(`artifact: ${report.artifact_url}`)
  if (report.artifact_sha256) console.log(`sha256: ${report.artifact_sha256}`)
  console.log(`install_dir: ${report.install_dir}`)
  console.log(`bin_dir: ${report.bin_dir}`)
  if (report.installed_path) console.log(`installed: ${report.installed_path}`)
  if (report.previous_path) console.log(`previous: ${report.previous_path}`)
  if (report.notes_url) console.log(`notes: ${report.notes_url}`)
  console.log("mutates: true")
}
