import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import type { StackConfig } from "./config.js"
import { stackChannel, stackReleaseVersion, stackVersion } from "./version.js"

type UpdateChannel = "stable" | "nightly"

type UpdateTarget = {
  url?: string
  sha256?: string
  size?: number
  signature_url?: string
  attestation_url?: string
}

type UpdateManifest = {
  schema_version: number
  channel: UpdateChannel | string
  version: string
  released_at?: string
  yanked?: boolean
  targets?: Record<string, UpdateTarget>
  notes_url?: string
}

type UpdateCheckReport = {
  generated_at: string
  current_version: string
  current_channel: string
  requested_channel: UpdateChannel
  manifest_source: string
  status: "available" | "current" | "unavailable" | "unsupported-target" | "yanked"
  latest_version?: string
  target?: string
  artifact_url?: string
  notes_url?: string
  message: string
  mutates: false
}

export async function runUpdate(config: StackConfig, argv: string[]): Promise<number> {
  if (!argv.includes("--check")) {
    console.error("stack update currently supports only --check")
    console.error("usage: stack update --check [--channel nightly|stable] [--manifest <url-or-path>] [--json]")
    return 1
  }

  const json = argv.includes("--json")
  const requestedChannel = parseChannel(argv, config.appRoot)
  if (!requestedChannel.ok) {
    console.error(requestedChannel.message)
    console.error("usage: stack update --check [--channel nightly|stable] [--manifest <url-or-path>] [--json]")
    return 1
  }

  const manifestArg = readArg(argv, "--manifest")
  if (argv.includes("--manifest") && !manifestArg) {
    console.error("missing value for --manifest")
    console.error("usage: stack update --check [--channel nightly|stable] [--manifest <url-or-path>] [--json]")
    return 1
  }

  const manifestSource = manifestArg ?? process.env.STACK_UPDATE_MANIFEST_URL?.trim() ?? defaultManifestUrl(requestedChannel.channel)
  const report = await checkUpdate(config, requestedChannel.channel, manifestSource)

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printUpdateReport(report)
  }

  return 0
}

async function checkUpdate(config: StackConfig, channel: UpdateChannel, manifestSource: string): Promise<UpdateCheckReport> {
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
    notes_url: manifest.notes_url,
    message: current === latest ? `already on ${latest}` : `update available: ${current} -> ${latest}`,
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

function defaultUpdateChannel(appRoot: string): UpdateChannel {
  return stackChannel(appRoot) === "dev" ? "nightly" : "stable"
}

function defaultManifestUrl(channel: UpdateChannel): string {
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
  if (report.notes_url) console.log(`notes: ${report.notes_url}`)
  if (report.current_channel === "dev") console.log(`stable release: ${stackReleaseVersion()}`)
  console.log("mutates: false")
}
