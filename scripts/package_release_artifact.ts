#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto"
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

type VersionMeta = {
  version: string
  channel: "stable" | "dev" | string
  release: string
}

const appRoot = resolve(import.meta.dir, "..")
const versionMeta = JSON.parse(readFileSync(join(appRoot, "version.json"), "utf8")) as VersionMeta
const target = currentTargetTriple()
const channel = versionMeta.channel === "stable" ? "stable" : "nightly"
const stamp = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z-${randomUUID().slice(0, 8)}`
const outputRoot = resolve(appRoot, ".stack", "evidence", "release-artifact", stamp)
const payloadRoot = join(outputRoot, "payload")
const appPayload = join(payloadRoot, "share", "stack", "app")
const binaryPayload = join(payloadRoot, "share", "stack", "bin")
const archiveName = `stack-${versionMeta.version}-${target}.tar.gz`
const archivePath = join(outputRoot, archiveName)
const manifestPath = join(outputRoot, "manifest.json")
const summaryPath = join(outputRoot, "summary.json")
const releaseSiteRoot = join(outputRoot, "release-site")
const releaseSiteDownloads = join(releaseSiteRoot, "releases", "downloads", versionMeta.version)
const releaseSiteChannelManifest = join(releaseSiteRoot, "releases", `${channel}.json`)
const releaseSiteVersionManifest = join(releaseSiteRoot, "releases", "versions", `${versionMeta.version}.json`)

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(join(payloadRoot, "bin"), { recursive: true })
mkdirSync(appPayload, { recursive: true })
mkdirSync(binaryPayload, { recursive: true })

for (const path of ["src", "crates", "bin", "docs", "packaging", "bundled", ".codex"]) copyIfExists(path)
for (const path of [
  "package.json",
  "bun.lock",
  "Cargo.toml",
  "Cargo.lock",
  "version.json",
  "README.md",
  "CHANGELOG.md",
  "stack.config.json",
  "tsconfig.json",
]) copyIfExists(path)

const legalFiles = ["LICENSE", "NOTICE"].filter((path) => existsSync(join(appRoot, path)))
for (const path of legalFiles) copyIfExists(path)

const stackdSource = join(appRoot, "target", "debug", "stackd")
const stackdBundled = existsSync(stackdSource)
if (stackdBundled) {
  cpSync(stackdSource, join(binaryPayload, "stackd"))
  chmodSync(join(binaryPayload, "stackd"), 0o755)
}

writeLauncher("stack", [
  'APP_ROOT="$(cd "$STACK_LAUNCHER_DIR/../share/stack/app" && pwd)"',
  'export STACK_APP_ROOT="${STACK_APP_ROOT:-$APP_ROOT}"',
  'export STACK_INSTALL_ROOT="${STACK_INSTALL_ROOT:-$APP_ROOT}"',
  'exec bun run "$STACK_APP_ROOT/src/main.ts" "$@"',
])
writeLauncher("stack-mcp", [
  'APP_ROOT="$(cd "$STACK_LAUNCHER_DIR/../share/stack/app" && pwd)"',
  'export STACK_APP_ROOT="${STACK_APP_ROOT:-$APP_ROOT}"',
  'export STACK_INSTALL_ROOT="${STACK_INSTALL_ROOT:-$APP_ROOT}"',
  'exec bun run "$STACK_APP_ROOT/src/mcp/server.ts" "$@"',
])
writeLauncher(
  "stackd",
  stackdBundled
    ? [
        'ROOT="$(cd "$STACK_LAUNCHER_DIR/../share/stack" && pwd)"',
        'export STACK_INSTALL_ROOT="${STACK_INSTALL_ROOT:-$ROOT/app}"',
        'exec "$ROOT/bin/stackd" "$@"',
      ]
    : [
        'APP_ROOT="$(cd "$STACK_LAUNCHER_DIR/../share/stack/app" && pwd)"',
        'export STACK_INSTALL_ROOT="${STACK_INSTALL_ROOT:-$APP_ROOT}"',
        'exec cargo run --manifest-path "$APP_ROOT/Cargo.toml" -p stackd -- "$@"',
      ],
)

writeFileSync(join(payloadRoot, "share", "stack", "VERSION"), `${versionMeta.version}\n`)
writeFileSync(
  join(payloadRoot, "share", "stack", "LEGAL_STATUS"),
  legalFiles.length === 2 ? "LICENSE and NOTICE included\n" : "LICENSE and NOTICE missing; artifact proof is not publishable\n",
)

run(["tar", "-czf", archivePath, "-C", payloadRoot, "."])
const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex")
writeFileSync(join(outputRoot, `${archiveName}.sha256`), `${sha256}  ${archiveName}\n`)

const archiveSize = statSync(archivePath).size
mkdirSync(releaseSiteDownloads, { recursive: true })
mkdirSync(join(releaseSiteRoot, "releases", "versions"), { recursive: true })
cpSync(archivePath, join(releaseSiteDownloads, archiveName))
cpSync(join(outputRoot, `${archiveName}.sha256`), join(releaseSiteDownloads, `${archiveName}.sha256`))
cpSync(join(appRoot, "packaging", "install.sh"), join(releaseSiteRoot, "install.sh"))
chmodSync(join(releaseSiteRoot, "install.sh"), 0o755)

const manifest = {
  schema_version: 1,
  channel,
  version: versionMeta.version,
  released_at: new Date().toISOString(),
  yanked: false,
  targets: {
    [target]: {
      url: join(releaseSiteDownloads, archiveName),
      sha256,
      size: archiveSize,
    },
  },
  notes_url: "https://docs.usesynth.ai/stack/changelog",
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(releaseSiteChannelManifest, `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(releaseSiteVersionManifest, `${JSON.stringify(manifest, null, 2)}\n`)

const archiveList = run(["tar", "-tzf", archivePath]).stdout.trim().split("\n")
const requiredEntries = [
  "./bin/stack",
  "./bin/stackd",
  "./bin/stack-mcp",
  "./share/stack/VERSION",
  "./share/stack/app/package.json",
  "./share/stack/app/src/main.ts",
  "./share/stack/app/bundled/monitors/default.toml",
  "./share/stack/app/.codex/skills/oss-gepa/SKILL.md",
]
const missingEntries = requiredEntries.filter((entry) => !archiveList.includes(entry))
const publishable = missingEntries.length === 0 && legalFiles.length === 2 && stackdBundled
const summary = {
  stamp,
  ok: missingEntries.length === 0,
  publishable,
  publish_blockers: [
    ...(legalFiles.length === 2 ? [] : ["missing LICENSE and NOTICE"]),
    ...(stackdBundled ? [] : ["missing bundled stackd binary"]),
  ],
  version: versionMeta.version,
  channel,
  target,
  archive: archivePath,
  sha256,
  manifest: manifestPath,
  release_site: releaseSiteRoot,
  release_site_install_sh: join(releaseSiteRoot, "install.sh"),
  release_site_channel_manifest: releaseSiteChannelManifest,
  release_site_version_manifest: releaseSiteVersionManifest,
  release_site_archive: join(releaseSiteDownloads, archiveName),
  size: archiveSize,
  required_entries: requiredEntries,
  missing_entries: missingEntries,
}
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

if (missingEntries.length > 0) {
  console.error(`release_artifact_package_failed: missing ${missingEntries.join(", ")}`)
  process.exit(1)
}

console.log("release_artifact_package_ok")
console.log(JSON.stringify(summary, null, 2))

function copyIfExists(relativePath: string): void {
  const source = join(appRoot, relativePath)
  if (!existsSync(source)) return
  cpSync(source, join(appPayload, relativePath), { recursive: true })
}

function writeLauncher(name: string, lines: string[]): void {
  const path = join(payloadRoot, "bin", name)
  writeFileSync(path, ["#!/usr/bin/env bash", "set -euo pipefail", ...launcherPrelude(), ...lines, ""].join("\n"))
  chmodSync(path, 0o755)
}

function launcherPrelude(): string[] {
  return [
    'STACK_LAUNCHER="$0"',
    'while [ -L "$STACK_LAUNCHER" ]; do',
    '  STACK_LINK="$(readlink "$STACK_LAUNCHER")"',
    '  case "$STACK_LINK" in',
    '    /*) STACK_LAUNCHER="$STACK_LINK" ;;',
    '    *) STACK_LAUNCHER="$(cd "$(dirname "$STACK_LAUNCHER")" && pwd)/$STACK_LINK" ;;',
    '  esac',
    'done',
    'STACK_LAUNCHER_DIR="$(cd "$(dirname "$STACK_LAUNCHER")" && pwd)"',
  ]
}

function run(command: string[]): { stdout: string; stderr: string } {
  const result = spawnSync(command[0], command.slice(1), { cwd: appRoot, encoding: "utf8" })
  if (result.status !== 0) {
    console.error(`${basename(command[0])} failed: ${command.join(" ")}`)
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(result.status ?? 1)
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

function currentTargetTriple(): string {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  if (process.platform === "darwin") return `${arch}-apple-darwin`
  if (process.platform === "linux") return `${arch}-unknown-linux-musl`
  return `${arch}-${process.platform}`
}
