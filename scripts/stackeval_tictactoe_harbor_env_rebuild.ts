#!/usr/bin/env bun

import { chmod, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { stackChannel, stackVersion } from "../src/version.ts"

const taskId = "tictactoe-harbor-env-rebuild"
const argv = process.argv.slice(2)
const args = new Set(argv)
const shouldLaunch = !args.has("--prepare-only") && !args.has("--verify-only")
const launchOnly = args.has("--launch-only")
const verifyOnly = args.has("--verify-only")
const forcePrepare = args.has("--force-prepare")
const defaultModel = process.env.STACKEVAL_MODEL ?? "gpt-5.4-mini-medium"
const resolvedCodex = resolveCodexProfile(defaultModel)

const stackRoot = join(import.meta.dir, "..")
const workspaceRoot = resolve(stackRoot, "..")
const jstackRoot = process.env.JSTACK_ROOT ?? join(workspaceRoot, "Jstack")
const gamebenchRoot = process.env.GAMEBENCH_ROOT ?? join(workspaceRoot, "gamebench")
const harborBundleRoot = join(
  gamebenchRoot,
  "adapters/harbor/bundles/tictactoe_singleplayer_gold",
)
const harborInstructionPath = join(harborBundleRoot, "instruction.md")
const harborSpecRoot = join(harborBundleRoot, "spec")
const verifyScript = join(stackRoot, "scripts/stackeval/tictactoe_harbor_verify.sh")

const taskPaths = [
  join(stackRoot, ".stack/stackeval/tasks/tictactoe-harbor-env-rebuild.md"),
  join(jstackRoot, ".jstack/product/stackeval/tasks/tictactoe-harbor-env-rebuild.md"),
]
const taskPath = taskPaths.find((path) => existsSync(path))

const traceRoot =
  process.env.STACKEVAL_TRACE_ROOT ?? join(stackRoot, ".stack/evidence/stackeval", taskId)
const stamp = process.env.STACKEVAL_STAMP ?? timestamp()
const packetDirArg = readFlagValue(argv, "--packet-dir")
const taskTraceRoot = join(traceRoot)
const packetDir = packetDirArg ? resolve(packetDirArg) : join(taskTraceRoot, stamp)

if (verifyOnly) {
  const target = packetDirArg ? resolve(packetDirArg) : packetDir
  if (!existsSync(target)) {
    console.error(`Packet missing for verify: ${target}`)
    process.exit(1)
  }
  await runVerify(target)
  process.exit(0)
}

const reusePacket =
  Boolean(packetDirArg) &&
  !forcePrepare &&
  existsSync(join(resolve(packetDirArg!), "launch_stack.sh"))
const activePacketDir = reusePacket ? resolve(packetDirArg!) : packetDir

if (launchOnly && !reusePacket) {
  console.error(`launch-only requires an existing packet with launch_stack.sh: ${packetDirArg ?? "(missing --packet-dir)"}`)
  process.exit(1)
}

if (!reusePacket) {
  for (const required of [harborInstructionPath, harborSpecRoot, verifyScript]) {
    if (!existsSync(required)) {
      console.error(`Required path missing: ${required}`)
      process.exit(1)
    }
  }

  const harborInstruction = await readFile(harborInstructionPath, "utf8")
  const prompt = buildInitialPrompt(harborInstruction, activePacketDir)
  await prepareWorkspace(activePacketDir, prompt)
}

if (shouldLaunch || launchOnly) {
  if (!existsSync(join(activePacketDir, "launch_stack.sh"))) {
    console.error(`Packet not ready: ${activePacketDir}`)
    process.exit(1)
  }
}

console.log(`stackeval_packet_ready ${activePacketDir}`)
console.log(`workspace=${join(activePacketDir, "workspace")}`)
console.log(`initial_prompt=${join(activePacketDir, "initial_prompt.txt")}`)
console.log(`launch_script=${join(activePacketDir, "launch_stack.sh")}`)
console.log(`verify_script=${join(activePacketDir, "verify.sh")}`)
console.log(`default_model=${defaultModel}`)
console.log(`resolved_codex=${resolvedCodex.model}/${resolvedCodex.reasoningEffort}`)

if (shouldLaunch || launchOnly) {
  console.log("stackeval_launching_stack")
  const proc = Bun.spawn([join(activePacketDir, "launch_stack.sh")], {
    cwd: stackRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode === 0) {
    console.log("stackeval_stack_exited_ok running_harbor_verify")
    await runVerify(activePacketDir)
  }
  process.exit(exitCode)
}

async function prepareWorkspace(targetPacketDir: string, initialPrompt: string): Promise<void> {
  const workspaceRootPath = join(targetPacketDir, "workspace")
  const specDir = join(workspaceRootPath, "spec")
  const candidateDir = join(workspaceRootPath, "candidate")
  const initialPromptPath = join(targetPacketDir, "initial_prompt.txt")
  const launchScriptPath = join(targetPacketDir, "launch_stack.sh")
  const packetVerifyScript = join(targetPacketDir, "verify.sh")

  await Promise.all([
    mkdir(taskTraceRoot, { recursive: true }),
    mkdir(join(targetPacketDir, "stack-session"), { recursive: true }),
    mkdir(join(targetPacketDir, "codex"), { recursive: true }),
    mkdir(join(targetPacketDir, "artifacts"), { recursive: true }),
    mkdir(join(targetPacketDir, "verifier"), { recursive: true }),
    mkdir(specDir, { recursive: true }),
    mkdir(join(candidateDir, "gold"), { recursive: true }),
    mkdir(join(candidateDir, "policies"), { recursive: true }),
    mkdir(join(candidateDir, "scripts"), { recursive: true }),
  ])

  await copySpecTree(harborSpecRoot, specDir)
  await writeFile(
    join(candidateDir, "README.txt"),
    [
      "Cleanroom Harbor candidate workspace.",
      "Implement gold/, policies/, and scripts/run_service.py here.",
      "Do not copy from GameBench reference lanes or Harbor verifier fixtures.",
      "",
    ].join("\n"),
  )

  const stackCommit = gitRev(stackRoot)
  const jstackCommit = gitRev(jstackRoot)
  const gamebenchCommit = gitRev(gamebenchRoot)
  const openAiKeyPresent = hasEnvOrFileVar("OPENAI_API_KEY", join(workspaceRoot, "synth-ai/.env"))

  await writeFile(initialPromptPath, initialPrompt)
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
    packetVerifyScript,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `exec "${verifyScript}" "${targetPacketDir}" "$@"`,
      "",
    ].join("\n"),
  )
  await chmod(packetVerifyScript, 0o755)

  await writeFile(
    join(targetPacketDir, "metadata.json"),
    `${JSON.stringify(
      {
        task_id: taskId,
        lane: "harbor-dev-tictactoe-singleplayer-gold",
        harbor_bundle: harborBundleRoot,
        created_at: new Date().toISOString(),
        status: "ready_for_operator",
        default_model: defaultModel,
        resolved_codex_model: resolvedCodex.model,
        resolved_codex_reasoning_effort: resolvedCodex.reasoningEffort,
        stack_version: stackVersion(stackRoot),
        stack_channel: stackChannel(stackRoot),
        stack_commit: stackCommit,
        jstack_commit: jstackCommit,
        gamebench_commit: gamebenchCommit,
        packet_dir: targetPacketDir,
        workspace: workspaceRootPath,
        spec_dir: specDir,
        candidate_dir: candidateDir,
        task_file: taskPath ?? null,
        forbidden_lanes: [
          "tictactoe_gamebench_code_policy_deo_hillclimb_1cand",
          "run_tictactoe_gamebench_hillclimb_task.py",
        ],
        auth_presence: {
          openai_api_key: openAiKeyPresent,
        },
        pickup: {
          command: launchScriptPath,
          verify_command: packetVerifyScript,
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
    join(targetPacketDir, "operator_pickup.md"),
    [
      "# Operator Pickup — TicTacToe Harbor env rebuild",
      "",
      "Harbor-native cleanroom task (not ReportBench policy hillclimb, not *_1cand SMR wrapper).",
      "",
      "Run Stack:",
      "",
      "```bash",
      launchScriptPath,
      "```",
      "",
      "After Stack finishes implementing the candidate tree, verify:",
      "",
      "```bash",
      packetVerifyScript,
      "```",
      "",
      "Workspace layout:",
      "",
      "```text",
      `${workspaceRootPath}/spec/       # normative specs (read-only inputs)`,
      `${workspaceRootPath}/candidate/  # deliverable: gold/, policies/, scripts/run_service.py`,
      "```",
      "",
      `Expected Stack controls: model \`${resolvedCodex.model}\`, effort \`${resolvedCodex.reasoningEffort}\`.`,
      "",
    ].join("\n"),
  )

  await writeFile(
    join(targetPacketDir, "acceptance.md"),
    [
      "# Acceptance Checklist",
      "",
      "| Gate | Status | Evidence |",
      "| --- | --- | --- |",
      "| SE-TTT-HARBOR-1-WORKSPACE | pending | candidate/gold + policies + scripts/run_service.py exist |",
      "| SE-TTT-HARBOR-2-SERVICE | pending | run_service.py starts on port 19081 |",
      "| SE-TTT-HARBOR-3-SPECTRUM | pending | spectrum_eval harbor_reward recorded in verifier/ |",
      "| SE-TTT-HARBOR-4-TRACE | pending | Stack session + Codex transcript preserved |",
      "| SE-TTT-HARBOR-5-LANE | pending | No hillclimb/policy-only artifacts |",
      "",
    ].join("\n"),
  )

  await writeFile(
    join(taskTraceRoot, "latest.json"),
    `${JSON.stringify(
      {
        task_id: taskId,
        packet_dir: targetPacketDir,
        stamp,
        default_model: defaultModel,
        resolved_codex_model: resolvedCodex.model,
        resolved_codex_reasoning_effort: resolvedCodex.reasoningEffort,
        status: "ready_for_operator",
        initial_prompt: initialPromptPath,
        launch_script: launchScriptPath,
        verify_script: packetVerifyScript,
        workspace: workspaceRootPath,
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
}

async function copySpecTree(source: string, destination: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true })
      await copySpecTree(from, to)
    } else if (entry.isFile()) {
      await cp(from, to)
    }
  }
}

function buildInitialPrompt(instruction: string, targetPacketDir: string): string {
  const workspaceRootPath = join(targetPacketDir, "workspace")
  const specDir = join(workspaceRootPath, "spec")
  const candidateDir = join(workspaceRootPath, "candidate")

  const adapted = instruction
    .replaceAll("/workspace/candidate", candidateDir)
    .replaceAll("/workspace/spec", specDir)
    .replaceAll("python /workspace/candidate/scripts/run_service.py", `python ${join(candidateDir, "scripts/run_service.py")}`)

  return [
    "StackEval task: tictactoe-harbor-env-rebuild",
    "",
    "You are rebuilding the Harbor-native Tic-Tac-Toe singleplayer gold environment from specs.",
    "This is ENV CODEGEN — not a policy hillclimb and not a single heuristic_policy.py file.",
    "",
    adapted.trim(),
    "",
    "## Stack workspace (absolute paths)",
    "",
    `- Spec inputs: \`${specDir}/\``,
    `- Deliverable root: \`${candidateDir}/\``,
    "",
    "Required deliverable layout:",
    "",
    "```text",
    `${candidateDir}/gold/`,
    `${candidateDir}/policies/`,
    `${candidateDir}/scripts/run_service.py`,
    "```",
    "",
    "## Forbidden for this run",
    "",
    "- `heuristic_policy.py`-only policy hillclimb lanes",
    "- `tictactoe_gamebench_code_policy_deo_hillclimb_*` or `run_tictactoe_gamebench_hillclimb_task.py`",
    "- Reading GameBench verifier fixtures or copying reference gold implementations",
    "",
    "## Finish criteria",
    "",
    "- Implement the full candidate tree under the deliverable root above.",
    `- \`python ${join(candidateDir, "scripts/run_service.py")}\` must start cleanly on port 19081.`,
    "- Operator will run Harbor spectrum verification (20 scenarios) after your session.",
    "- Update acceptance.md in the packet with artifact paths and any blockers.",
    "",
  ].join("\n")
}

async function runVerify(targetPacketDir: string): Promise<void> {
  const proc = Bun.spawn([verifyScript, targetPacketDir], {
    cwd: stackRoot,
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}

function readFlagValue(values: string[], flag: string): string | null {
  const index = values.indexOf(flag)
  if (index === -1) return null
  return values[index + 1] ?? null
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
