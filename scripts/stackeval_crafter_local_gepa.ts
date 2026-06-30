#!/usr/bin/env bun

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { stackChannel, stackVersion } from "../src/version.ts"

const taskId = "crafter-local-gepa"
const args = new Set(process.argv.slice(2))
const shouldLaunch = !args.has("--prepare-only")
const defaultModel = process.env.STACKEVAL_MODEL ?? "gpt-5.5-low"
const resolvedCodex = resolveCodexProfile(defaultModel)
const stackRoot = join(import.meta.dir, "..")
const workspaceRoot = resolve(stackRoot, "..")
const jstackRoot = process.env.JSTACK_ROOT ?? join(workspaceRoot, "Jstack")
const taskPath = join(jstackRoot, ".jstack/product/stackeval/tasks/crafter-local-gepa.md")
const traceRoot =
  process.env.STACKEVAL_TRACE_ROOT ?? join(jstackRoot, ".jstack/evidence/stackeval")
const stamp = process.env.STACKEVAL_STAMP ?? timestamp()
const taskTraceRoot = join(traceRoot, taskId)
const packetDir = join(taskTraceRoot, stamp)

if (!existsSync(taskPath)) {
  console.error(`StackEval task file missing: ${taskPath}`)
  process.exit(1)
}

const taskDoc = await readFile(taskPath, "utf8")
const prompt = buildInitialPrompt(extractStartingPrompt(taskDoc))

await Promise.all([
  mkdir(taskTraceRoot, { recursive: true }),
  mkdir(join(packetDir, "stack-session"), { recursive: true }),
  mkdir(join(packetDir, "codex"), { recursive: true }),
  mkdir(join(packetDir, "artifacts"), { recursive: true }),
])

const stackCommit = gitRev(stackRoot)
const jstackCommit = gitRev(jstackRoot)
const cookbooksCommit = gitRev(join(workspaceRoot, "synth-cookbooks-public"))
const synthApiKeyPresent = hasEnvOrFileVar("SYNTH_API_KEY", join(workspaceRoot, "synth-ai/.env"))
const geminiKeyPresent = hasEnvOrFileVar("GEMINI_API_KEY", join(workspaceRoot, "synth-ai/.env"))
const openAiKeyPresent = hasEnvOrFileVar("OPENAI_API_KEY", join(workspaceRoot, "synth-ai/.env"))
const initialPromptPath = join(packetDir, "initial_prompt.txt")
const launchScriptPath = join(packetDir, "launch_stack.sh")

await writeFile(initialPromptPath, prompt)
await writeFile(
  launchScriptPath,
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `cd "${stackRoot}"`,
    `export STACK_CODEX_MODEL="${defaultModel}"`,
    `export STACK_INITIAL_PROMPT_FILE="${initialPromptPath}"`,
    'export STACK_AUTOSUBMIT="${STACK_AUTOSUBMIT:-1}"',
    'exec ./bin/stack "$@"',
    "",
  ].join("\n"),
)
await chmod(launchScriptPath, 0o755)
await writeFile(
  join(packetDir, "metadata.json"),
  `${JSON.stringify(
    {
      task_id: taskId,
      created_at: new Date().toISOString(),
      status: "ready_for_operator",
      default_model: defaultModel,
      resolved_codex_model: resolvedCodex.model,
      resolved_codex_reasoning_effort: resolvedCodex.reasoningEffort,
      policy_model: "gemini-3.1-flash-lite",
      stack_version: stackVersion(stackRoot),
      stack_channel: stackChannel(stackRoot),
      stack_commit: stackCommit,
      jstack_commit: jstackCommit,
      cookbooks_commit: cookbooksCommit,
      packet_dir: packetDir,
      task_file: taskPath,
      auth_presence: {
        synth_api_key: synthApiKeyPresent,
        gemini_api_key: geminiKeyPresent,
        openai_api_key: openAiKeyPresent,
      },
      pickup: {
        command: launchScriptPath,
        expected_stack_chips: {
          model: resolvedCodex.model,
          effort: resolvedCodex.reasoningEffort,
        },
        prompt_file: initialPromptPath,
        auto_submit: true,
      },
    },
    null,
    2,
  )}\n`,
)
await writeFile(
  join(packetDir, "run.md"),
  [
    "# StackEval Run: Crafter Local GEPA",
    "",
    `**Task:** \`${taskId}\``,
    `**Packet:** \`${packetDir}\``,
    `**Policy model:** \`gemini-3.1-flash-lite\``,
    `**Default Stack model:** \`${defaultModel}\``,
    "**Status:** ready for operator",
    "",
    "## Harness-first path (recommended)",
    "",
    "```bash",
    "cd ~/Documents/GitHub/stack",
    "./bin/stackeval run crafter-local-gepa --preset smoke",
    "```",
    "",
    "## Operator Start (stack mode)",
    "",
    "1. Run `./launch_stack.sh` from this packet.",
    "2. Confirm Stack local optimizers panel can reach GEPA service if used.",
    "3. Stack auto-submits `initial_prompt.txt`; if autosubmit is disabled, press Enter.",
    "",
    "## Result",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| heldout_mean_reward | pending |",
    "| selected_react_system_prompt | pending |",
    "| gepa_run_id | pending |",
    "| result_manifest_path | pending |",
    "",
  ].join("\n"),
)
await writeFile(
  join(packetDir, "acceptance.md"),
  [
    "# Acceptance Checklist",
    "",
    "| Gate | Status | Evidence |",
    "| --- | --- | --- |",
    "| SE-CRF-1-HARNESS | pending | gepa_config.toml + harness.json |",
    "| SE-CRF-2-RUN | pending | GEPA terminal completed |",
    "| SE-CRF-3-SCORE | pending | heldout mean episode reward in harvest.json |",
    "| SE-CRF-4-ARTIFACTS | pending | result_manifest + candidate registry |",
    "| SE-CRF-5-TRACE | pending | stackd export when enabled |",
    "| SE-CRF-6-LEVERAGE | pending | grade.json + review.json |",
    "",
  ].join("\n"),
)
await writeFile(
  join(packetDir, "waste.md"),
  [
    "# Waste Ledger",
    "",
    "| Friction | Time lost | Evidence | Stack leverage that would help |",
    "| --- | --- | --- | --- |",
    "| pending | pending | pending | pending |",
    "",
  ].join("\n"),
)
await writeFile(
  join(taskTraceRoot, "latest.json"),
  `${JSON.stringify(
    {
      task_id: taskId,
      packet_dir: packetDir,
      stamp,
      policy_model: "gemini-3.1-flash-lite",
      default_model: defaultModel,
      status: "ready_for_operator",
      initial_prompt: initialPromptPath,
      launch_script: launchScriptPath,
      updated_at: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)

console.log(`stackeval_packet_ready ${packetDir}`)
console.log(`harness: ./bin/stackeval run ${taskId} --preset smoke`)
console.log(`launch: ${launchScriptPath}`)

if (shouldLaunch) {
  console.log("stackeval_launching_stack")
  const proc = Bun.spawn([launchScriptPath], {
    cwd: stackRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exit(await proc.exited)
}

function extractStartingPrompt(markdown: string): string {
  const match = markdown.match(/## Starting Prompt[\s\S]*?```text\n([\s\S]*?)\n```/)
  if (!match?.[1]) {
    throw new Error("Could not find fenced Starting Prompt in task file")
  }
  return `${match[1].trim()}\n`
}

function buildInitialPrompt(startingPrompt: string): string {
  return [
    startingPrompt.trim(),
    "",
    "Acceptance criteria for this StackEval run:",
    "",
    "- SE-CRF-1-HARNESS: rendered gepa_config.toml + harness.json exist.",
    "- SE-CRF-2-RUN: local GEPA reaches terminal completed status.",
    "- SE-CRF-3-SCORE: heldout mean episode reward recorded.",
    "- SE-CRF-4-ARTIFACTS: result_manifest + candidate registry saved.",
    "- SE-CRF-5-TRACE: stackd export when stack mode enabled.",
    "- SE-CRF-6-LEVERAGE: grade + review capture operator leverage.",
    "",
  ].join("\n")
}

function gitRev(repoPath: string): string | null {
  if (!existsSync(repoPath)) return null
  const proc = Bun.spawnSync(["git", "-C", repoPath, "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  if (proc.exitCode !== 0) return null
  return proc.stdout.toString().trim()
}

function hasEnvOrFileVar(name: string, envPath: string): boolean {
  if (process.env[name]?.trim()) return true
  if (!existsSync(envPath)) return false
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escapedName}=.+$`, "m").test(readFileSync(envPath, "utf8"))
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function resolveCodexProfile(profile: string): { model: string; reasoningEffort: string } {
  for (const effort of ["low", "medium", "high", "xhigh"]) {
    const suffix = `-${effort}`
    if (profile.endsWith(suffix)) {
      return { model: profile.slice(0, -suffix.length), reasoningEffort: effort }
    }
  }
  return { model: profile, reasoningEffort: process.env.STACK_CODEX_REASONING_EFFORT ?? "medium" }
}
