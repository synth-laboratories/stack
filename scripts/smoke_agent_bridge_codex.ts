#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadConfig } from "../src/config.js"

const appRoot = resolve(import.meta.dir, "..")
const proofDir = process.env.STACK_AGENT_BRIDGE_PROOF_DIR ?? "/tmp/stack-agent-bridge-proof"
const finalPath = `${proofDir}/final.txt`
const stdoutPath = `${proofDir}/codex.jsonl`
const stderrPath = `${proofDir}/codex.stderr`
const timeoutMs = readPositiveInteger(process.env.STACK_AGENT_BRIDGE_TIMEOUT_MS, 180_000)

mkdirSync(proofDir, { recursive: true })

const config = await loadConfig(appRoot)
const args = codexArgsWithProofOutput(config.codexArgs, finalPath, config.workspaceRoot)
const prompt = [
  "Use $stack-agent-bridge.",
  "This is a read-only Stack Agent Bridge proof. Do not start README-smoke, do not send messages, do not cancel anything, do not upload files, and do not run shell commands.",
  "Use Stack MCP only. First call stack_status with mode remote. Then call stack_list_live_smrs. You may call stack_list_factories or stack_list_hosted_optimizer_runs if useful, but do not mutate live systems.",
  "In the final response, include these exact marker lines:",
  "STACK_AGENT_BRIDGE_PROOF_OK",
  "STACK_STATUS_TOOL=stack_status",
  "STACK_LIST_TOOL=stack_list_live_smrs",
  "STACK_MUTATION=none",
  "Also include the Stack environment, remote SMR status, run count, and auth presence/missing status. Do not print any raw secret value.",
].join("\n")

const proc = Bun.spawn([config.codexCommand, ...args], {
  cwd: config.workspaceRoot,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
})

proc.stdin.write(prompt)
proc.stdin.end()

let timedOut = false
const timeout = setTimeout(() => {
  timedOut = true
  proc.kill("SIGTERM")
}, timeoutMs)

const [stdout, stderr, exitCode] = await Promise.all([
  collectText(proc.stdout),
  collectText(proc.stderr),
  proc.exited,
])
clearTimeout(timeout)

writeFileSync(stdoutPath, stdout, "utf8")
writeFileSync(stderrPath, stderr, "utf8")

const final = existsSync(finalPath) ? readFileSync(finalPath, "utf8") : ""
const failures = [
  timedOut ? `codex timed out after ${timeoutMs}ms` : "",
  exitCode !== 0 ? `codex exited ${exitCode}` : "",
  !final.includes("STACK_AGENT_BRIDGE_PROOF_OK") ? "missing final proof marker" : "",
  !final.includes("STACK_STATUS_TOOL=stack_status") ? "missing stack_status final marker" : "",
  !final.includes("STACK_LIST_TOOL=stack_list_live_smrs") ? "missing stack_list_live_smrs final marker" : "",
  !final.includes("STACK_MUTATION=none") ? "missing no-mutation final marker" : "",
  !jsonlMentionsTool(stdout, "stack_status") ? "JSONL did not show stack_status usage" : "",
  !jsonlMentionsTool(stdout, "stack_list_live_smrs") ? "JSONL did not show stack_list_live_smrs usage" : "",
  containsSecret(final) || containsSecret(stdout) ? "output appears to contain a secret-like value" : "",
].filter((failure) => failure.length > 0)

if (failures.length > 0) {
  console.error(`stack_agent_bridge_codex_smoke_failed: ${failures.join("; ")}`)
  console.error(`final: ${oneLine(final, 1000)}`)
  console.error(`stderr: ${oneLine(stderr, 1000)}`)
  process.exit(1)
}

console.log("stack_agent_bridge_codex_smoke_ok")
console.log(oneLine(final, 1200))

function codexArgsWithProofOutput(codexArgs: string[], outputPath: string, workspaceRoot: string): string[] {
  const args = [...codexArgs]
  const execIndex = args.indexOf("exec")
  if (execIndex >= 0) args.splice(execIndex + 1, 0, "--ephemeral")
  else args.unshift("exec", "--ephemeral")
  args.push("-o", outputPath, "-C", workspaceRoot, "-")
  return args
}

async function collectText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

function jsonlMentionsTool(text: string, toolName: string): boolean {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .some((line) => {
      try {
        return jsonValueMentionsTool(JSON.parse(line) as unknown, toolName)
      } catch {
        return false
      }
    })
}

function jsonValueMentionsTool(value: unknown, toolName: string): boolean {
  if (typeof value === "string") return value === toolName
  if (Array.isArray(value)) return value.some((item) => jsonValueMentionsTool(item, toolName))
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => {
      return key === "name" && item === toolName ? true : jsonValueMentionsTool(item, toolName)
    })
  }
  return false
}

function containsSecret(text: string): boolean {
  return /\bsk-[A-Za-z0-9_-]{20,}\b/.test(text) || /\b(?:synth|runpod)_[A-Za-z0-9_-]{20,}\b/i.test(text)
}

function oneLine(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
