#!/usr/bin/env bun

import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

type Usage = {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
}

type SegmentResult = {
  name: string
  provider: "codex" | "deepseek"
  model: string
  effort: string
  started_at: string
  finished_at: string
  duration_sec: number
  returncode: number
  stdout_log: string
  stderr_log: string
  usage: Usage | null
  usage_source?: string
}

type ArmResult = {
  arm: "A" | "B"
  label: string
  replicate: number
  packet_dir: string
  work_packet_dir: string
  workspace: string
  segments: SegmentResult[]
  verify: Record<string, unknown>
  started_at: string
  finished_at: string
  duration_sec: number
  comparison_valid: boolean
  usage: Usage
  cost_usd_estimate: number
}

const stackRoot = resolve(import.meta.dir, "..")
const workspaceRoot = resolve(stackRoot, "..")
const gamebenchRoot = process.env.GAMEBENCH_ROOT ?? join(workspaceRoot, "gamebench")
const harborRoot = join(gamebenchRoot, "adapters/harbor/bundles/tictactoe_singleplayer_gold")
const specRoot = join(harborRoot, "spec")
const instructionPath = join(harborRoot, "instruction.md")
const verifyScript = join(stackRoot, "scripts/stackeval/tictactoe_harbor_verify.sh")
const stamp = process.env.STACK_SIDEKICK_STAMP ?? timestamp()
const proofRoot = resolve(process.env.STACK_SIDEKICK_ROOT ?? join(stackRoot, ".stack/evidence/stack-goal-first-sidekick", stamp))
const workRoot = resolve(process.env.STACK_SIDEKICK_WORK_ROOT ?? join("/tmp", "stack-harbor-sidekick", stamp))
const reps = readPositiveInt("STACK_SIDEKICK_REPS", 5)
const parallelism = readPositiveInt("STACK_SIDEKICK_PARALLELISM", 10)
const mainModel = process.env.STACK_SIDEKICK_MAIN_MODEL ?? "gpt-5.5"
const mainEffort = process.env.STACK_SIDEKICK_MAIN_EFFORT ?? "low"
const sidekickModel = process.env.STACK_SIDEKICK_MODEL ?? "deepseek-v4-pro"
const sidekickEffort = process.env.STACK_SIDEKICK_EFFORT ?? "high"
const timeoutSec = readPositiveInt("STACK_SIDEKICK_TIMEOUT_SECONDS", 1500)

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log([
    "Usage: bun run scripts/run_tictactoe_harbor_sidekick_pilot.ts",
    "",
    "Environment:",
    "  STACK_SIDEKICK_REPS",
    "  STACK_SIDEKICK_PARALLELISM",
    "  STACK_SIDEKICK_MAIN_MODEL",
    "  STACK_SIDEKICK_MAIN_EFFORT",
    "  STACK_SIDEKICK_MODEL",
    "  STACK_SIDEKICK_EFFORT",
    "  STACK_SIDEKICK_TIMEOUT_SECONDS",
    "",
  ].join("\n"))
  process.exit(0)
}

for (const required of [specRoot, instructionPath, verifyScript]) {
  if (!existsSync(required)) throw new Error(`required path missing: ${required}`)
}

await mkdir(proofRoot, { recursive: true })
await mkdir(workRoot, { recursive: true })

logProgress("batch.started", {
  proof_root: proofRoot,
  work_root: workRoot,
  reps,
  parallelism,
  main_model: mainModel,
  main_effort: mainEffort,
  sidekick_model: sidekickModel,
  sidekick_effort: sidekickEffort,
})

const arms = await runInParallel(buildJobs(), parallelism)
const assertions = {
  stamp,
  task: "tictactoe-harbor-env-rebuild",
  benchmark: "Harbor tictactoe_singleplayer_gold",
  design: {
    arm_a: { label: "no_sidekick", model: mainModel, effort: mainEffort },
    arm_b: {
      label: "monitor_sidekick",
      primary_model: mainModel,
      primary_effort: mainEffort,
      sidekick_model: sidekickModel,
      sidekick_effort: sidekickEffort,
      ownership: "primary keeps implementation ownership; sidekick writes advisory artifact only",
    },
    reps,
    parallelism,
  },
  pricing: {
    source: "Stack local pilot pricing rows; DeepSeek pricing from https://api-docs.deepseek.com/quick_start/pricing",
  },
  summary: summarize(arms),
  arms,
}
await writeFile(join(proofRoot, "assertions.json"), `${JSON.stringify(assertions, null, 2)}\n`)
await writeFile(join(proofRoot, "README.md"), [
  "# Harbor Sidekick Pilot",
  "",
  `Arm A: \`${mainModel}/${mainEffort}\` no sidekick.`,
  `Arm B: DeepSeek sidekick \`${sidekickModel}/${sidekickEffort}\` writes \`monitor-sidekick.md\`, then primary \`${mainModel}/${mainEffort}\` implements.`,
  "",
  "This tests a Devin Fusion-like sidekick artifact, not full dynamic Fusion scheduling.",
  "",
].join("\n"))

console.log(`stack_sidekick_pilot_complete ${proofRoot}`)
console.log(JSON.stringify(assertions, null, 2))

function buildJobs(): Array<() => Promise<ArmResult>> {
  const jobs: Array<() => Promise<ArmResult>> = []
  for (let replicate = 1; replicate <= reps; replicate += 1) {
    jobs.push(() => runBaseline(replicate))
    jobs.push(() => runSidekick(replicate))
  }
  return jobs
}

async function runBaseline(replicate: number): Promise<ArmResult> {
  const packet = await preparePacket(`arm_no_sidekick_rep${replicateLabel(replicate)}`)
  const started = new Date()
  logProgress("arm.started", { arm: "A", label: "no_sidekick", replicate })
  const segment = await runCodexSegment(packet, "single_thread", mainModel, mainEffort, [
    packet.initialPrompt,
    "",
    "## Arm instruction",
    "",
    "Complete the full implementation in this single continuous thread. Do not use a sidekick or handoff.",
    "When done, update acceptance.md with what was built and any known blockers.",
    "",
  ].join("\n"))
  const verify = await runVerify(packet.packetDir)
  await mirror(packet)
  const finished = new Date()
  return armResult("A", "no_sidekick", replicate, packet, [segment], verify, started, finished)
}

async function runSidekick(replicate: number): Promise<ArmResult> {
  const packet = await preparePacket(`arm_sidekick_rep${replicateLabel(replicate)}`)
  const started = new Date()
  logProgress("arm.started", { arm: "B", label: "monitor_sidekick", replicate })
  const sidekick = await runDeepSeekSidekick(packet, replicate)
  const guidancePath = join(packet.packetDir, "monitor-sidekick.md")
  const guidance = existsSync(guidancePath)
    ? sanitizePrompt(await readFile(guidancePath, "utf8"))
    : "Sidekick failed to produce guidance. Continue from the spec and prioritize service health."
  const primary = await runCodexSegment(packet, "primary_with_sidekick", mainModel, mainEffort, [
    packet.initialPrompt,
    "",
    "## Arm instruction",
    "",
    "You are the primary Stack worker. A monitor sidekick independently inspected the task and wrote guidance below.",
    "Use it as advisory context only; you own the implementation decisions.",
    "Do not hand off. Complete the full implementation in this one primary thread.",
    "",
    "## Monitor-sidekick guidance",
    "",
    guidance,
    "",
  ].join("\n"))
  const verify = await runVerify(packet.packetDir)
  await mirror(packet)
  const finished = new Date()
  return armResult("B", "monitor_sidekick", replicate, packet, [sidekick, primary], verify, started, finished)
}

type Packet = {
  packetDir: string
  proofPacketDir: string
  workspaceDir: string
  specDir: string
  candidateDir: string
  initialPrompt: string
}

async function preparePacket(name: string): Promise<Packet> {
  const packetDir = join(workRoot, name)
  const proofPacketDir = join(proofRoot, name)
  const workspaceDir = join(packetDir, "workspace")
  const specDir = join(workspaceDir, "spec")
  const candidateDir = join(workspaceDir, "candidate")
  await mkdir(specDir, { recursive: true })
  await mkdir(join(candidateDir, "gold"), { recursive: true })
  await mkdir(join(candidateDir, "policies"), { recursive: true })
  await mkdir(join(candidateDir, "scripts"), { recursive: true })
  await cp(specRoot, specDir, { recursive: true })
  await writeFile(join(candidateDir, "README.txt"), "Cleanroom candidate workspace.\n")
  const instruction = await readFile(instructionPath, "utf8")
  const initialPrompt = buildPrompt(instruction, specDir, candidateDir)
  await writeFile(join(packetDir, "initial_prompt.txt"), initialPrompt)
  await writeFile(join(packetDir, "acceptance.md"), "# Acceptance\n\n- [ ] service starts\n- [ ] spectrum verifier records reward\n")
  return { packetDir, proofPacketDir, workspaceDir, specDir, candidateDir, initialPrompt }
}

function buildPrompt(instruction: string, specDir: string, candidateDir: string): string {
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
    "Do not inspect any path outside this workspace. Do not read prior StackEval evidence, hidden verifier fixtures, or reference implementations.",
    "",
    "Required deliverable layout:",
    `${candidateDir}/gold/`,
    `${candidateDir}/policies/`,
    `${candidateDir}/scripts/run_service.py`,
    "",
  ].join("\n")
}

async function runCodexSegment(packet: Packet, name: string, model: string, effort: string, prompt: string): Promise<SegmentResult> {
  const logsDir = join(packet.packetDir, "logs", name)
  await mkdir(logsDir, { recursive: true })
  const stdoutLog = join(logsDir, "codex_stdout.jsonl")
  const stderrLog = join(logsDir, "codex_stderr.log")
  const safePrompt = sanitizePrompt(prompt)
  logProgress("segment.started", { packet_dir: packet.packetDir, segment: name, provider: "codex", model, effort })
  const started = new Date()
  const proc = Bun.spawn([
    "codex",
    "exec",
    "--sandbox",
    "workspace-write",
    "--cd",
    packet.workspaceDir,
    "--skip-git-repo-check",
    "--json",
    "--model",
    model,
    "-c",
    `model_reasoning_effort=${effort}`,
    "-c",
    'approval_policy="never"',
    "--",
    safePrompt,
  ], {
    cwd: packet.workspaceDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutSec * 1000)
  const [stdout, stderr, returncode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  const finished = new Date()
  await writeFile(stdoutLog, stdout)
  await writeFile(stderrLog, stderr)
  const usage = parseUsageFromText(stdout)
  const result: SegmentResult = {
    name,
    provider: "codex",
    model,
    effort,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_sec: secondsBetween(started, finished),
    returncode,
    stdout_log: stdoutLog,
    stderr_log: stderrLog,
    usage,
    usage_source: usage ? "stdout" : undefined,
  }
  logProgress("segment.completed", {
    packet_dir: packet.packetDir,
    segment: name,
    provider: "codex",
    model,
    effort,
    duration_sec: result.duration_sec,
    returncode,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
  })
  return result
}

async function runDeepSeekSidekick(packet: Packet, replicate: number): Promise<SegmentResult> {
  const logsDir = join(packet.packetDir, "logs", "monitor_sidekick")
  await mkdir(logsDir, { recursive: true })
  const promptLog = join(logsDir, "deepseek_prompt.txt")
  const responseLog = join(logsDir, "deepseek_response.json")
  const stderrLog = join(logsDir, "deepseek_error.log")
  const started = new Date()
  logProgress("segment.started", {
    packet_dir: packet.packetDir,
    segment: "monitor_sidekick",
    provider: "deepseek",
    model: sidekickModel,
    effort: sidekickEffort,
  })
  let responseText = ""
  let returncode = 0
  let usage: Usage | null = null
  try {
    const apiKey = await loadSecret("DEEPSEEK_API_KEY")
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY missing")
    const prompt = await buildSidekickPrompt(packet, replicate)
    await writeFile(promptLog, prompt)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutSec * 1000)
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: sidekickModel,
        messages: [
          { role: "system", content: "You are a Stack monitor sidekick. Return only valid JSON with base64 markdown guidance." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        thinking: sidekickEffort === "low" ? { type: "disabled" } : { type: "enabled", budget_tokens: 8192 },
        max_tokens: 24000,
        temperature: 0.2,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    responseText = await response.text()
    await writeFile(responseLog, responseText)
    if (!response.ok) throw new Error(`DeepSeek failed ${response.status}: ${responseText.slice(0, 1000)}`)
    const json = JSON.parse(responseText) as Record<string, unknown>
    usage = readDeepSeekUsage(json)
    const guidance = parseSidekickResponse(readDeepSeekContent(json))
    await writeFile(join(packet.packetDir, "monitor-sidekick.md"), sanitizePrompt(guidance))
  } catch (error) {
    returncode = 1
    await writeFile(stderrLog, error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`)
    if (!responseText) await writeFile(responseLog, "{}\n")
  }
  const finished = new Date()
  if (!existsSync(stderrLog)) await writeFile(stderrLog, "")
  const result: SegmentResult = {
    name: "monitor_sidekick",
    provider: "deepseek",
    model: sidekickModel,
    effort: sidekickEffort,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_sec: secondsBetween(started, finished),
    returncode,
    stdout_log: responseLog,
    stderr_log: stderrLog,
    usage,
    usage_source: usage ? "deepseek_api" : undefined,
  }
  logProgress("segment.completed", {
    packet_dir: packet.packetDir,
    segment: "monitor_sidekick",
    provider: "deepseek",
    model: sidekickModel,
    effort: sidekickEffort,
    duration_sec: result.duration_sec,
    returncode,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
  })
  return result
}

async function buildSidekickPrompt(packet: Packet, replicate: number): Promise<string> {
  const spec = await collectTextFiles(packet.specDir, "spec", 220_000)
  return [
    "Analyze this Harbor TicTacToe env-rebuild task as a monitor sidekick.",
    "Do not write implementation code. Produce guidance for a low-effort primary worker.",
    "Return JSON only: {\"guidance_md_base64\":\"BASE64_UTF8_MARKDOWN\"}",
    "",
    "The markdown should include implementation outline, service contract checklist, likely verifier failures, and a final smoke checklist.",
    `Replicate: ${replicate}`,
    "",
    "## Task prompt",
    packet.initialPrompt,
    "",
    "## Spec files",
    spec,
  ].join("\n")
}

function parseSidekickResponse(content: string): string {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (typeof parsed.guidance_md_base64 === "string") {
    return Buffer.from(parsed.guidance_md_base64, "base64").toString("utf8")
  }
  if (typeof parsed.guidance_md === "string") return parsed.guidance_md
  throw new Error("sidekick response missing guidance_md_base64")
}

async function collectTextFiles(root: string, label: string, maxChars: number): Promise<string> {
  const files = await listFiles(root)
  const chunks: string[] = []
  let used = 0
  for (const file of files.sort()) {
    const rel = relative(root, file)
    const text = await readFile(file, "utf8").catch(() => "")
    const block = [`### ${label}/${rel}`, "", "```", text, "```", ""].join("\n")
    if (used + block.length > maxChars) break
    chunks.push(block)
    used += block.length
  }
  return chunks.join("\n")
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    if (entry.isFile()) files.push(path)
  }
  return files
}

async function runVerify(packetDir: string): Promise<Record<string, unknown>> {
  logProgress("verify.started", { packet_dir: packetDir })
  await chmod(verifyScript, 0o755)
  const started = new Date()
  const proc = Bun.spawn([verifyScript, packetDir], {
    cwd: stackRoot,
    stdout: "pipe",
    stderr: "pipe",
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

function armResult(
  arm: "A" | "B",
  label: string,
  replicate: number,
  packet: Packet,
  segments: SegmentResult[],
  verify: Record<string, unknown>,
  started: Date,
  finished: Date,
): ArmResult {
  const usage = sumUsage(segments.map((segment) => segment.usage))
  const failed = segments.some((segment) => segment.returncode !== 0)
  const valid = !failed && verify.exit_code === 0 && typeof verify.harbor_reward === "number"
  const result: ArmResult = {
    arm,
    label,
    replicate,
    packet_dir: packet.proofPacketDir,
    work_packet_dir: packet.packetDir,
    workspace: packet.workspaceDir,
    segments,
    verify,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_sec: secondsBetween(started, finished),
    comparison_valid: valid,
    usage,
    cost_usd_estimate: estimateCost(segments),
  }
  logProgress("arm.completed", {
    arm,
    label,
    replicate,
    duration_sec: result.duration_sec,
    harbor_reward: verify.harbor_reward ?? null,
    cost_usd_estimate: result.cost_usd_estimate,
    comparison_valid: valid,
  })
  return result
}

function summarize(arms: ArmResult[]): Record<string, unknown> {
  const labels = [...new Set(arms.map((arm) => arm.label))].sort()
  return {
    by_arm: labels.map((label) => {
      const runs = arms.filter((arm) => arm.label === label)
      const valid = runs.filter((run) => run.comparison_valid)
      return {
        label,
        n: runs.length,
        comparison_valid_n: valid.length,
        comparison_invalid_n: runs.length - valid.length,
        verifier_success_rate: statRate(runs.map((run) => run.verify.exit_code === 0)),
        reward: stats(valid.map((run) => Number(run.verify.harbor_reward))),
        reward_all_valid_or_zero: stats(runs.map((run) => run.comparison_valid ? Number(run.verify.harbor_reward) : 0)),
        cost_usd_estimate: stats(valid.map((run) => run.cost_usd_estimate)),
        duration_sec: stats(valid.map((run) => run.duration_sec)),
      }
    }),
    completed_at: new Date().toISOString(),
  }
}

async function mirror(packet: Packet): Promise<void> {
  if (existsSync(packet.proofPacketDir)) await rm(packet.proofPacketDir, { recursive: true, force: true })
  await mkdir(dirname(packet.proofPacketDir), { recursive: true })
  await cp(packet.packetDir, packet.proofPacketDir, { recursive: true })
}

function parseUsageFromText(text: string): Usage | null {
  let usage: Usage | null = null
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      usage = readUsageEvent(parsed) ?? usage
    } catch {
      // ignore
    }
  }
  return usage
}

function readUsageEvent(value: unknown): Usage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if ((record.type === "event_msg" || record.type === "response_item") && record.payload) return readUsageEvent(record.payload)
  if (record.type === "turn.completed") return readUsageRecord(record.usage)
  if (record.type !== "token_count") return null
  const info = record.info && typeof record.info === "object" && !Array.isArray(record.info)
    ? record.info as Record<string, unknown>
    : {}
  return readUsageRecord(info.total_token_usage) ?? readUsageRecord(info.last_token_usage) ?? readUsageRecord(record.usage)
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

function readDeepSeekUsage(response: Record<string, unknown>): Usage | null {
  const usage = response.usage
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null
  const record = usage as Record<string, unknown>
  const details = record.completion_tokens_details && typeof record.completion_tokens_details === "object" && !Array.isArray(record.completion_tokens_details)
    ? record.completion_tokens_details as Record<string, unknown>
    : {}
  const hit = Number(record.prompt_cache_hit_tokens ?? 0)
  const miss = Number(record.prompt_cache_miss_tokens ?? 0)
  return {
    input_tokens: hit + miss || Number(record.prompt_tokens ?? 0),
    cached_input_tokens: hit,
    output_tokens: Number(record.completion_tokens ?? 0),
    reasoning_output_tokens: Number(details.reasoning_tokens ?? 0),
  }
}

function readDeepSeekContent(response: Record<string, unknown>): string {
  const choices = response.choices
  if (!Array.isArray(choices) || choices.length === 0) throw new Error("missing choices")
  const first = choices[0] as Record<string, unknown>
  const message = first.message as Record<string, unknown> | undefined
  if (typeof message?.content !== "string") throw new Error("missing content")
  return message.content
}

function sumUsage(values: Array<Usage | null>): Usage {
  return values.reduce((total, value) => {
    if (!value) return total
    total.input_tokens += value.input_tokens
    total.cached_input_tokens += value.cached_input_tokens
    total.output_tokens += value.output_tokens
    total.reasoning_output_tokens += value.reasoning_output_tokens
    return total
  }, { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 })
}

function estimateCost(segments: SegmentResult[]): number {
  let cost = 0
  for (const segment of segments) {
    if (!segment.usage) continue
    const cached = Math.min(segment.usage.cached_input_tokens, segment.usage.input_tokens)
    const uncached = Math.max(0, segment.usage.input_tokens - cached)
    if (segment.provider === "deepseek") {
      cost += (uncached * 0.435 + cached * 0.003625 + segment.usage.output_tokens * 0.87) / 1_000_000
    } else {
      cost += (uncached * 5.0 + cached * 0.5 + segment.usage.output_tokens * 30.0) / 1_000_000
    }
  }
  return round(cost, 6)
}

function stats(values: number[]): Record<string, number | null> {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length === 0) return { n: 0, mean: null, stdev: null, min: null, max: null }
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length
  return { n: clean.length, mean: round(mean, 4), stdev: round(Math.sqrt(variance), 4), min: round(Math.min(...clean), 4), max: round(Math.max(...clean), 4) }
}

function statRate(values: boolean[]): number | null {
  if (values.length === 0) return null
  return round(values.filter(Boolean).length / values.length, 4)
}

async function runInParallel<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next
      next += 1
      results[index] = await jobs[index]()
    }
  }))
  return results
}

async function loadSecret(name: string): Promise<string | undefined> {
  const direct = process.env[name]?.trim()
  if (direct) return direct
  const envPath = join(workspaceRoot, "synth-ai/.env")
  if (!existsSync(envPath)) return undefined
  const text = await readFile(envPath, "utf8")
  return text.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim()
}

function sanitizePrompt(value: string): string {
  return value
    .replace(/\0/g, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, 900_000)
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function logProgress(event: string, payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ type: "stack_sidekick_progress", event, at: new Date().toISOString(), ...payload }))
}

function secondsBetween(start: Date, end: Date): number {
  return round((end.getTime() - start.getTime()) / 1000, 1)
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function replicateLabel(replicate: number): string {
  return String(replicate).padStart(2, "0")
}
