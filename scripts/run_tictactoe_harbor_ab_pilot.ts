#!/usr/bin/env bun

import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

type SegmentProvider = "codex" | "deepseek"

type Usage = {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
}

type PricingRow = {
  provider: SegmentProvider
  model: string
  input_per_million: number
  cached_input_per_million: number
  output_per_million: number
}

type SegmentResult = {
  name: string
  provider: SegmentProvider
  model: string
  effort: string
  started_at: string
  finished_at: string
  duration_sec: number
  returncode: number
  stdout_log: string
  stderr_log: string
  usage: Usage | null
  usage_source?: "stdout" | "codex_session"
  codex_session_log?: string
  route_decision?: RouteDecision
}

type ArmResult = {
  arm: string
  label: string
  replicate: number
  packet_dir: string
  work_packet_dir: string
  workspace: string
  handoff_count: number
  segments: SegmentResult[]
  started_at: string
  finished_at: string
  duration_sec: number
  verify: Record<string, unknown>
  agent_completed: boolean
  comparison_valid: boolean
  failed_segments: Array<{ name: string; model: string; effort: string; returncode: number }>
  usage: Usage
  cost_usd_estimate: number
  cost_usd_upper_bound: number
}

type ArmKind = "all" | "no_handoff" | "handoff" | "sidekick"

type RouteDecision = {
  stage: "parent" | "successor"
  effort: string
  rationale: string
  confidence?: string
  monitor_stdout_log: string
  monitor_stderr_log: string
  monitor_returncode: number
  monitor_duration_sec: number
  monitor_model: string
  monitor_usage: Usage | null
  raw_text: string
}

type MetricStats = {
  n: number
  mean: number | null
  stdev: number | null
  min: number | null
  max: number | null
}

const stackRoot = resolve(import.meta.dir, "..")
const workspaceRoot = resolve(stackRoot, "..")
const gamebenchRoot = process.env.GAMEBENCH_ROOT ?? join(workspaceRoot, "gamebench")
const harborBundleRoot = join(
  gamebenchRoot,
  "adapters/harbor/bundles/tictactoe_singleplayer_gold",
)
const harborInstructionPath = join(harborBundleRoot, "instruction.md")
const harborSpecRoot = join(harborBundleRoot, "spec")
const verifyScript = join(stackRoot, "scripts/stackeval/tictactoe_harbor_verify.sh")
const stamp = process.env.STACK_AB_STAMP ?? timestamp()
const proofRoot = resolve(
  process.env.STACK_AB_ROOT ?? join(stackRoot, ".stack/evidence/stack-goal-first-ab", stamp),
)
const workRoot = resolve(process.env.STACK_AB_WORK_ROOT ?? join("/tmp", "stack-harbor-ab", stamp))
const defaultModel = process.env.STACK_AB_MODEL ?? "gpt-5.4-mini"
const noHandoffProvider = readSegmentProvider("STACK_AB_NO_HANDOFF_PROVIDER", "codex")
const handoffParentProvider = readSegmentProvider("STACK_AB_HANDOFF_PARENT_PROVIDER", "codex")
const handoffSuccessorProvider = readSegmentProvider("STACK_AB_HANDOFF_SUCCESSOR_PROVIDER", "codex")
const noHandoffModel = process.env.STACK_AB_NO_HANDOFF_MODEL ?? defaultModel
const handoffParentModel = process.env.STACK_AB_HANDOFF_PARENT_MODEL ?? defaultModel
const handoffSuccessorModel = process.env.STACK_AB_HANDOFF_SUCCESSOR_MODEL ?? defaultModel
const monitorRouterModel = process.env.STACK_AB_MONITOR_MODEL ?? defaultModel
const noHandoffEffort = process.env.STACK_AB_NO_HANDOFF_EFFORT ?? "medium"
const handoffParentEffort = process.env.STACK_AB_HANDOFF_PARENT_EFFORT ?? "low"
const handoffSuccessorEffort = process.env.STACK_AB_HANDOFF_SUCCESSOR_EFFORT ?? "high"
const handoffRouting = process.env.STACK_AB_HANDOFF_ROUTING ?? "fixed"
const armSelection = readArmSelection()
const segmentTimeoutSec = Number(process.env.STACK_AB_SEGMENT_TIMEOUT_SECONDS ?? "1500")
const replicatesPerArm = positiveIntegerFromEnv("STACK_AB_REPS", 1)
const parallelism = positiveIntegerFromEnv("STACK_AB_PARALLELISM", 1)
const monitorRouterTimeoutSec = Number(process.env.STACK_AB_MONITOR_ROUTER_TIMEOUT_SECONDS ?? "180")
const pricingRows: PricingRow[] = [
  { provider: "codex", model: "gpt-5.4-mini", input_per_million: 0.75, cached_input_per_million: 0.075, output_per_million: 4.5 },
  { provider: "codex", model: "gpt-5.5", input_per_million: 5.0, cached_input_per_million: 0.5, output_per_million: 30.0 },
  { provider: "codex", model: "gpt-5.4", input_per_million: 2.5, cached_input_per_million: 0.25, output_per_million: 15.0 },
  { provider: "codex", model: "gpt-5.3-codex", input_per_million: 1.75, cached_input_per_million: 0.175, output_per_million: 14.0 },
  { provider: "codex", model: "gpt-5-codex", input_per_million: 1.25, cached_input_per_million: 0.125, output_per_million: 10.0 },
  { provider: "deepseek", model: "deepseek-v4-pro", input_per_million: 0.435, cached_input_per_million: 0.003625, output_per_million: 0.87 },
  { provider: "deepseek", model: "deepseek-v4-flash", input_per_million: 0.14, cached_input_per_million: 0.0028, output_per_million: 0.28 },
]

const objective = "Rebuild TicTacToe Harbor env; pass 20-scenario spectrum (harbor_reward=1.0)"

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log([
    "Usage: bun run scripts/run_tictactoe_harbor_ab_pilot.ts",
    "",
    "Environment:",
    "  STACK_AB_STAMP",
    "  STACK_AB_ROOT",
    "  STACK_AB_MODEL",
    "  STACK_AB_NO_HANDOFF_PROVIDER=codex|deepseek",
    "  STACK_AB_HANDOFF_PARENT_PROVIDER=codex|deepseek",
    "  STACK_AB_HANDOFF_SUCCESSOR_PROVIDER=codex|deepseek",
    "  STACK_AB_NO_HANDOFF_MODEL",
    "  STACK_AB_HANDOFF_PARENT_MODEL",
    "  STACK_AB_HANDOFF_SUCCESSOR_MODEL",
    "  STACK_AB_MONITOR_MODEL",
    "  STACK_AB_NO_HANDOFF_EFFORT",
    "  STACK_AB_HANDOFF_PARENT_EFFORT",
    "  STACK_AB_HANDOFF_SUCCESSOR_EFFORT",
    "  STACK_AB_HANDOFF_ROUTING=fixed|monitor|sidekick",
    "  STACK_AB_ARMS=all|no_handoff|handoff|sidekick",
    "  STACK_AB_SEGMENT_TIMEOUT_SECONDS",
    "  STACK_AB_MONITOR_ROUTER_TIMEOUT_SECONDS",
    "  STACK_AB_REPS",
    "  STACK_AB_PARALLELISM",
    "",
  ].join("\n"))
  process.exit(0)
}

for (const required of [harborInstructionPath, harborSpecRoot, verifyScript]) {
  if (!existsSync(required)) {
    console.error(`Required path missing: ${required}`)
    process.exit(1)
  }
}

await mkdir(proofRoot, { recursive: true })
await mkdir(workRoot, { recursive: true })

logProgress("batch.started", {
  proof_root: proofRoot,
  work_root: workRoot,
  replicates_per_arm: replicatesPerArm,
  parallelism,
  default_model: defaultModel,
  no_handoff_provider: noHandoffProvider,
  no_handoff_model: noHandoffModel,
  handoff_parent_provider: handoffParentProvider,
  handoff_parent_model: handoffParentModel,
  handoff_successor_provider: handoffSuccessorProvider,
  handoff_successor_model: handoffSuccessorModel,
  monitor_model: monitorRouterModel,
  no_handoff_effort: noHandoffEffort,
  handoff_parent_effort: handoffParentEffort,
  handoff_successor_effort: handoffSuccessorEffort,
  handoff_routing: handoffRouting,
  arms: armSelection,
})
const arms = await runInParallel(buildArmJobs(), parallelism)
const assertions = {
  stamp,
  task: "tictactoe-harbor-env-rebuild",
  benchmark: "Harbor tictactoe_singleplayer_gold",
  objective,
  note: handoffRouting === "sidekick"
    ? "Replicated comparison with a monitor-as-sidekick artifact. Arm B keeps one primary worker thread and injects independent sidekick guidance; it does not transfer ownership through handoff."
    : handoffRouting === "monitor"
    ? "Replicated comparison with monitor-routed handoff effort decisions. The harness asks a monitor router to choose each handoff segment effort and records the decision."
    : "Replicated A/B comparison. Arm B is an explicit typed two-segment handoff, not monitor auto-preempt; current monitor preempt path is observe_only.",
  work_root: workRoot,
  design: {
    replicates_per_arm: replicatesPerArm,
    parallelism,
    arm_selection: armSelection,
    handoff_routing: handoffRouting,
    arms: [
      {
        arm: "A",
        label: "no_handoff",
        handoff_count: 0,
        provider: noHandoffProvider,
        model: noHandoffModel,
        effort: noHandoffEffort,
      },
      {
        arm: "B",
        label: handoffArmLabel(),
        handoff_count: handoffRouting === "sidekick" ? 0 : 1,
        parent_provider: handoffParentProvider,
        parent_model: handoffParentModel,
        parent_effort: handoffParentEffort,
        successor_provider: handoffSuccessorProvider,
        successor_model: handoffSuccessorModel,
        successor_effort: handoffSuccessorEffort,
        routing: handoffRouting,
      },
    ],
  },
  pricing: {
    rows: pricingRows,
    source: "Stack local pricing table",
  },
  summary: summarizeArms(arms),
  arms,
}
await writeFile(join(proofRoot, "assertions.json"), `${JSON.stringify(assertions, null, 2)}\n`)
await writeFile(
  join(proofRoot, "README.md"),
  [
    "# Stack Goal-First Harbor A/B Pilot",
    "",
    `TicTacToe Harbor env-rebuild comparison with ${replicatesPerArm} replicate(s) per arm.`,
    "",
    `- Arm A: no handoff, one continuous \`${noHandoffProvider}:${noHandoffModel}/${noHandoffEffort}\` thread.`,
    handoffRouting === "sidekick"
      ? `- Arm B: monitor-as-sidekick; sidekick \`${handoffSuccessorProvider}:${handoffSuccessorModel}/${handoffSuccessorEffort}\` writes guidance, primary \`${handoffParentProvider}:${handoffParentModel}/${handoffParentEffort}\` owns implementation.`
      : handoffRouting === "monitor"
      ? "- Arm B: monitor-routed handoff; effort choices are in each segment `route_decision`."
      : `- Arm B: explicit typed handoff, parent \`${handoffParentProvider}:${handoffParentModel}/${handoffParentEffort}\`, successor \`${handoffSuccessorProvider}:${handoffSuccessorModel}/${handoffSuccessorEffort}\`.`,
    `- Parallelism: ${parallelism}`,
    "",
    handoffRouting === "sidekick"
      ? "This does not prove full Devin Fusion parity; it tests a sidekick guidance artifact without ownership transfer."
      : "This does not prove monitor auto-preempt because current monitor preempt events are observe-only.",
    "",
  ].join("\n"),
)

console.log(`stack_goal_first_ab_pilot_complete ${proofRoot}`)
console.log(JSON.stringify(assertions, null, 2))

function buildArmJobs(): Array<() => Promise<ArmResult>> {
  const jobs: Array<() => Promise<ArmResult>> = []
  for (let replicate = 1; replicate <= replicatesPerArm; replicate += 1) {
    if (armSelection === "all" || armSelection === "no_handoff") {
      jobs.push(() => runNoHandoffArm(replicate))
    }
    if (armSelection === "all" || armSelection === "handoff" || armSelection === "sidekick") {
      jobs.push(() => handoffRouting === "sidekick" ? runSidekickArm(replicate) : runHandoffArm(replicate))
    }
  }
  return jobs
}

async function runNoHandoffArm(replicate: number): Promise<ArmResult> {
  logProgress("arm.started", { arm: "A", label: "no_handoff", replicate })
  const packet = await prepareArm(`arm_no_handoff_rep${replicateLabel(replicate)}`)
  const started = new Date()
  const segment = await runAgentSegment({
    packet,
    name: "single_thread",
    provider: noHandoffProvider,
    model: noHandoffModel,
    effort: noHandoffEffort,
    prompt: `${packet.initialPrompt}\n\n## Arm instruction\n\nComplete the full implementation in this single continuous thread. Do not stop for handoff. When done, update acceptance.md with what was built and any known blockers.\n`,
  })
  const verify = await runVerify(packet.packetDir)
  await mirrorPacketToProof(packet)
  const finished = new Date()
  const result = armResult({
    arm: "A",
    label: "no_handoff",
    replicate,
    packet,
    handoffCount: 0,
    segments: [segment],
    started,
    finished,
    verify,
  })
  logProgress("arm.completed", {
    arm: result.arm,
    label: result.label,
    replicate,
    duration_sec: result.duration_sec,
    harbor_reward: result.verify.harbor_reward ?? null,
    cost_usd_estimate: result.cost_usd_estimate,
    cost_usd_upper_bound: result.cost_usd_upper_bound,
  })
  return result
}

async function runHandoffArm(replicate: number): Promise<ArmResult> {
  const label = handoffArmLabel()
  logProgress("arm.started", { arm: "B", label, replicate })
  const packet = await prepareArm(`arm_handoff_${handoffRouting}_rep${replicateLabel(replicate)}`)
  const started = new Date()
  const parentRoute = await routeHandoffEffort({
    packet,
    stage: "parent",
    replicate,
    currentEffort: null,
    parentSegment: null,
    handoffBody: null,
  })
  const parent = await runAgentSegment({
    packet,
    name: "parent_segment",
    provider: handoffParentProvider,
    model: handoffParentModel,
    effort: parentRoute.effort,
    routeDecision: parentRoute,
    prompt: `${packet.initialPrompt}\n\n## Arm instruction\n\nYou are the parent Stack thread in a typed handoff run. This segment is running as \`${handoffParentModel}/${parentRoute.effort}\`. Routing rationale: ${parentRoute.rationale}\n\nBuild the first coherent slice of the env rebuild: package layout, core state/engine, and any HTTP surface you can finish. Before stopping, write ${join(packet.candidateDir, "HANDOFF.md")} with sections: Done, Remaining, Files changed, Verification attempted, and Suggested successor focus. Stop after writing that handoff artifact; do not try to finish the entire task in this segment.\n`,
  })
  const handoffPath = join(packet.candidateDir, "HANDOFF.md")
  const handoffBody = existsSync(handoffPath)
    ? await readFile(handoffPath, "utf8")
    : "Parent segment did not write candidate/HANDOFF.md. Successor must inspect the candidate tree and continue from current files."
  const typedHandoff = [
    "# Stack Handoff Artifact",
    "",
    `Objective: ${objective}`,
    "",
    "## Goal progress",
    "",
    "- [ ] candidate/scripts/run_service.py exists",
    "- [ ] 20-scenario Harbor spectrum passes",
    "",
    "## Parent notes",
    "",
    handoffBody.trim(),
    "",
  ].join("\n")
  await writeFile(join(packet.packetDir, "handoff-artifact.md"), typedHandoff)
  const successorRoute = await routeHandoffEffort({
    packet,
    stage: "successor",
    replicate,
    currentEffort: parent.effort,
    parentSegment: parent,
    handoffBody,
  })
  const successor = await runAgentSegment({
    packet,
    name: "successor_segment",
    provider: handoffSuccessorProvider,
    model: handoffSuccessorModel,
    effort: successorRoute.effort,
    routeDecision: successorRoute,
    prompt: [
      "You are the successor Stack thread continuing after a typed handoff.",
      `This successor segment is running as \`${handoffSuccessorModel}/${successorRoute.effort}\`. Routing rationale: ${successorRoute.rationale}`,
      "",
      typedHandoff,
      "",
      "Continue in the same candidate workspace. Finish the Harbor TicTacToe env rebuild as much as possible, run local smoke checks if useful, and update acceptance.md with final status and blockers. Do not use policy-hillclimb lanes or copy hidden verifier fixtures.",
      "",
      `Candidate root: ${packet.candidateDir}`,
      `Spec root: ${packet.specDir}`,
      "",
    ].join("\n"),
  })
  const verify = await runVerify(packet.packetDir)
  await mirrorPacketToProof(packet)
  const finished = new Date()
  const result = armResult({
    arm: "B",
    label,
    replicate,
    packet,
    handoffCount: 1,
    segments: [parent, successor],
    started,
    finished,
    verify,
  })
  logProgress("arm.completed", {
    arm: result.arm,
    label: result.label,
    replicate,
    duration_sec: result.duration_sec,
    harbor_reward: result.verify.harbor_reward ?? null,
    cost_usd_estimate: result.cost_usd_estimate,
    cost_usd_upper_bound: result.cost_usd_upper_bound,
  })
  return result
}

async function runSidekickArm(replicate: number): Promise<ArmResult> {
  const label = handoffArmLabel()
  logProgress("arm.started", { arm: "B", label, replicate })
  const packet = await prepareArm(`arm_sidekick_rep${replicateLabel(replicate)}`)
  const started = new Date()
  const sidekick = await runSidekickGuidanceSegment({
    packet,
    name: "monitor_sidekick",
    provider: handoffSuccessorProvider,
    model: handoffSuccessorModel,
    effort: handoffSuccessorEffort,
    replicate,
  })
  const sidekickPath = join(packet.packetDir, "monitor-sidekick.md")
  const sidekickBody = existsSync(sidekickPath)
    ? await readFile(sidekickPath, "utf8")
    : "Sidekick guidance unavailable; proceed from the task spec and keep the implementation minimal and verifiable."
  const primary = await runAgentSegment({
    packet,
    name: "primary_with_sidekick",
    provider: handoffParentProvider,
    model: handoffParentModel,
    effort: handoffParentEffort,
    prompt: [
      packet.initialPrompt,
      "",
      "## Arm instruction",
      "",
      "You are the primary Stack worker. A monitor-sidekick has already inspected the task independently and wrote guidance below.",
      "Use the sidekick notes as advisory context only: you own final decisions, implementation, and verification.",
      "Do not hand off. Complete the full implementation in this one primary thread.",
      "When done, update acceptance.md with what was built and any known blockers.",
      "",
      "## Monitor-sidekick guidance",
      "",
      sidekickBody,
      "",
    ].join("\n"),
  })
  const verify = await runVerify(packet.packetDir)
  await mirrorPacketToProof(packet)
  const finished = new Date()
  const result = armResult({
    arm: "B",
    label,
    replicate,
    packet,
    handoffCount: 0,
    segments: [sidekick, primary],
    started,
    finished,
    verify,
  })
  logProgress("arm.completed", {
    arm: result.arm,
    label: result.label,
    replicate,
    duration_sec: result.duration_sec,
    harbor_reward: result.verify.harbor_reward ?? null,
    cost_usd_estimate: result.cost_usd_estimate,
    cost_usd_upper_bound: result.cost_usd_upper_bound,
  })
  return result
}

async function prepareArm(name: string): Promise<{
  packetDir: string
  proofPacketDir: string
  workspaceDir: string
  specDir: string
  candidateDir: string
  initialPrompt: string
}> {
  const packetDir = join(workRoot, name)
  const proofPacketDir = join(proofRoot, name)
  const workspaceDir = join(packetDir, "workspace")
  const specDir = join(workspaceDir, "spec")
  const candidateDir = join(workspaceDir, "candidate")
  await mkdir(specDir, { recursive: true })
  await mkdir(join(candidateDir, "gold"), { recursive: true })
  await mkdir(join(candidateDir, "policies"), { recursive: true })
  await mkdir(join(candidateDir, "scripts"), { recursive: true })
  await mkdir(join(packetDir, "logs"), { recursive: true })
  await copySpecTree(harborSpecRoot, specDir)
  await writeFile(
    join(candidateDir, "README.txt"),
    "Cleanroom Harbor candidate workspace. Implement gold/, policies/, and scripts/run_service.py here.\n",
  )
  const instruction = await readFile(harborInstructionPath, "utf8")
  const initialPrompt = buildInitialPrompt(instruction, specDir, candidateDir)
  await writeFile(join(packetDir, "initial_prompt.txt"), initialPrompt)
  await writeFile(
    join(packetDir, "acceptance.md"),
    [
      "# Acceptance Checklist",
      "",
      "| Gate | Status | Evidence |",
      "| --- | --- | --- |",
      "| SE-TTT-HARBOR-1-WORKSPACE | pending | candidate/gold + policies + scripts/run_service.py exist |",
      "| SE-TTT-HARBOR-2-SERVICE | pending | run_service.py starts on port 19081 |",
      "| SE-TTT-HARBOR-3-SPECTRUM | pending | spectrum_eval harbor_reward recorded in verifier/ |",
      "| SE-TTT-HARBOR-4-TRACE | pending | Codex segment logs preserved |",
      "| SE-TTT-HARBOR-5-LANE | pending | No hillclimb / heuristic_policy-only artifacts |",
      "",
    ].join("\n"),
  )
  await writeFile(
    join(packetDir, "metadata.json"),
    `${JSON.stringify(
      {
        task_id: "tictactoe-harbor-env-rebuild",
        arm: name,
        created_at: new Date().toISOString(),
        default_model: defaultModel,
        no_handoff_provider: noHandoffProvider,
        no_handoff_model: noHandoffModel,
        handoff_parent_provider: handoffParentProvider,
        handoff_parent_model: handoffParentModel,
        handoff_successor_provider: handoffSuccessorProvider,
        handoff_successor_model: handoffSuccessorModel,
        workspace: workspaceDir,
        candidate_dir: candidateDir,
        spec_dir: specDir,
      },
      null,
      2,
    )}\n`,
  )
  return { packetDir, proofPacketDir, workspaceDir, specDir, candidateDir, initialPrompt }
}

function buildInitialPrompt(instruction: string, specDir: string, candidateDir: string): string {
  const adapted = instruction
    .replaceAll("/workspace/candidate", candidateDir)
    .replaceAll("/workspace/spec", specDir)
    .replaceAll("python /workspace/candidate/scripts/run_service.py", `python ${join(candidateDir, "scripts/run_service.py")}`)
  return [
    "StackEval task: tictactoe-harbor-env-rebuild",
    "",
    "You are rebuilding the Harbor-native Tic-Tac-Toe singleplayer gold environment from specs.",
    "This is ENV CODEGEN, not a policy hillclimb and not a single heuristic_policy.py file.",
    "",
    adapted.trim(),
    "",
    "## Stack workspace",
    "",
    `Spec root: ${specDir}`,
    `Candidate root: ${candidateDir}`,
    "Do not inspect any path outside this workspace. In particular, do not read prior StackEval evidence, prior candidates, GameBench fixtures, hidden tests, or reference implementations.",
    "",
    "Required deliverable layout:",
    "",
    `${candidateDir}/gold/`,
    `${candidateDir}/policies/`,
    `${candidateDir}/scripts/run_service.py`,
    "",
    "Forbidden lanes: heuristic_policy.py-only policy hillclimb, tictactoe_gamebench_code_policy_deo_hillclimb_*, hidden verifier fixtures.",
    "",
  ].join("\n")
}

async function routeHandoffEffort(input: {
  packet: { packetDir: string; workspaceDir: string }
  stage: "parent" | "successor"
  replicate: number
  currentEffort: string | null
  parentSegment: SegmentResult | null
  handoffBody: string | null
}): Promise<RouteDecision> {
  const logsDir = join(input.packet.packetDir, "logs", `monitor_route_${input.stage}`)
  await mkdir(logsDir, { recursive: true })
  const stdoutLog = join(logsDir, "codex_stdout.jsonl")
  const stderrLog = join(logsDir, "codex_stderr.log")

  if (handoffRouting !== "monitor") {
    const effort = input.stage === "parent" ? handoffParentEffort : handoffSuccessorEffort
    return {
      stage: input.stage,
      effort,
      rationale: "fixed harness configuration",
      confidence: "fixed",
      monitor_stdout_log: stdoutLog,
      monitor_stderr_log: stderrLog,
      monitor_returncode: 0,
      monitor_duration_sec: 0,
      monitor_model: monitorRouterModel,
      monitor_usage: null,
      raw_text: JSON.stringify({ effort, rationale: "fixed harness configuration" }),
    }
  }

  logProgress("monitor_route.started", {
    packet_dir: input.packet.packetDir,
    stage: input.stage,
    replicate: input.replicate,
  })
  const prompt = buildMonitorRoutePrompt(input)
  const started = new Date()
  const proc = Bun.spawn([
    "codex",
    "exec",
    "--sandbox",
    "workspace-write",
    "--cd",
    input.packet.workspaceDir,
    "--skip-git-repo-check",
    "--json",
    "--model",
    monitorRouterModel,
    "-c",
    "model_reasoning_effort=medium",
    "-c",
    'approval_policy="never"',
    "--",
    prompt,
  ], {
    cwd: input.packet.workspaceDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const killTimer = setTimeout(() => {
    proc.kill("SIGTERM")
  }, monitorRouterTimeoutSec * 1000)
  const [stdout, stderr, returncode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(killTimer)
  const finished = new Date()
  await writeFile(stdoutLog, stdout)
  await writeFile(stderrLog, stderr)
  const rawText = extractLastAgentMessage(stdout)
  const parsed = parseMonitorRouteJson(rawText)
  const usage = parseUsageFromText(stdout)
  const result: RouteDecision = {
    stage: input.stage,
    effort: parsed.effort,
    rationale: parsed.rationale,
    confidence: parsed.confidence,
    monitor_stdout_log: stdoutLog,
    monitor_stderr_log: stderrLog,
    monitor_returncode: returncode,
    monitor_duration_sec: secondsBetween(started, finished),
    monitor_model: monitorRouterModel,
    monitor_usage: usage,
    raw_text: rawText,
  }
  logProgress("monitor_route.completed", {
    packet_dir: input.packet.packetDir,
    stage: input.stage,
    replicate: input.replicate,
    effort: result.effort,
    confidence: result.confidence ?? null,
    duration_sec: result.monitor_duration_sec,
    returncode,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    rationale: result.rationale,
  })
  return result
}

function buildMonitorRoutePrompt(input: {
  stage: "parent" | "successor"
  replicate: number
  currentEffort: string | null
  parentSegment: SegmentResult | null
  handoffBody: string | null
}): string {
  return [
    "You are the Stack monitor routing a GameBench Harbor env-rebuild handoff.",
    "",
    "Choose the next worker reasoning effort ad hoc from the actual state. Do not follow a fixed low->high schedule.",
    "Allowed efforts: low, medium, high, xhigh.",
    "Optimize the cost/time/performance frontier, not raw performance alone.",
    "Use the replicate_id only as tie-break context; do not randomize unless the decision is otherwise tied.",
    "",
    "Return only JSON with exactly these fields:",
    "{\"effort\":\"low|medium|high|xhigh\",\"rationale\":\"short concrete reason\",\"confidence\":\"low|medium|high\"}",
    "",
    JSON.stringify({
      task: "tictactoe-harbor-env-rebuild",
      objective,
      stage: input.stage,
      replicate_id: input.replicate,
      current_effort: input.currentEffort,
      parent_segment: input.parentSegment
        ? {
            effort: input.parentSegment.effort,
            duration_sec: input.parentSegment.duration_sec,
            returncode: input.parentSegment.returncode,
            usage: input.parentSegment.usage,
            stdout_log: input.parentSegment.stdout_log,
          }
        : null,
      handoff_body: input.handoffBody ? truncateText(input.handoffBody, 6000) : null,
      acceptance: [
        "candidate/scripts/run_service.py exists",
        "20-scenario Harbor spectrum passes",
        "No policy-hillclimb lane or hidden fixture access",
      ],
    }, null, 2),
  ].join("\n")
}

function extractLastAgentMessage(stdout: string): string {
  let message = ""
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      const text = readAgentText(parsed)
      if (text) message = text
    } catch {
      // Ignore non-JSON status lines from the CLI.
    }
  }
  return message.trim()
}

function readAgentText(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const item = record.item
  if (item) return readAgentText(item)
  const payload = record.payload
  if ((record.type === "response_item" || record.type === "event_msg") && payload) return readAgentText(payload)
  if (record.type === "agent_message" && typeof record.text === "string") return record.text
  if (record.type === "message" && Array.isArray(record.content)) {
    const parts = record.content
      .map((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).text
        : undefined)
      .filter((text): text is string => typeof text === "string")
    return parts.join("\n")
  }
  return undefined
}

function parseMonitorRouteJson(text: string): { effort: string; rationale: string; confidence?: string } {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/)
    if (!match) throw new Error(`monitor route did not return JSON: ${truncateText(text, 500)}`)
    parsed = JSON.parse(match[0])
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`monitor route JSON is not an object: ${truncateText(text, 500)}`)
  }
  const record = parsed as Record<string, unknown>
  const effort = typeof record.effort === "string" ? record.effort.trim() : ""
  if (!["low", "medium", "high", "xhigh"].includes(effort)) {
    throw new Error(`monitor route returned invalid effort: ${truncateText(text, 500)}`)
  }
  const rationale = typeof record.rationale === "string" && record.rationale.trim()
    ? record.rationale.trim()
    : "monitor did not provide rationale"
  const confidence = typeof record.confidence === "string" ? record.confidence.trim() : undefined
  return { effort, rationale, confidence }
}

async function runAgentSegment(input: {
  packet: { packetDir: string; workspaceDir: string; candidateDir?: string; specDir?: string }
  name: string
  provider: SegmentProvider
  model: string
  effort: string
  prompt: string
  routeDecision?: RouteDecision
}): Promise<SegmentResult> {
  if (input.provider === "deepseek") return runDeepSeekSegment(input)
  return runCodexSegment(input)
}

async function runCodexSegment(input: {
  packet: { packetDir: string; workspaceDir: string }
  name: string
  provider: SegmentProvider
  model: string
  effort: string
  prompt: string
  routeDecision?: RouteDecision
}): Promise<SegmentResult> {
  logProgress("segment.started", {
    packet_dir: input.packet.packetDir,
    segment: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
  })
  const logsDir = join(input.packet.packetDir, "logs", input.name)
  await mkdir(logsDir, { recursive: true })
  const stdoutLog = join(logsDir, "codex_stdout.jsonl")
  const stderrLog = join(logsDir, "codex_stderr.log")
  const command = [
    "codex",
    "exec",
    "--sandbox",
    "workspace-write",
    "--cd",
    input.packet.workspaceDir,
    "--skip-git-repo-check",
    "--json",
    "--model",
    input.model,
    "-c",
    `model_reasoning_effort=${input.effort}`,
    "-c",
    'approval_policy="never"',
    "--",
    input.prompt,
  ]
  const started = new Date()
  const proc = Bun.spawn(command, {
    cwd: input.packet.workspaceDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HARBOR_CODEX_TIMEOUT_SECONDS: String(segmentTimeoutSec),
    },
  })
  const killTimer = setTimeout(() => {
    proc.kill("SIGTERM")
  }, segmentTimeoutSec * 1000)
  const [stdout, stderr, returncode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(killTimer)
  const finished = new Date()
  await writeFile(stdoutLog, stdout)
  await writeFile(stderrLog, stderr)
  await auditCodexTranscript(stdout, join(logsDir, "audit.json"))
  const usageCapture = await parseUsage(stdout)
  const result = {
    name: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_sec: secondsBetween(started, finished),
    returncode,
    stdout_log: stdoutLog,
    stderr_log: stderrLog,
    usage: usageCapture.usage,
    usage_source: usageCapture.source,
    codex_session_log: usageCapture.codexSessionLog,
    route_decision: input.routeDecision,
  }
  logProgress("segment.completed", {
    packet_dir: input.packet.packetDir,
    segment: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    duration_sec: result.duration_sec,
    returncode,
    usage_source: usageCapture.source ?? null,
    input_tokens: usageCapture.usage?.input_tokens ?? null,
    output_tokens: usageCapture.usage?.output_tokens ?? null,
    reasoning_output_tokens: usageCapture.usage?.reasoning_output_tokens ?? null,
  })
  return result
}

async function runDeepSeekSegment(input: {
  packet: { packetDir: string; workspaceDir: string; candidateDir?: string; specDir?: string }
  name: string
  provider: SegmentProvider
  model: string
  effort: string
  prompt: string
  routeDecision?: RouteDecision
}): Promise<SegmentResult> {
  logProgress("segment.started", {
    packet_dir: input.packet.packetDir,
    segment: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
  })
  const logsDir = join(input.packet.packetDir, "logs", input.name)
  await mkdir(logsDir, { recursive: true })
  const promptLog = join(logsDir, "deepseek_prompt.txt")
  const responseLog = join(logsDir, "deepseek_response.json")
  const stderrLog = join(logsDir, "deepseek_error.log")
  const candidateDir = input.packet.candidateDir ?? join(input.packet.workspaceDir, "candidate")
  const specDir = input.packet.specDir ?? join(input.packet.workspaceDir, "spec")
  const started = new Date()
  let responseText = ""
  let errorText = ""
  let returncode = 0
  let usage: Usage | null = null

  try {
    const apiKey = await loadEnvSecret("DEEPSEEK_API_KEY")
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY missing from environment or synth-ai/.env")
    const deepSeekPrompt = await buildDeepSeekSegmentPrompt({
      basePrompt: input.prompt,
      candidateDir,
      specDir,
    })
    await writeFile(promptLog, deepSeekPrompt)
    const controller = new AbortController()
    const killTimer = setTimeout(() => controller.abort(), segmentTimeoutSec * 1000)
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          {
            role: "system",
            content: "You are a code generation worker. Return only valid JSON that matches the requested file-write schema.",
          },
          { role: "user", content: deepSeekPrompt },
        ],
        response_format: { type: "json_object" },
        thinking: deepSeekThinkingConfig(input.effort),
        max_tokens: deepSeekMaxTokens(input.effort),
        temperature: 0.2,
      }),
      signal: controller.signal,
    })
    clearTimeout(killTimer)
    responseText = await response.text()
    await writeFile(responseLog, responseText)
    if (!response.ok) {
      throw new Error(`DeepSeek API failed (${response.status}): ${truncateText(responseText, 1200)}`)
    }
    const responseJson = JSON.parse(responseText) as Record<string, unknown>
    usage = readDeepSeekUsage(responseJson)
    const content = readDeepSeekContent(responseJson)
    await applyDeepSeekFileWrites(content, candidateDir, logsDir)
  } catch (error) {
    returncode = 1
    errorText = error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`
    await writeFile(stderrLog, errorText)
    if (!responseText) await writeFile(responseLog, "{}\n")
  }

  const finished = new Date()
  if (!existsSync(stderrLog)) await writeFile(stderrLog, "")
  const result = {
    name: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_sec: secondsBetween(started, finished),
    returncode,
    stdout_log: responseLog,
    stderr_log: stderrLog,
    usage,
    usage_source: usage ? "stdout" as const : undefined,
    route_decision: input.routeDecision,
  }
  logProgress("segment.completed", {
    packet_dir: input.packet.packetDir,
    segment: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    duration_sec: result.duration_sec,
    returncode,
    usage_source: usage ? "deepseek_api" : null,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    reasoning_output_tokens: usage?.reasoning_output_tokens ?? null,
  })
  return result
}

async function runSidekickGuidanceSegment(input: {
  packet: { packetDir: string; workspaceDir: string; candidateDir: string; specDir: string; initialPrompt: string }
  name: string
  provider: SegmentProvider
  model: string
  effort: string
  replicate: number
}): Promise<SegmentResult> {
  if (input.provider !== "deepseek") {
    return runAgentSegment({
      packet: input.packet,
      name: input.name,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      prompt: buildCodexSidekickPrompt(input),
    })
  }

  logProgress("segment.started", {
    packet_dir: input.packet.packetDir,
    segment: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
  })
  const logsDir = join(input.packet.packetDir, "logs", input.name)
  await mkdir(logsDir, { recursive: true })
  const promptLog = join(logsDir, "deepseek_sidekick_prompt.txt")
  const responseLog = join(logsDir, "deepseek_sidekick_response.json")
  const stderrLog = join(logsDir, "deepseek_sidekick_error.log")
  const sidekickPath = join(input.packet.packetDir, "monitor-sidekick.md")
  const started = new Date()
  let responseText = ""
  let returncode = 0
  let usage: Usage | null = null

  try {
    const apiKey = await loadEnvSecret("DEEPSEEK_API_KEY")
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY missing from environment or synth-ai/.env")
    const prompt = await buildDeepSeekSidekickPrompt(input)
    await writeFile(promptLog, prompt)
    const controller = new AbortController()
    const killTimer = setTimeout(() => controller.abort(), segmentTimeoutSec * 1000)
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          {
            role: "system",
            content: "You are a Stack monitor sidekick. Return only valid JSON with a base64 markdown guidance artifact.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        thinking: deepSeekThinkingConfig(input.effort),
        max_tokens: Math.min(deepSeekMaxTokens(input.effort), 24_000),
        temperature: 0.2,
      }),
      signal: controller.signal,
    })
    clearTimeout(killTimer)
    responseText = await response.text()
    await writeFile(responseLog, responseText)
    if (!response.ok) {
      throw new Error(`DeepSeek sidekick API failed (${response.status}): ${truncateText(responseText, 1200)}`)
    }
    const responseJson = JSON.parse(responseText) as Record<string, unknown>
    usage = readDeepSeekUsage(responseJson)
    const content = readDeepSeekContent(responseJson)
    const guidance = readSidekickGuidance(content)
    await writeFile(sidekickPath, guidance)
  } catch (error) {
    returncode = 1
    await writeFile(stderrLog, error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`)
    if (!responseText) await writeFile(responseLog, "{}\n")
  }

  const finished = new Date()
  if (!existsSync(stderrLog)) await writeFile(stderrLog, "")
  const result = {
    name: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_sec: secondsBetween(started, finished),
    returncode,
    stdout_log: responseLog,
    stderr_log: stderrLog,
    usage,
    usage_source: usage ? "stdout" as const : undefined,
  }
  logProgress("segment.completed", {
    packet_dir: input.packet.packetDir,
    segment: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    duration_sec: result.duration_sec,
    returncode,
    usage_source: usage ? "deepseek_api" : null,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    reasoning_output_tokens: usage?.reasoning_output_tokens ?? null,
  })
  return result
}

function buildCodexSidekickPrompt(input: {
  packet: { packetDir: string; initialPrompt: string }
  replicate: number
}): string {
  return [
    input.packet.initialPrompt,
    "",
    "You are a monitor sidekick, not the implementation owner.",
    "Write monitor-sidekick.md in the packet root with concrete implementation guidance, likely failure modes, and acceptance checks.",
    `Packet root: ${input.packet.packetDir}`,
    `Replicate: ${input.replicate}`,
    "",
  ].join("\n")
}

async function buildDeepSeekSidekickPrompt(input: {
  packet: { initialPrompt: string; specDir: string }
  replicate: number
}): Promise<string> {
  const specFiles = await collectTextFiles(input.packet.specDir, "spec", 220_000)
  return [
    "You are the Stack monitor sidekick for a Harbor TicTacToe env-rebuild run.",
    "",
    "Role:",
    "- Do independent spec analysis.",
    "- Do not write implementation files.",
    "- Produce a concise but concrete markdown artifact for the primary worker.",
    "- Optimize the cost/time/performance frontier: guidance should help a low-effort primary avoid common wrong lanes and service-start failures.",
    "",
    "Return only JSON:",
    "{\"guidance_md_base64\":\"BASE64_UTF8_MARKDOWN\"}",
    "",
    "The markdown must include:",
    "- Implementation outline",
    "- Service API contract checklist",
    "- Common Harbor verifier failure modes",
    "- Minimal file layout",
    "- Final smoke checklist",
    "",
    `Replicate: ${input.replicate}`,
    "",
    "## Task prompt",
    "",
    input.packet.initialPrompt,
    "",
    "## Spec files",
    "",
    specFiles,
  ].join("\n")
}

function readSidekickGuidance(content: string): string {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (typeof parsed.guidance_md_base64 === "string") {
    return Buffer.from(parsed.guidance_md_base64, "base64").toString("utf8")
  }
  if (typeof parsed.guidance_md === "string") return parsed.guidance_md
  throw new Error("Sidekick JSON missing guidance_md_base64")
}

async function buildDeepSeekSegmentPrompt(input: {
  basePrompt: string
  candidateDir: string
  specDir: string
}): Promise<string> {
  const specFiles = await collectTextFiles(input.specDir, "spec", 220_000)
  const candidateFiles = await collectTextFiles(input.candidateDir, "candidate", 260_000)
  return [
    input.basePrompt,
    "",
    "## DeepSeek direct API segment protocol",
    "",
    "You cannot run shell commands. Generate file contents directly.",
    "Return only a JSON object with this exact shape:",
    "{\"files\":[{\"path\":\"gold/example.py\",\"content_base64\":\"BASE64_UTF8_FILE_CONTENT\"}],\"notes\":\"short status\"}",
    "",
    "Rules:",
    "- Every path must be relative to the candidate root.",
    "- Only write under gold/, policies/, scripts/, acceptance.md, README.md, or HANDOFF.md.",
    "- Include complete file contents as base64-encoded UTF-8, not patches.",
    "- Do not put raw source code in JSON string values; use content_base64.",
    "- Ensure scripts/run_service.py exists and can start the Harbor service.",
    "- Keep this ENV CODEGEN. Do not create a heuristic_policy.py-only policy hillclimb answer.",
    "",
    "## Spec files",
    "",
    specFiles,
    "",
    "## Current candidate files",
    "",
    candidateFiles,
    "",
  ].join("\n")
}

async function collectTextFiles(root: string, label: string, maxChars: number): Promise<string> {
  const files = await listFiles(root)
  const chunks: string[] = []
  let used = 0
  for (const file of files.sort()) {
    const rel = relative(root, file)
    if (rel.includes("__pycache__") || rel.endsWith(".pyc")) continue
    const text = await readFile(file, "utf8").catch(() => "")
    const block = [`### ${label}/${rel}`, "", "```", text, "```", ""].join("\n")
    if (used + block.length > maxChars) {
      chunks.push(`### ${label}/${rel}\n\n[truncated: context budget reached]\n`)
      break
    }
    chunks.push(block)
    used += block.length
  }
  return chunks.length > 0 ? chunks.join("\n") : `[no ${label} files]`
}

async function listFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

function deepSeekThinkingConfig(effort: string): Record<string, unknown> {
  if (effort === "low") return { type: "disabled" }
  const budget = effort === "xhigh" ? 65_536 : effort === "high" ? 32_768 : 8_192
  return { type: "enabled", budget_tokens: budget }
}

function deepSeekMaxTokens(effort: string): number {
  if (effort === "xhigh") return 140_000
  if (effort === "high") return 100_000
  if (effort === "medium") return 60_000
  return 30_000
}

function readDeepSeekContent(response: Record<string, unknown>): string {
  const choices = response.choices
  if (!Array.isArray(choices) || choices.length === 0) throw new Error("DeepSeek response missing choices")
  const first = choices[0]
  if (!first || typeof first !== "object" || Array.isArray(first)) throw new Error("DeepSeek choice is not an object")
  const message = (first as Record<string, unknown>).message
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("DeepSeek choice missing message")
  const content = (message as Record<string, unknown>).content
  if (typeof content !== "string" || !content.trim()) throw new Error("DeepSeek message content empty")
  return content
}

function readDeepSeekUsage(response: Record<string, unknown>): Usage | null {
  const usage = response.usage
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null
  const record = usage as Record<string, unknown>
  const completionDetails = record.completion_tokens_details && typeof record.completion_tokens_details === "object" && !Array.isArray(record.completion_tokens_details)
    ? record.completion_tokens_details as Record<string, unknown>
    : {}
  const cacheHit = Number(record.prompt_cache_hit_tokens ?? 0)
  const cacheMiss = Number(record.prompt_cache_miss_tokens ?? 0)
  const promptTokens = Number(record.prompt_tokens ?? cacheHit + cacheMiss)
  return {
    input_tokens: cacheHit + cacheMiss > 0 ? cacheHit + cacheMiss : promptTokens,
    cached_input_tokens: cacheHit,
    output_tokens: Number(record.completion_tokens ?? 0),
    reasoning_output_tokens: Number(completionDetails.reasoning_tokens ?? 0),
  }
}

async function applyDeepSeekFileWrites(content: string, candidateDir: string, logsDir: string): Promise<void> {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const files = parsed.files
  if (!Array.isArray(files) || files.length === 0) throw new Error("DeepSeek JSON missing non-empty files array")
  const applied: Array<{ path: string; bytes: number }> = []
  for (const file of files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("DeepSeek file entry is not an object")
    const record = file as Record<string, unknown>
    const path = typeof record.path === "string" ? record.path.trim() : ""
    const fileContent = readDeepSeekFileContent(record)
    if (!path || fileContent === undefined) throw new Error("DeepSeek file entry missing path or content")
    const safeRel = normalizeCandidateWritePath(path, candidateDir)
    const destination = resolve(candidateDir, safeRel)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, fileContent)
    applied.push({ path: safeRel, bytes: Buffer.byteLength(fileContent) })
  }
  await writeFile(join(logsDir, "deepseek_applied_files.json"), `${JSON.stringify({ files: applied }, null, 2)}\n`)
}

function readDeepSeekFileContent(record: Record<string, unknown>): string | undefined {
  if (typeof record.content_base64 === "string") {
    return Buffer.from(record.content_base64, "base64").toString("utf8")
  }
  return typeof record.content === "string" ? record.content : undefined
}

function normalizeCandidateWritePath(path: string, candidateDir: string): string {
  let rel = path.replaceAll("\\", "/").replace(/^\/+/, "")
  if (rel.startsWith("candidate/")) rel = rel.slice("candidate/".length)
  if (path.startsWith("/")) rel = relative(candidateDir, resolve(path)).replaceAll("\\", "/")
  const allowed = ["gold/", "policies/", "scripts/", "acceptance.md", "README.md", "HANDOFF.md"]
  if (rel.includes("..") || rel.startsWith("/") || !allowed.some((prefix) => rel === prefix || rel.startsWith(prefix))) {
    throw new Error(`Unsafe DeepSeek write path: ${path}`)
  }
  return rel
}

async function runVerify(packetDir: string): Promise<Record<string, unknown>> {
  logProgress("verify.started", { packet_dir: packetDir })
  await chmod(verifyScript, 0o755)
  const started = new Date()
  const proc = Bun.spawn([verifyScript, packetDir], {
    cwd: stackRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GAMEBENCH_HARBOR_VERIFY: "host",
    },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const finished = new Date()
  await writeFile(join(packetDir, "verifier-stdout.log"), stdout)
  await writeFile(join(packetDir, "verifier-stderr.log"), stderr)
  const summaryPath = join(packetDir, "verifier", "summary.json")
  const resultPath = join(packetDir, "verifier", "result.json")
  const summary = existsSync(summaryPath) ? JSON.parse(await readFile(summaryPath, "utf8")) : {}
  const result = {
    exit_code: exitCode,
    duration_sec: secondsBetween(started, finished),
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    stdout_log: join(packetDir, "verifier-stdout.log"),
    stderr_log: join(packetDir, "verifier-stderr.log"),
    summary_path: existsSync(summaryPath) ? summaryPath : null,
    result_path: existsSync(resultPath) ? resultPath : null,
    ...summary,
  }
  logProgress("verify.completed", {
    packet_dir: packetDir,
    exit_code: exitCode,
    duration_sec: result.duration_sec,
    harbor_reward: result.harbor_reward ?? null,
  })
  return result
}

function armResult(input: {
  arm: string
  label: string
  replicate: number
  packet: { packetDir: string; proofPacketDir: string; workspaceDir: string }
  handoffCount: number
  segments: SegmentResult[]
  started: Date
  finished: Date
  verify: Record<string, unknown>
}): ArmResult {
  const usage = sumUsage(input.segments.flatMap((segment) => [
    segment.route_decision?.monitor_usage ?? null,
    segment.usage,
  ]))
  const cost = estimateArmCost(input.segments)
  const failedSegments = input.segments
    .filter((segment) => segment.returncode !== 0)
    .map((segment) => ({
      name: segment.name,
      model: segment.model,
      effort: segment.effort,
      returncode: segment.returncode,
    }))
  const verifierExitCode = readNumber(input.verify.exit_code)
  const reward = readNumber(input.verify.harbor_reward)
  const agentCompleted = failedSegments.length === 0
  return {
    arm: input.arm,
    label: input.label,
    replicate: input.replicate,
    packet_dir: input.packet.proofPacketDir,
    work_packet_dir: input.packet.packetDir,
    workspace: input.packet.workspaceDir,
    handoff_count: input.handoffCount,
    segments: input.segments,
    started_at: input.started.toISOString(),
    finished_at: input.finished.toISOString(),
    duration_sec: secondsBetween(input.started, input.finished),
    verify: input.verify,
    agent_completed: agentCompleted,
    comparison_valid: agentCompleted && verifierExitCode === 0 && isNumber(reward),
    failed_segments: failedSegments,
    usage,
    cost_usd_estimate: cost.estimate,
    cost_usd_upper_bound: cost.upperBound,
  }
}

async function mirrorPacketToProof(packet: { packetDir: string; proofPacketDir: string }): Promise<void> {
  if (existsSync(packet.proofPacketDir)) {
    await rm(packet.proofPacketDir, { recursive: true, force: true })
  }
  await mkdir(proofRoot, { recursive: true })
  await cp(packet.packetDir, packet.proofPacketDir, { recursive: true })
}

async function auditCodexTranscript(stdout: string, auditPath: string): Promise<void> {
  const forbidden = [
    "/.stack/evidence/stackeval/",
    "/gamebench/adapters/harbor/bundles/tictactoe_singleplayer_gold/fixtures",
    "/gamebench/adapters/harbor/bundles/tictactoe_singleplayer_gold/reference",
    "/task/tests/fixtures",
    "/task/reference",
  ]
  const hits: Array<{ line: number; pattern: string; text: string }> = []
  const lines = stdout.split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const pattern of forbidden) {
      if (line.includes(pattern)) {
        hits.push({ line: index + 1, pattern, text: line.slice(0, 1200) })
      }
    }
  }
  await writeFile(
    auditPath,
    `${JSON.stringify({ cleanroom_violation: hits.length > 0, hits }, null, 2)}\n`,
  )
}

async function parseUsage(stdout: string): Promise<{
  usage: Usage | null
  source?: "stdout" | "codex_session"
  codexSessionLog?: string
}> {
  const stdoutUsage = parseUsageFromText(stdout)
  if (stdoutUsage) return { usage: stdoutUsage, source: "stdout" }
  const threadId = parseCodexThreadId(stdout)
  if (!threadId) return { usage: null }
  const codexSessionLog = await resolveCodexSessionLog(threadId)
  if (!codexSessionLog) return { usage: null }
  const usage = parseUsageFromText(await readFile(codexSessionLog, "utf8"))
  return { usage, source: usage ? "codex_session" : undefined, codexSessionLog }
}

function parseUsageFromText(text: string): Usage | null {
  let usage: Usage | null = null
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      usage = readUsageFromCodexEvent(parsed) ?? usage
    } catch {
      // Ignore non-JSON status lines from the CLI.
    }
  }
  return usage
}

function parseCodexThreadId(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed?.type === "thread.started" && typeof parsed.thread_id === "string") {
        return parsed.thread_id
      }
    } catch {
      // Ignore non-JSON status lines from the CLI.
    }
  }
  return null
}

async function resolveCodexSessionLog(threadId: string): Promise<string | undefined> {
  const suffix = `${threadId}.jsonl`
  for (const dir of recentCodexSessionDirs()) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    const match = entries.find((entry) => entry.endsWith(suffix))
    if (match) return join(dir, match)
  }
  return undefined
}

function recentCodexSessionDirs(): string[] {
  const root = join(homedir(), ".codex", "sessions")
  const today = new Date()
  return [0, 1, 2].map((offset) => {
    const date = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000)
    const year = String(date.getFullYear())
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return join(root, year, month, day)
  })
}

function readUsageFromCodexEvent(event: unknown): Usage | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null
  const record = event as Record<string, unknown>
  if ((record.type === "event_msg" || record.type === "response_item") && record.payload) {
    return readUsageFromCodexEvent(record.payload)
  }
  if (record.type === "turn.completed") return readUsageRecord(record.usage)
  if (record.type !== "token_count") return null
  const info = record.info && typeof record.info === "object" && !Array.isArray(record.info)
    ? record.info as Record<string, unknown>
    : undefined
  return (
    readUsageRecord(info?.total_token_usage) ??
    readUsageRecord(info?.last_token_usage) ??
    readUsageRecord(record.usage)
  )
}

function readUsageRecord(value: unknown): Usage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const usage = value as Record<string, unknown>
  return {
    input_tokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
    cached_input_tokens: Number(usage.cached_input_tokens ?? usage.cachedInputTokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
    reasoning_output_tokens: Number(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens ?? 0),
  }
}

function sumUsage(values: Array<Usage | null>): Usage {
  const total: Usage = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  }
  for (const value of values) {
    if (!value) continue
    total.input_tokens += value.input_tokens
    total.cached_input_tokens += value.cached_input_tokens
    total.output_tokens += value.output_tokens
    total.reasoning_output_tokens += value.reasoning_output_tokens
  }
  return total
}

function estimateArmCost(segments: SegmentResult[]): { estimate: number; upperBound: number } {
  let estimate = 0
  let upperBound = 0
  for (const segment of segments) {
    const segmentCost = estimateUsageCost(segment.usage, segment.model, segment.provider)
    estimate += segmentCost.estimate
    upperBound += segmentCost.upperBound
    const route = segment.route_decision
    if (route?.monitor_usage) {
      const routeCost = estimateUsageCost(route.monitor_usage, route.monitor_model, "codex")
      estimate += routeCost.estimate
      upperBound += routeCost.upperBound
    }
  }
  return {
    estimate: roundUsd(estimate),
    upperBound: roundUsd(upperBound),
  }
}

function estimateUsageCost(usage: Usage | null, modelName: string, provider: SegmentProvider): { estimate: number; upperBound: number } {
  if (!usage) return { estimate: 0, upperBound: 0 }
  const pricing = resolvePricing(modelName, provider)
  const cached = Math.min(usage.cached_input_tokens, usage.input_tokens)
  const nonCached = Math.max(0, usage.input_tokens - cached)
  const inputCost = (nonCached * pricing.input_per_million + cached * pricing.cached_input_per_million) / 1_000_000
  const outputCost = (usage.output_tokens * pricing.output_per_million) / 1_000_000
  const reasoningExtra = (usage.reasoning_output_tokens * pricing.output_per_million) / 1_000_000
  if (provider === "deepseek") {
    return {
      estimate: inputCost + outputCost,
      upperBound: inputCost + outputCost,
    }
  }
  return {
    estimate: inputCost + outputCost,
    upperBound: inputCost + outputCost + reasoningExtra,
  }
}

function resolvePricing(modelName: string, provider: SegmentProvider): PricingRow {
  const normalized = modelName.trim().toLowerCase()
  const providerRows = pricingRows.filter((row) => row.provider === provider)
  const exact = providerRows.find((row) => row.model.toLowerCase() === normalized)
  if (exact) return exact
  const prefix = providerRows
    .filter((row) => normalized.startsWith(row.model.toLowerCase()) || row.model.toLowerCase().startsWith(normalized))
    .sort((left, right) => right.model.length - left.model.length)[0]
  if (prefix) return prefix
  throw new Error(`No pricing row for provider/model ${provider}:${modelName}`)
}

function summarizeArms(arms: ArmResult[]): Record<string, unknown> {
  const labels = [...new Set(arms.map((arm) => arm.label))].sort()
  const byArm = labels.map((label) => {
    const runs = arms.filter((arm) => arm.label === label)
    const comparableRuns = runs.filter((run) => run.comparison_valid)
    const rewards = comparableRuns.map((run) => readNumber(run.verify.harbor_reward)).filter(isNumber)
    const allRewards = runs.map((run) => readNumber(run.verify.harbor_reward)).filter(isNumber)
    const verifierExitCodes = runs.map((run) => readNumber(run.verify.exit_code)).filter(isNumber)
    return {
      label,
      arm: runs[0]?.arm,
      n: runs.length,
      agent_completed_n: runs.filter((run) => run.agent_completed).length,
      agent_completed_rate: runs.length === 0
        ? null
        : roundMetric(runs.filter((run) => run.agent_completed).length / runs.length),
      comparison_valid_n: comparableRuns.length,
      comparison_invalid_n: runs.length - comparableRuns.length,
      reward: metricStats(rewards),
      reward_all_runs_including_invalid: metricStats(allRewards),
      success_rate: rewards.length === 0 ? null : roundMetric(rewards.filter((value) => value >= 1).length / rewards.length),
      verifier_success_rate: verifierExitCodes.length === 0
        ? null
        : roundMetric(verifierExitCodes.filter((value) => value === 0).length / verifierExitCodes.length),
      cost_usd_estimate: metricStats(comparableRuns.map((run) => run.cost_usd_estimate)),
      cost_usd_upper_bound: metricStats(comparableRuns.map((run) => run.cost_usd_upper_bound)),
      duration_sec: metricStats(comparableRuns.map((run) => run.duration_sec)),
      handoff_count: metricStats(comparableRuns.map((run) => run.handoff_count)),
      reward_missing_count: runs.length - rewards.length,
      failed_segments: runs.flatMap((run) => run.failed_segments.map((segment) => ({
        replicate: run.replicate,
        ...segment,
      }))),
    }
  })
  return {
    by_arm: byArm,
    total_runs: arms.length,
    completed_at: new Date().toISOString(),
  }
}

function metricStats(values: number[]): MetricStats {
  const clean = values.filter(isNumber)
  if (clean.length === 0) return { n: 0, mean: null, stdev: null, min: null, max: null }
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length
  return {
    n: clean.length,
    mean: roundMetric(mean),
    stdev: roundMetric(Math.sqrt(variance)),
    min: roundMetric(Math.min(...clean)),
    max: roundMetric(Math.max(...clean)),
  }
}

async function runInParallel<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length)
  let next = 0
  const workerCount = Math.min(limit, jobs.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < jobs.length) {
      const index = next
      next += 1
      results[index] = await jobs[index]()
    }
  }))
  return results
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, got ${raw}`)
  }
  return parsed
}

function readArmSelection(): ArmKind {
  const value = process.env.STACK_AB_ARMS?.trim() || "all"
  if (value === "all" || value === "no_handoff" || value === "handoff" || value === "sidekick") return value
  throw new Error(`STACK_AB_ARMS must be all, no_handoff, handoff, or sidekick; got ${value}`)
}

function readSegmentProvider(name: string, fallback: SegmentProvider): SegmentProvider {
  const value = process.env[name]?.trim() || fallback
  if (value === "codex" || value === "deepseek") return value
  throw new Error(`${name} must be codex or deepseek; got ${value}`)
}

function handoffArmLabel(): string {
  if (handoffRouting === "sidekick") {
    return `sidekick_${handoffParentProvider}_${slugModel(handoffParentModel)}_${handoffParentEffort}_with_${handoffSuccessorProvider}_${slugModel(handoffSuccessorModel)}_${handoffSuccessorEffort}`
  }
  if (handoffRouting === "monitor") return "monitor_routed_handoff"
  return `typed_handoff_${handoffParentProvider}_${slugModel(handoffParentModel)}_${handoffParentEffort}_to_${handoffSuccessorProvider}_${slugModel(handoffSuccessorModel)}_${handoffSuccessorEffort}`
}

function slugModel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function replicateLabel(replicate: number): string {
  return String(replicate).padStart(2, "0")
}

async function loadEnvSecret(name: string): Promise<string | undefined> {
  const direct = process.env[name]?.trim()
  if (direct) return direct
  const envPath = join(workspaceRoot, "synth-ai/.env")
  if (!existsSync(envPath)) return undefined
  const text = await readFile(envPath, "utf8")
  const match = text.match(new RegExp(`^${name}=(.+)$`, "m"))
  return match?.[1]?.trim()
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...(truncated ${value.length - maxLength} chars)`
}

function logProgress(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    type: "stack_ab_progress",
    event,
    at: new Date().toISOString(),
    ...fields,
  }))
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

function secondsBetween(started: Date, finished: Date): number {
  return Math.round((finished.getTime() - started.getTime()) / 100) / 10
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
