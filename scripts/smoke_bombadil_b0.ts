#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { findTuiCrashArtifacts, primaryCrashFailureClass } from "./tui_crash_guard.ts"
import { stackChannel, stackVersion } from "../src/version.ts"

const stackRoot = join(import.meta.dir, "..")
const evidenceId = process.env.STACK_EVIDENCE_ID ?? compactTimestamp(new Date())
const defaultProofPath = join(stackRoot, ".stack", "evidence", "bombadil-b0", evidenceId, "proof.json")
const proofPath = process.env.STACK_BOMBADIL_B0_PROOF ?? defaultProofPath
const rawProofPath = process.env.STACK_BOMBADIL_PROOF ?? "/tmp/stack-bombadil-b0-proof.json"

const startedAt = new Date().toISOString()
const proc = Bun.spawn(["bun", "run", "scripts/smoke_bombadil_tui_b0.ts"], {
  cwd: stackRoot,
  env: {
    ...process.env,
    STACK_BOMBADIL_PROOF: rawProofPath,
  },
  stdout: "pipe",
  stderr: "pipe",
})

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])

const rawProof = await readJson(rawProofPath)
const scenarioResults = readScenarioResults(rawProof)
const ok = exitCode === 0 && rawProof?.ok === true
const proof = {
  check_id: "AT-STACK-BOMBADIL-B0",
  gate_class: "B0",
  status: ok ? "pass" : "fail",
  stack_version: stackVersion(stackRoot),
  stack_channel: stackChannel(stackRoot),
  scenarios: scenarioResults,
  proof_path: proofPath,
  generated_at: new Date().toISOString(),
  started_at: startedAt,
  exit_code: exitCode,
  failure_class: ok ? null : classifyFailure(exitCode, rawProof, stdout, stderr),
  stdout_tail: tail(stdout),
  stderr_tail: tail(stderr),
}

await mkdir(dirname(proofPath), { recursive: true })
await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`)

if (!ok) {
  console.error(`stack_bombadil_b0_failed proof=${proofPath}`)
  process.exit(exitCode === 0 ? 1 : exitCode)
}

console.log(`stack_bombadil_b0_ok proof=${proofPath}`)

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function readScenarioResults(rawProofValue: Record<string, unknown> | undefined) {
  const scenarios = rawProofValue?.scenarios
  if (!Array.isArray(scenarios)) {
    return [
      {
        name: "b0_aggregate",
        status: rawProofValue?.ok === true ? "pass" : "fail",
        proof_path: rawProofPath,
      },
    ]
  }
  return scenarios.map((entry) => {
    const record = entry as Record<string, unknown>
    return {
      name: typeof record.name === "string" ? record.name : "unknown",
      status: record.ok === true ? "pass" : "fail",
      proof_path: rawProofPath,
      message: typeof record.message === "string" ? record.message : undefined,
      tui_crash: record.tuiCrash === true,
      mouse_leak: record.mouseLeak === true,
      memory_crash: record.memoryCrash === true,
      process_crash: record.processCrash === true,
      crash_artifacts: Array.isArray(record.crashArtifacts) ? record.crashArtifacts : undefined,
    }
  })
}

function classifyFailure(
  exitCodeValue: number,
  rawProofValue: Record<string, unknown> | undefined,
  stdoutValue: string,
  stderrValue: string,
): string {
  const combined = `${stdoutValue}\n${stderrValue}\n${JSON.stringify(rawProofValue ?? {})}`
  const artifacts = findTuiCrashArtifacts(combined)
  if (artifacts.length > 0) return primaryCrashFailureClass(artifacts)
  if (combined.includes("stack_tui_crash_artifact:")) return "tui_crash"
  if (combined.includes("STACK_B0_FOCUS_FAIL") || combined.includes("stack_tui_focus_smoke_failed")) {
    return "focus_remount_crash"
  }
  if (
    combined.includes("STACK_B0_CRASH_CLEANUP_FAIL") ||
    combined.includes("stack_tui_crash_cleanup_smoke_failed")
  ) {
    return "crash_cleanup_leak"
  }
  if (combined.includes("STACK_TUI_SCROLL_FAIL")) return "layout_overlap"
  if (combined.includes("Timed out")) return "timeout"
  if (combined.includes("Bombadil B0 bridge did not become healthy")) return "terminal_control_flake"
  if (exitCodeValue !== 0) return "terminal_control_flake"
  return "unknown"
}

function tail(value: string): string {
  return value.split("\n").slice(-40).join("\n")
}

function compactTimestamp(value: Date): string {
  return value.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z")
}
