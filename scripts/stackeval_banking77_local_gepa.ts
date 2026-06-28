#!/usr/bin/env bun

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { stackChannel, stackVersion } from "../src/version.ts"

const taskId = "banking77-local-gepa"
const args = new Set(process.argv.slice(2))
const shouldLaunch = !args.has("--prepare-only")
const defaultModel = process.env.STACKEVAL_MODEL ?? "gpt-5.5-low"
const resolvedCodex = resolveCodexProfile(defaultModel)
const stackRoot = join(import.meta.dir, "..")
const workspaceRoot = resolve(stackRoot, "..")
const jstackRoot = process.env.JSTACK_ROOT ?? join(workspaceRoot, "Jstack")
const taskPath = join(jstackRoot, ".jstack/product/stackeval/tasks/banking77-local-gepa.md")
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
const evalsCommit = gitRev(join(workspaceRoot, "evals"))
const synthApiKeyPresent = hasEnvOrFileVar("SYNTH_API_KEY", join(workspaceRoot, "synth-ai/.env"))
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
      stack_version: stackVersion(stackRoot),
      stack_channel: stackChannel(stackRoot),
      stack_commit: stackCommit,
      jstack_commit: jstackCommit,
      evals_commit: evalsCommit,
      packet_dir: packetDir,
      task_file: taskPath,
      auth_presence: {
        synth_api_key: synthApiKeyPresent,
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
    "# StackEval Run: Banking77 Local GEPA",
    "",
    `**Task:** \`${taskId}\``,
    `**Packet:** \`${packetDir}\``,
    `**Default model:** \`${defaultModel}\``,
    `**Expected Stack chips:** model \`${resolvedCodex.model}\`, effort \`${resolvedCodex.reasoningEffort}\``,
    "**Status:** ready for operator",
    "",
    "## Operator Start",
    "",
    "1. Run `./launch_stack.sh` from this packet.",
    "2. Confirm Stack shows the expected model and effort controls.",
    "3. Stack auto-submits `initial_prompt.txt`; if autosubmit is disabled, press Enter.",
    "4. Preserve Stack session JSON, Codex transcript pointers, and result artifacts into this packet.",
    "",
    "## Commands / Evidence",
    "",
    "| Time | Command or action | Result | Artifact |",
    "| --- | --- | --- | --- |",
    "| pending | pending | pending | pending |",
    "",
    "## Result",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| final_score_percent | pending |",
    "| scorer / split | pending |",
    "| selected_model | pending |",
    "| selected_prompt_path | pending |",
    "| config_path | pending |",
    "| result_artifact_path | pending |",
    "",
  ].join("\n"),
)
await writeFile(
  join(packetDir, "operator_pickup.md"),
  [
    "# Operator Pickup",
    "",
    "Run:",
    "",
    "```bash",
    launchScriptPath,
    "```",
    "",
    "The launcher sets:",
    "",
    "```text",
    `STACK_CODEX_MODEL=${defaultModel}`,
    `STACK_INITIAL_PROMPT_FILE=${initialPromptPath}`,
    "STACK_AUTOSUBMIT=1",
    "```",
    "",
    "Seeded prompt:",
    "",
    "```text",
    initialPromptPath,
    "```",
    "",
    `Expected Stack controls: model \`${resolvedCodex.model}\`, effort \`${resolvedCodex.reasoningEffort}\`.`,
    "If Stack shows a different model or effort, stop the eval and fix Stack model resolution before continuing.",
    "",
    "After the session, copy relevant `.stack/sessions/*.json`, Codex transcript pointers, and result artifacts into this packet.",
    "",
  ].join("\n"),
)
await writeFile(
  join(packetDir, "preflight.json"),
  `${JSON.stringify(
    {
      stack_version: stackVersion(stackRoot),
      stack_channel: stackChannel(stackRoot),
      default_model: defaultModel,
      resolved_codex_model: resolvedCodex.model,
      resolved_codex_reasoning_effort: resolvedCodex.reasoningEffort,
      stack_commit: stackCommit,
      jstack_commit: jstackCommit,
      evals_commit: evalsCommit,
      synth_api_key_present: synthApiKeyPresent,
      openai_api_key_present: openAiKeyPresent,
      generated_at: new Date().toISOString(),
      launch_script: launchScriptPath,
      initial_prompt: initialPromptPath,
      autosubmit: true,
    },
    null,
    2,
  )}\n`,
)
await writeFile(
  join(packetDir, "model_policy.md"),
  [
    "# Model Policy",
    "",
    `Default model: \`${defaultModel}\``,
    "",
    "Record any override here with the reason, affected command, and scorer impact.",
    "",
    "| Override | Reason | Scope |",
    "| --- | --- | --- |",
    "| pending | pending | pending |",
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
    "| SE-B77-1-HARNESS | pending | Agent identifies the actual Banking77 harness/config used |",
    "| SE-B77-2-RUN | pending | Local GEPA or accepted local equivalent reaches terminal result |",
    "| SE-B77-3-SCORE | pending | Final heldout percentage is recorded with scorer source |",
    "| SE-B77-4-ARTIFACTS | pending | Selected prompt/model/config/result paths are saved |",
    "| SE-B77-5-TRACE | pending | Stack/Codex logs and operator prompts are preserved |",
    "| SE-B77-6-LEVERAGE | pending | `waste.md` names time lost and one Stack leverage feature |",
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
  join(packetDir, "release_guard.md"),
  [
    "# Release Guard",
    "",
    "Decide whether this run creates a Stack release guard.",
    "",
    "| Finding | Guard | Evidence |",
    "| --- | --- | --- |",
    "| pending | Bombadil B0/B1/B2, MCP/API check, docs gate, or not_applicable | pending |",
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
      default_model: defaultModel,
      resolved_codex_model: resolvedCodex.model,
      resolved_codex_reasoning_effort: resolvedCodex.reasoningEffort,
      status: "ready_for_operator",
      initial_prompt: join(packetDir, "initial_prompt.txt"),
      launch_script: launchScriptPath,
      operator_pickup: join(packetDir, "operator_pickup.md"),
      updated_at: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)

console.log(`stackeval_packet_ready ${packetDir}`)
console.log(`initial_prompt=${initialPromptPath}`)
console.log(`launch_script=${launchScriptPath}`)
console.log(`operator_pickup=${join(packetDir, "operator_pickup.md")}`)
console.log(`default_model=${defaultModel}`)
console.log(`resolved_codex=${resolvedCodex.model}/${resolvedCodex.reasoningEffort}`)
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
    "- SE-B77-1-HARNESS: identify the actual Banking77 harness/config used.",
    "- SE-B77-2-RUN: local GEPA or accepted local equivalent reaches a terminal result.",
    "- SE-B77-3-SCORE: final heldout percentage is recorded with scorer source.",
    "- SE-B77-4-ARTIFACTS: selected prompt/model/config/result paths are saved.",
    "- SE-B77-5-TRACE: Stack/Codex logs and operator prompts are preserved.",
    "- SE-B77-6-LEVERAGE: waste.md names time lost and one Stack leverage feature.",
    "",
    "Write the final result back into the packet files where possible:",
    `- acceptance.md`,
    `- run.md`,
    `- waste.md`,
    `- release_guard.md`,
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
