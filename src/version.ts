import { readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  readVersionFile,
  type StackChannel,
  type StackVersionFile,
} from "./version-file.js"

export const STACK_PRODUCT_NAME = "Stack"
export const STACK_MCP_SERVER_NAME = "stack-live-ops"

type PackageMeta = {
  name?: string
  version?: string
  description?: string
}

let cachedAppRoot: string | undefined
let cachedVersionFile: StackVersionFile | undefined
let cachedMeta: PackageMeta | undefined

export function stackAppRoot(fromModuleUrl = import.meta.url): string {
  if (cachedAppRoot) return cachedAppRoot
  cachedAppRoot = join(dirname(fileURLToPath(fromModuleUrl)), "..")
  return cachedAppRoot
}

function readPackageMeta(appRoot = stackAppRoot()): PackageMeta {
  if (cachedMeta) return cachedMeta
  try {
    cachedMeta = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as PackageMeta
  } catch {
    cachedMeta = {}
  }
  return cachedMeta
}

export function stackVersionMeta(appRoot?: string): StackVersionFile {
  const root = appRoot ?? stackAppRoot()
  if (!appRoot && cachedVersionFile) return cachedVersionFile
  try {
    const file = readVersionFile(root)
    if (!appRoot) cachedVersionFile = file
    return file
  } catch {
    const fallback = readPackageMeta(root).version ?? "0.0.0"
    const meta: StackVersionFile = {
      version: fallback,
      channel: "stable",
      release: fallback.replace(/-.*$/, ""),
    }
    if (!appRoot) cachedVersionFile = meta
    return meta
  }
}

export function stackVersion(appRoot?: string): string {
  return stackVersionMeta(appRoot).version
}

export function stackChannel(appRoot?: string): StackChannel {
  const fromEnv = process.env.STACK_CHANNEL?.trim().toLowerCase()
  if (fromEnv === "stable" || fromEnv === "dev") return fromEnv
  return stackVersionMeta(appRoot).channel
}

export function stackReleaseVersion(appRoot?: string): string {
  return stackVersionMeta(appRoot).release
}

export function stackPackageName(appRoot?: string): string {
  return readPackageMeta(appRoot ?? stackAppRoot()).name ?? "@synth-laboratories/stack"
}

export function stackVersionLabel(appRoot?: string): string {
  const meta = stackVersionMeta(appRoot)
  if (meta.channel === "dev") {
    return `${STACK_PRODUCT_NAME} ${meta.version} (dev · stable ${meta.release})`
  }
  return `${STACK_PRODUCT_NAME} ${meta.version}`
}

const KNOWN_HARNESS_NAMES: Record<string, string> = {
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
}

export function harnessDisplayName(codexCommand?: string): string {
  const raw = (codexCommand ?? process.env.STACK_CODEX_COMMAND ?? "codex").trim()
  if (!raw) return "Codex"
  const executable = raw.split(/\s+/)[0] ?? "codex"
  const base = basename(executable).replace(/\.(exe|cmd|bat)$/i, "")
  if (!base) return "Codex"
  const known = KNOWN_HARNESS_NAMES[base.toLowerCase()]
  if (known) return known
  return base.charAt(0).toUpperCase() + base.slice(1)
}

export function harnessSpeakerLabel(appRoot?: string, codexCommand?: string): string {
  return `${harnessDisplayName(codexCommand)} · ${stackVersion(appRoot)}`
}

export function wantsVersionFlag(argv: string[]): boolean {
  return argv.includes("--version") || argv.includes("-V")
}

export function printStackVersion(command = "stack", appRoot?: string): void {
  const meta = stackVersionMeta(appRoot)
  const pkg = readPackageMeta(appRoot ?? stackAppRoot())
  console.log(`${command} ${meta.version}`)
  console.log(`channel: ${meta.channel}`)
  if (meta.channel === "dev") {
    console.log(`stable release: ${meta.release}`)
  }
  if (pkg.description) console.log(pkg.description)
}

export function isSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version)
}

export type { StackChannel, StackVersionFile } from "./version-file.js"
