#!/usr/bin/env bun

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"

const appRoot = resolve(import.meta.dir, "..")
const installer = resolve(appRoot, "packaging", "install.sh")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = resolve(appRoot, ".stack", "evidence", "installer-apply-rollback", stamp)
const artifactDir = join(proofDir, "artifacts")
const installDir = join(proofDir, "install")
const binDir = join(proofDir, "bin")
const target = currentTargetTriple()

rmSync(proofDir, { recursive: true, force: true })
mkdirSync(artifactDir, { recursive: true })
mkdirSync(installDir, { recursive: true })
mkdirSync(binDir, { recursive: true })

const first = createArtifact("0.2.0-nightly.apply-smoke.1")
const second = createArtifact("0.2.0-nightly.apply-smoke.2")

runInstaller(first.manifest)
assertStackVersion("0.2.0-nightly.apply-smoke.1", "after first install")

runInstaller(second.manifest)
assertStackVersion("0.2.0-nightly.apply-smoke.2", "after second install")

const rollback = spawnSync("sh", [installer, "--install-dir", installDir, "--bin-dir", binDir, "--rollback"], {
  cwd: appRoot,
  encoding: "utf8",
})
if (rollback.status !== 0) {
  fail("rollback failed", rollback)
}
if (!rollback.stdout.includes("stack_installer_rollback_ok")) {
  throw new Error("rollback output missing stack_installer_rollback_ok")
}
assertStackVersion("0.2.0-nightly.apply-smoke.1", "after rollback")

const summary = {
  stamp,
  ok: true,
  target,
  proof_dir: proofDir,
  install_dir: installDir,
  bin_dir: binDir,
  versions: [first.version, second.version],
  rollback_to: first.version,
}
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

console.log("installer_apply_rollback_smoke_ok")
console.log(JSON.stringify(summary, null, 2))

function createArtifact(version: string): { version: string; archive: string; sha256: string; manifest: string } {
  const root = join(artifactDir, version)
  const payload = join(root, "payload")
  mkdirSync(join(payload, "bin"), { recursive: true })
  mkdirSync(join(payload, "share", "stack"), { recursive: true })

  writeFileSync(join(payload, "bin", "stack"), `#!/bin/sh\nprintf '%s\\n' '${version}'\n`)
  writeFileSync(join(payload, "bin", "stackd"), `#!/bin/sh\nprintf '%s\\n' 'stackd ${version}'\n`)
  spawnSync("chmod", ["755", join(payload, "bin", "stack"), join(payload, "bin", "stackd")], { stdio: "inherit" })
  writeFileSync(join(payload, "share", "stack", "VERSION"), `${version}\n`)
  writeFileSync(join(payload, "share", "stack", "LICENSE"), "installer smoke fixture\n")
  writeFileSync(join(payload, "share", "stack", "NOTICE"), "installer smoke fixture\n")

  const archive = join(root, `stack-${version}-${target}.tar.gz`)
  const tar = spawnSync("tar", ["-czf", archive, "-C", payload, "."], { cwd: appRoot, encoding: "utf8" })
  if (tar.status !== 0) fail(`tar failed for ${version}`, tar)

  const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex")
  const manifest = join(root, "manifest.json")
  writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        schema_version: 1,
        channel: "nightly",
        version,
        released_at: new Date().toISOString(),
        yanked: false,
        targets: {
          [target]: {
            url: archive,
            sha256,
            size: readFileSync(archive).byteLength,
          },
        },
        notes_url: "https://docs.usesynth.ai/stack/changelog",
      },
      null,
      2,
    )}\n`,
  )
  return { version, archive, sha256, manifest }
}

function runInstaller(manifest: string): void {
  const result = spawnSync(
    "sh",
    [installer, "--channel", "nightly", "--manifest", manifest, "--install-dir", installDir, "--bin-dir", binDir],
    { cwd: appRoot, encoding: "utf8" },
  )
  if (result.status !== 0) fail(`install failed for ${manifest}`, result)
  if (!result.stdout.includes("stack_installer_ok")) throw new Error(`install output missing stack_installer_ok for ${manifest}`)
}

function assertStackVersion(expected: string, context: string): void {
  const result = spawnSync(join(binDir, "stack"), [], { cwd: appRoot, encoding: "utf8" })
  if (result.status !== 0) fail(`stack invocation failed ${context}`, result)
  const actual = result.stdout.trim()
  if (actual !== expected) throw new Error(`${context}: expected ${expected}, got ${actual}`)
}

function currentTargetTriple(): string {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  if (process.platform === "darwin") return `${arch}-apple-darwin`
  if (process.platform === "linux") return `${arch}-unknown-linux-musl`
  return `${arch}-${process.platform}`
}

function fail(message: string, result: ReturnType<typeof spawnSync>): never {
  console.error(message)
  console.error(result.stdout)
  console.error(result.stderr)
  process.exit(result.status ?? 1)
}
