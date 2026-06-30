#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type ReleaseArtifactSummary = {
  stamp: string
  ok: boolean
  publishable: boolean
  publish_blockers: string[]
  version: string
  channel: string
  target: string
  release_site: string
  release_site_install_sh: string
  release_site_channel_manifest: string
  release_site_version_manifest: string
  release_site_archive: string
}

const appRoot = resolve(import.meta.dir, "..")
const stamp = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`
const proofDir = resolve(appRoot, ".stack", "evidence", "release-site-contract", stamp)
const installDir = join(proofDir, "install-dir")
const binDir = join(proofDir, "bin-dir")
const stackDataRoot = join(proofDir, "stack-data")
const sessionDir = join(stackDataRoot, ".stack", "sessions")
mkdirSync(proofDir, { recursive: true })
mkdirSync(sessionDir, { recursive: true })

const packaged = run(["bun", "run", "scripts/package_release_artifact.ts"], undefined, appRoot)
const summary = parseSummary(packaged.stdout)
const failures: string[] = []

for (const path of [
  summary.release_site,
  summary.release_site_install_sh,
  summary.release_site_channel_manifest,
  summary.release_site_version_manifest,
  summary.release_site_archive,
]) {
  if (!path || !existsSync(path)) failures.push(`missing release-site path ${path}`)
}

const manifest = JSON.parse(readFileSync(summary.release_site_channel_manifest, "utf8")) as {
  schema_version?: number
  channel?: string
  version?: string
  targets?: Record<string, { url?: string; sha256?: string; size?: number }>
}
const target = manifest.targets?.[summary.target]
if (manifest.schema_version !== 1) failures.push("release-site manifest schema must be 1")
if (manifest.channel !== summary.channel) failures.push("release-site manifest channel mismatch")
if (manifest.version !== summary.version) failures.push("release-site manifest version mismatch")
if (!target?.url || !existsSync(target.url)) failures.push("release-site manifest artifact url is not locally installable")
if (!/^[a-f0-9]{64}$/.test(target?.sha256 ?? "")) failures.push("release-site manifest sha256 is invalid")
if (!target?.size || target.size <= 0) failures.push("release-site manifest size is invalid")

const installed = run([
  "sh",
  summary.release_site_install_sh,
  "--channel",
  summary.channel,
  "--manifest",
  summary.release_site_channel_manifest,
  "--install-dir",
  installDir,
  "--bin-dir",
  binDir,
])
if (!installed.stdout.includes("stack_installer_ok")) failures.push("release-site installer did not finish")

const version = run([join(binDir, "stack"), "--version"])
if (!version.stdout.includes(summary.version)) failures.push("installed stack version output mismatch")

const installedEnv = isolatedStackEnv()
const doctor = run([join(binDir, "stack"), "doctor", "--json"], installedEnv)
const doctorReport = parseJson<{
  stack_version?: string
  local_ready?: boolean
  synth_sign_in_optional?: boolean
  checks?: Array<{ id?: string; level?: string }>
}>(doctor.stdout, "installed doctor")
if (doctorReport.stack_version !== summary.version) failures.push("installed doctor version mismatch")
if (doctorReport.local_ready !== true) failures.push("installed doctor local_ready must be true")
if (doctorReport.synth_sign_in_optional !== true) failures.push("installed doctor must keep Synth sign-in optional")
if (!doctorReport.checks?.some((check) => check.id === "local-mode" && check.level === "pass")) {
  failures.push("installed doctor must report local-mode pass")
}

const demo = run([join(binDir, "stack"), "demo", "--json"], installedEnv)
const demoResult = parseJson<{
  receipt?: {
    run_id?: string
    mode?: string
    status?: string
    privacy_class?: string
    work_product?: string
    trace?: string
    artifact?: string
  }
  receipt_path?: string
}>(demo.stdout, "installed demo")
if (!demoResult.receipt_path || !existsSync(demoResult.receipt_path)) failures.push("installed demo receipt_path must exist")
if (demoResult.receipt_path && !resolve(demoResult.receipt_path).startsWith(resolve(stackDataRoot))) {
  failures.push("installed demo receipt must be isolated under proof stack data root")
}
if (demoResult.receipt?.mode !== "local") failures.push("installed demo receipt mode must be local")
if (demoResult.receipt?.status !== "passed") failures.push("installed demo receipt status must be passed")
if (demoResult.receipt?.privacy_class !== "local-only") failures.push("installed demo privacy_class must be local-only")
for (const key of ["work_product", "trace", "artifact"] as const) {
  const relativePath = demoResult.receipt?.[key]
  if (!relativePath || !existsSync(join(stackDataRoot, relativePath))) failures.push(`installed demo ${key} must exist`)
}

const update = run([
  join(binDir, "stack"),
  "update",
  "--check",
  "--channel",
  summary.channel,
  "--manifest",
  summary.release_site_channel_manifest,
  "--json",
], installedEnv)
const updateReport = parseJson<{
  status?: string
  current_version?: string
  latest_version?: string
  requested_channel?: string
  target?: string
  mutates?: boolean
}>(update.stdout, "installed update")
if (updateReport.current_version !== summary.version) failures.push("installed update current_version mismatch")
if (updateReport.latest_version !== summary.version) failures.push("installed update latest_version mismatch")
if (updateReport.requested_channel !== summary.channel) failures.push("installed update requested_channel mismatch")
if (updateReport.mutates !== false) failures.push("installed update --check must not mutate")
if (!new Set(["current", "available", "unsupported-target"]).has(updateReport.status ?? "")) {
  failures.push(`installed update returned unexpected status ${updateReport.status ?? "missing"}`)
}

const result = {
  stamp,
  ok: failures.length === 0,
  version: summary.version,
  channel: summary.channel,
  target: summary.target,
  publishable: summary.publishable,
  publish_blockers: summary.publish_blockers,
  release_site: summary.release_site,
  installer_output: installed.stdout.trim().split("\n"),
  version_output: version.stdout.trim().split("\n"),
  doctor: {
    stack_version: doctorReport.stack_version,
    local_ready: doctorReport.local_ready,
    synth_sign_in_optional: doctorReport.synth_sign_in_optional,
  },
  demo: {
    run_id: demoResult.receipt?.run_id,
    receipt_path: demoResult.receipt_path,
    status: demoResult.receipt?.status,
    privacy_class: demoResult.receipt?.privacy_class,
  },
  update: {
    status: updateReport.status,
    current_version: updateReport.current_version,
    latest_version: updateReport.latest_version,
    mutates: updateReport.mutates,
  },
}
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(result, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`release_site_contract_smoke_failed: ${failures.join("; ")}`)
  console.error(JSON.stringify(result, null, 2))
  process.exit(1)
}

console.log("release_site_contract_smoke_ok")
console.log(JSON.stringify({ proof_dir: proofDir, ...result }, null, 2))

function run(command: string[], env?: NodeJS.ProcessEnv, cwd = proofDir): { stdout: string; stderr: string } {
  const result = spawnSync(command[0], command.slice(1), { cwd, env, encoding: "utf8" })
  if (result.status !== 0) {
    console.error(`${command.join(" ")} failed`)
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(result.status ?? 1)
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

function parseSummary(stdout: string): ReleaseArtifactSummary {
  const start = stdout.indexOf("{")
  if (start < 0) throw new Error("release artifact summary JSON not found")
  return JSON.parse(stdout.slice(start)) as ReleaseArtifactSummary
}

function parseJson<T>(stdout: string, label: string): T {
  const start = stdout.indexOf("{")
  if (start < 0) throw new Error(`${label} JSON output not found`)
  return JSON.parse(stdout.slice(start)) as T
}

function isolatedStackEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/(TOKEN|SECRET|API_KEY|ACCESS_KEY|PASSWORD)/.test(key)) delete env[key]
  }
  env.STACK_ENVIRONMENT = "staging"
  env.STACK_SESSION_DIR = sessionDir
  env.STACK_VOICE_ENABLED = "0"
  env.STACK_TELEMETRY = "0"
  return env
}
