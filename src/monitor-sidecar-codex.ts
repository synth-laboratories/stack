import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type { StackConfig } from "./config.js"
import type { CodexGoalSnapshot } from "./codex/goal-context.js"
import {
  CodexAppServerClient,
  codexAppServerArgs,
  extractThreadId,
  type JsonRpcNotification,
  type JsonRpcServerRequest,
} from "./codex/app-server-client.js"
import { autoApproveServerRequest, CodexAppServerEventBridge } from "./codex/app-server-bridge.js"
import type { StackMonitorConfig } from "./monitor.js"
import type { StackCodexUsage } from "./session.js"
import { stackVersion } from "./version.js"
import type { StackThreadMetaEvent } from "./thread-events.js"

export type StackMonitorSidecarTurn = {
  id: string
  prompt: string
  startedAt: string
  finishedAt?: string
  exitCode?: number
  stdout: string
  stderr: string
  codexThreadId?: string
  usage?: StackCodexUsage
}

export type StackMonitorSidecarTranscript = {
  schema: "stack/monitor-sidecar-transcript/v1"
  threadId: string
  actorId: string
  codexThreadId?: string
  turns: StackMonitorSidecarTurn[]
}

export type MonitorCodexSidecarRunResult = {
  turn: StackMonitorSidecarTurn
  codexThreadId: string
  assistantText?: string
  usage?: StackCodexUsage
}

export function monitorSidecarTranscriptPath(stackRoot: string, threadId: string, actorId: string): string {
  return join(
    stackRoot,
    ".stack",
    "actors",
    safePathSegment(threadId),
    "monitors",
    `${safePathSegment(actorId)}.codex.json`,
  )
}

export function readMonitorSidecarTranscript(
  stackRoot: string,
  threadId: string,
  actorId: string,
): StackMonitorSidecarTranscript | undefined {
  const path = monitorSidecarTranscriptPath(stackRoot, threadId, actorId)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StackMonitorSidecarTranscript
    if (parsed?.schema !== "stack/monitor-sidecar-transcript/v1") return undefined
    if (parsed.threadId !== threadId || parsed.actorId !== actorId) return undefined
    parsed.turns ??= []
    return parsed
  } catch {
    return undefined
  }
}

export function writeMonitorSidecarTranscript(stackRoot: string, transcript: StackMonitorSidecarTranscript): string {
  const path = monitorSidecarTranscriptPath(stackRoot, transcript.threadId, transcript.actorId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(transcript, null, 2)}\n`, "utf8")
  return path
}

export function appendMonitorSidecarTurn(input: {
  stackRoot: string
  threadId: string
  actorId: string
  codexThreadId?: string
  turn: StackMonitorSidecarTurn
}): StackMonitorSidecarTranscript {
  const existing = readMonitorSidecarTranscript(input.stackRoot, input.threadId, input.actorId)
  const transcript: StackMonitorSidecarTranscript = existing ?? {
    schema: "stack/monitor-sidecar-transcript/v1",
    threadId: input.threadId,
    actorId: input.actorId,
    codexThreadId: input.codexThreadId,
    turns: [],
  }
  transcript.codexThreadId = input.codexThreadId ?? transcript.codexThreadId
  transcript.turns.push(input.turn)
  writeMonitorSidecarTranscript(input.stackRoot, transcript)
  return transcript
}

export async function runMonitorCodexSidecarTurn(input: {
  stackConfig: StackConfig
  monitorConfig: StackMonitorConfig
  threadId: string
  actorId: string
  codexThreadId?: string
  wakeId: string
  wakeReason: string
  triggerEventIds: string[]
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  goalContext: CodexGoalSnapshot
}): Promise<MonitorCodexSidecarRunResult> {
  return runMonitorCodexSidecarPrompt({
    stackConfig: input.stackConfig,
    monitorConfig: input.monitorConfig,
    threadId: input.threadId,
    actorId: input.actorId,
    codexThreadId: input.codexThreadId,
    prompt: monitorCodexWakePrompt(input),
  })
}

export async function runMonitorCodexSidecarChatTurn(input: {
  stackConfig: StackConfig
  monitorConfig: StackMonitorConfig
  threadId: string
  actorId: string
  codexThreadId?: string
  question: string
  requestEventId: string
  goalContext: CodexGoalSnapshot
  sidecarContext: Record<string, unknown>
}): Promise<MonitorCodexSidecarRunResult> {
  return runMonitorCodexSidecarPrompt({
    stackConfig: input.stackConfig,
    monitorConfig: input.monitorConfig,
    threadId: input.threadId,
    actorId: input.actorId,
    codexThreadId: input.codexThreadId,
    prompt: monitorCodexChatPrompt(input),
  })
}

async function runMonitorCodexSidecarPrompt(input: {
  stackConfig: StackConfig
  monitorConfig: StackMonitorConfig
  threadId: string
  actorId: string
  codexThreadId?: string
  prompt: string
}): Promise<MonitorCodexSidecarRunResult> {
  const startedAt = new Date().toISOString()
  const bridge = new CodexAppServerEventBridge()
  let stdout = ""
  let stderr = ""
  let codexThreadId = input.codexThreadId
  const client = await CodexAppServerClient.start({
    launch: {
      command: input.stackConfig.codexCommand,
      args: codexAppServerArgs(input.stackConfig.codexArgs),
      cwd: input.stackConfig.workspaceRoot,
    },
    clientName: "stack-sidecar",
    clientTitle: "Stack Sidecar Monitor",
    clientVersion: stackVersion(input.stackConfig.appRoot),
    onNotification(message: JsonRpcNotification) {
      const line = bridge.toExecJsonl(message)
      if (line) stdout += `${line}\n`
    },
    onServerRequest(message: JsonRpcServerRequest) {
      stdout += `${JSON.stringify({ type: "stack", message: `sidecar codex request: ${message.method}` })}\n`
      return Promise.resolve(autoApproveServerRequest(message.method, message.params))
    },
  })
  try {
    if (codexThreadId) {
      await client.request("thread/resume", { threadId: codexThreadId })
    } else {
      const started = await client.request("thread/start", {
        model: input.monitorConfig.model.model || input.stackConfig.codexModel,
        cwd: input.stackConfig.workspaceRoot,
        developerInstructions: monitorCodexDeveloperPrompt(input),
        serviceName: "stack-sidecar",
        approvalPolicy: "never",
      })
      codexThreadId = extractThreadIdFromResult(started)
      if (!codexThreadId) {
        throw new Error(`sidecar thread/start missing thread id: ${JSON.stringify(started)}`)
      }
      stdout += `${JSON.stringify({ type: "thread.started", thread_id: codexThreadId })}\n`
    }
    const turnId = await client.startTurn({
      threadId: codexThreadId,
      cwd: input.stackConfig.workspaceRoot,
      model: input.monitorConfig.model.model || input.stackConfig.codexModel,
      effort: input.monitorConfig.model.reasoningEffort,
      input: textTurnInput(input.prompt),
    })
    const final = await client.waitForTurnEnd(turnId, sidecarTurnTimeoutMs())
    const exitCode = final.method === "turn/completed" ? 0 : 1
    const usage = readUsageFromStdout(stdout)
    const turn: StackMonitorSidecarTurn = {
      id: randomUUID(),
      prompt: input.prompt,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      stdout,
      stderr,
      codexThreadId,
      usage,
    }
    appendMonitorSidecarTurn({
      stackRoot: input.stackConfig.stackDataRoot,
      threadId: input.threadId,
      actorId: input.actorId,
      codexThreadId,
      turn,
    })
    return {
      turn,
      codexThreadId,
      assistantText: extractLastAgentMessage(stdout),
      usage,
    }
  } catch (error) {
    stderr = error instanceof Error ? error.stack ?? error.message : String(error)
    if (codexThreadId) {
      appendMonitorSidecarTurn({
        stackRoot: input.stackConfig.stackDataRoot,
        threadId: input.threadId,
        actorId: input.actorId,
        codexThreadId,
        turn: {
          id: randomUUID(),
          prompt: input.prompt,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode: 1,
          stdout,
          stderr,
          codexThreadId,
        },
      })
    }
    throw error
  } finally {
    await client.close().catch(() => undefined)
  }
}

function monitorCodexDeveloperPrompt(input: {
  threadId: string
  actorId: string
}): string {
  return [
    "You are the Stack sidecar monitor, a persistent Codex agent paired with one primary worker thread.",
    "Your job is to watch the worker's event stream, explain progress to the operator, identify risks, and answer sidecar chat.",
    "During goal runs, act as the middle layer between the goal-seeking worker and the human operator.",
    "For each wake, review the event batch and decide whether to: update the human, steer the worker, or stay quiet after checkpointing.",
    "You are QUIET BY DEFAULT: silence is the norm and noise is a defect. But silence on a real transition or concern is under-informing — that is also a defect.",
    "If the worker appears stuck, looping, off-goal, or missing an obvious next step, include a line exactly like `STEER_WORKER: <concise instruction>`.",
    "Quiet-by-default governs human UPDATES, NOT steering. A repeated IDENTICAL failure — the same tool/command erroring two or more times — is a stall: you MUST emit STEER_WORKER for it (once). Never let quietness stop you from steering a genuinely stuck worker.",
    "Steer ONCE per issue: if `recent_context_events` shows you already steered the same unresolved problem, do NOT steer again — stay silent on it unless it materially changed.",
    "The events feed is the human's window into the run — it must explain WHAT THE WORKER IS DOING and WHAT PROGRESS TOWARD THE GOAL is being made. Emit a line exactly like `PROGRESS_UPDATE: <concise update>` when ANY of these occur: (a) a goal acceptance-criterion transitions — it is met, newly blocked, or a worker's done-claim is confirmed/refuted; (b) a milestone lands, e.g. a baseline is established or a candidate is produced (report the concrete result/number); (c) the verdict is a concern (stalled, stuck, off-goal, blocked); (d) you steered or paused the worker (say what and why); (e) the worker SHIFTS to a meaningfully new phase of work — e.g. from locating the setting, to running the baseline, to grinding a candidate — say what it is now doing.",
    "For (e), narrate the CURRENT ACTIVITY at the phase level, ONE line per phase, NOT per tool call. Do not narrate routine reads/listings/greps within a phase — only the shift to a new kind of work.",
    "For GameBench goals, the first task-specific phase is NOT routine. When the worker reads lane instructions/contracts, finds trace files, inspects staged artifacts, starts baseline/scoring, or starts scenario/parity work, emit `PROGRESS_UPDATE` plus `stack_monitor_goal_status` with `working` even if no gate has landed yet. The update must name the task type's work, not generic 'task files'.",
    "For GameBench policy_opt, updates must mention policy/baseline/candidate/score/leaderboard as applicable. For engine_rebuild, updates must mention engine/scenario/parity/canonical score as applicable. For puzzle_diagnosis, updates must mention trace/diagnosis/verifier as applicable.",
    "For GameBench puzzle_diagnosis specifically, reading TASK_INSTRUCTIONS, verifier rubrics, diagnosis artifacts, or trace files is milestone work: report that the worker is in trace-backed diagnosis, and keep goal_met impossible until the verifier pass exists.",
    "When a criterion completes or a baseline/candidate result appears, cite the concrete outcome (the score/number/artifact), not a vague 'progress made'.",
    "If `current_goal.gamebenchTask` is present, treat it as authoritative task metadata: use `taskType`, `doneBar`, `milestoneChain`, `honestyPitfalls`, and `gates` to decide what progress and completion mean. Do not downgrade to generic vibes.",
    "GameBench policy_opt: baseline and candidate scores must be on the same requested suite; a user-requested 2x candidate requires ratio >= 2 even if the ReportBench low pass threshold only requires positive score/best policy.",
    "GameBench engine_rebuild: service startup, local smoke, or a partial table is not done. Completion requires canonical Harbor/ReportBench evidence clearing all required strict gates such as perfect reward, scenario count, resolved rate, NEV, and public state.",
    "GameBench puzzle_diagnosis: diagnosis.json or a written hypothesis is only a milestone. Completion requires the judge/verifier pass gate; if verifier credentials/traces are missing, inform the human and steer without inventing a verdict.",
    "The worker owns the completion verdict; you AUDIT it. If the worker claims a criterion is done, confirm it against cited proof before treating it as done — refute in a PROGRESS_UPDATE if the proof is missing or does not meet the bar.",
    "In ADDITION to the PROGRESS_UPDATE prose, record a STRUCTURED signal the UI visualizes: call the Stack MCP tool `stack_monitor_goal_status` with `status` ∈ {advancing, working, blocked, stalled, goal_met, goal_failed}, a one-sentence `note`, and a `metric` object when there is a number (e.g. {value, baseline, ratio, target}). Call it on real status changes, not every wake.",
    "Hard invariant for goal runs: if you emit `PROGRESS_UPDATE`, you MUST call `stack_monitor_goal_status` in the same wake before pausing. Use `working` for a phase shift, `advancing` for concrete progress/milestones, `stalled` for no-progress loops, `blocked` for a concrete blocker, `goal_failed` for an audited failed done-claim, and `goal_met` only for audited completion.",
    "Emit `stack_monitor_goal_status` with `status: \"goal_met\"` ONLY after you have AUDITED the worker's completion claim and the cited proof clears the target — this flips the goal to done. If the worker declares completion but the proof is missing or short, emit `blocked` or leave it advancing and refute in a PROGRESS_UPDATE, do NOT emit goal_met.",
    "If `current_goal.gamebenchTask` is present, it is authoritative: apply its `doneBar` EXACTLY (that is the real bar for this task type — do not emit goal_met unless the doneBar is met), frame progress against its `milestoneChain`, and actively watch for its `honestyPitfalls` (refute a worker claim that hits one). E.g. engine-rebuild is NOT done at 'service up' — it needs the canonical all-scenarios score of 1.0; puzzle-diagnosis is NOT done when diagnosis.json merely exists — it needs the verifier verdict.",
    "Otherwise — routine tool completions (reads, listings, greps), trivial batches, or when there is simply no new goal progress — reply with EXACTLY `NO_USER_UPDATE` and nothing else. NEVER announce the absence of progress and NEVER restate prior status; a PROGRESS_UPDATE that says 'no new progress' or re-summarizes what you already reported is a defect.",
    "The left Sidecar progress panel shows raw events. Your own long-running transcript is shown in the Sidecar thread panel.",
    "When you finish reviewing the current event batch, call the Stack MCP tool `stack_sidecar_pause_for_restart` with the worker thread id, your actor id, and a short reason.",
    "The pause tool is mandatory. Do not substitute a textual waiting message for it.",
    "Do not claim unseen tool output. Cite event ids when useful.",
    `Worker thread id: ${input.threadId}`,
    `Sidecar actor id: ${input.actorId}`,
  ].join("\n")
}

function monitorCodexWakePrompt(input: {
  wakeId: string
  wakeReason: string
  triggerEventIds: string[]
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  goalContext: CodexGoalSnapshot
}): string {
  return JSON.stringify(
    {
      wake_id: input.wakeId,
      wake_reason: input.wakeReason,
      trigger_event_ids: input.triggerEventIds,
      current_goal: input.goalContext,
      monitor_contract: monitorWakeContract(input),
      pending_events: input.pendingEvents.map(serializableEvent),
      recent_context_events: input.priorEvents.slice(-20).map(serializableEvent),
      instruction:
        "Review the pending events as the persistent sidecar monitor. Decide if progress was made, whether the human needs a concise update, and whether the worker needs steering. Use PROGRESS_UPDATE/NO_USER_UPDATE and STEER_WORKER when applicable. If monitor_contract.must_emit_progress_update is true, do not reply NO_USER_UPDATE; use monitor_contract.suggested_update unless factually wrong, include at least one of monitor_contract.required_update_terms, and call stack_monitor_goal_status. Reply with what matters now, then pause for restart when done.",
    },
    null,
    2,
  )
}

function monitorWakeContract(input: {
  priorEvents: StackThreadMetaEvent[]
  pendingEvents: StackThreadMetaEvent[]
  goalContext: CodexGoalSnapshot
}): Record<string, unknown> {
  const task = input.goalContext.gamebenchTask
  if (!task) return { quiet_default: true }
  const alreadyNarrated = input.priorEvents.some(
    (event) => event.type === "monitor.progress" || event.type === "monitor.goal_status",
  )
  const phase = gamebenchPhaseFromEvents(task.taskType, input.pendingEvents)
  const mustEmit = Boolean(phase && !alreadyNarrated)
  return {
    quiet_default: true,
    gamebench_task_type: task.taskType,
    done_bar: task.doneBar,
    milestone_chain: task.milestoneChain ?? [],
    must_emit_progress_update: mustEmit,
    must_call_goal_status_if_progress_update: true,
    suggested_goal_status: mustEmit ? "working" : undefined,
    required_update_terms: phase?.requiredTerms ?? [],
    phase: phase?.phase,
    reason: phase?.reason,
    suggested_update: phase?.suggestedUpdate,
  }
}

function gamebenchPhaseFromEvents(
  taskType: NonNullable<CodexGoalSnapshot["gamebenchTask"]>["taskType"],
  events: readonly StackThreadMetaEvent[],
): { phase: string; reason: string; suggestedUpdate: string; requiredTerms: string[] } | undefined {
  const text = events.map(eventSearchText).join("\n").toLowerCase()
  if (!text.trim()) return undefined
  if (taskType === "puzzle_diagnosis") {
    if (/\b(task_instructions|verifier_rubric|rubric|task_contract|trace|traces|diagnosis|verifier_review|workproduct|puzzle_)/i.test(text)) {
      return {
        phase: "trace-backed diagnosis",
        reason: "worker is reading puzzle instructions, traces, or diagnosis/verifier artifacts",
        suggestedUpdate:
          "Worker is in the puzzle diagnosis phase: reading the lane instructions/traces/artifacts to build or audit a trace-backed causal hypothesis.",
        requiredTerms: ["trace", "diagnosis", "verifier"],
      }
    }
  }
  if (taskType === "policy_opt") {
    if (/\b(task_instructions|baseline|candidate|leaderboard|policy|score|hillclimb|run_policy|reportbench_output)/i.test(text)) {
      return {
        phase: "policy optimization evidence gathering",
        reason: "worker is locating the policy lane, baseline, candidate, or leaderboard evidence",
        suggestedUpdate:
          "Worker is in the policy-optimization phase: locating the lane evidence and preparing to compare baseline and candidate scores.",
        requiredTerms: ["policy", "baseline", "candidate", "score", "leaderboard"],
      }
    }
  }
  if (taskType === "engine_rebuild") {
    if (/\b(task_instructions|scenario|harbor|engine|service|reward|nev|public_state|resolved|parity)/i.test(text)) {
      return {
        phase: "engine rebuild parity work",
        reason: "worker is reading engine instructions or scenario/parity evidence",
        suggestedUpdate:
          "Worker is in the engine-rebuild phase: reading the specs/scenarios and looking for canonical parity evidence.",
        requiredTerms: ["engine", "scenario", "parity", "canonical", "score"],
      }
    }
  }
  if (/\b(task_instructions|reportbench|gamebench|score|artifact|workspace)/i.test(text)) {
    return {
      phase: "gamebench lane discovery",
      reason: "worker is reading GameBench lane files or artifacts",
      suggestedUpdate: "Worker is in GameBench lane discovery: reading task files and artifacts to establish the current milestone.",
      requiredTerms: ["GameBench", "lane", "artifact"],
    }
  }
  return undefined
}

function eventSearchText(event: StackThreadMetaEvent): string {
  const payload = event.payload as Record<string, unknown>
  const parts: string[] = [event.type]
  for (const key of ["text", "command", "output", "summary", "message", "note", "stdout", "stderr"]) {
    const value = payload[key]
    if (typeof value === "string") parts.push(value.slice(0, 2000))
  }
  return parts.join("\n")
}

function monitorCodexChatPrompt(input: {
  question: string
  requestEventId: string
  goalContext: CodexGoalSnapshot
  sidecarContext: Record<string, unknown>
}): string {
  return JSON.stringify(
    {
      wake_reason: "operator_message",
      request_event_id: input.requestEventId,
      operator_message: input.question,
      current_goal: input.goalContext,
      sidecar_context: input.sidecarContext,
      instruction:
        "Answer the operator in the persistent sidecar thread using the current goal and sidecar context. After answering, call stack_sidecar_pause_for_restart so the runtime can wake you again on the next event. Do not substitute a textual waiting message for that tool call.",
    },
    null,
    2,
  )
}

function serializableEvent(event: StackThreadMetaEvent): Record<string, unknown> {
  return {
    event_id: event.event_id,
    type: event.type,
    observed_at: event.observed_at,
    actor_role: event.actor_role,
    payload: event.payload,
  }
}

function textTurnInput(text: string): Array<{ type: "text"; text: string; text_elements: [] }> {
  return [{ type: "text", text, text_elements: [] }]
}

function extractThreadIdFromResult(result: unknown): string | undefined {
  const direct = extractThreadId({ jsonrpc: "2.0", method: "thread/started", params: result })
  if (direct) return direct
  if (!result || typeof result !== "object") return undefined
  const record = result as Record<string, unknown>
  const thread = record.thread
  if (thread && typeof thread === "object") {
    const id = (thread as Record<string, unknown>).id
    if (typeof id === "string" && id.length > 0) return id
  }
  const threadId = record.threadId
  return typeof threadId === "string" && threadId.length > 0 ? threadId : undefined
}

function extractLastAgentMessage(stdout: string): string | undefined {
  let latest: string | undefined
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type === "agent_message" && typeof parsed.text === "string" && parsed.text.trim()) {
        latest = parsed.text.trim()
      }
    } catch {
      continue
    }
  }
  return latest
}

function readUsageFromStdout(stdout: string): StackCodexUsage | undefined {
  let usage: StackCodexUsage | undefined
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.usage && typeof parsed.usage === "object") {
        const record = parsed.usage as Record<string, unknown>
        usage = {
          inputTokens: readNumber(record.input_tokens),
          cachedInputTokens: readNumber(record.cached_input_tokens),
          outputTokens: readNumber(record.output_tokens),
          reasoningOutputTokens: readNumber(record.reasoning_output_tokens),
        }
      }
    } catch {
      continue
    }
  }
  return usage
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function sidecarTurnTimeoutMs(): number {
  const raw = process.env.STACK_MONITOR_CODEX_TIMEOUT_MS
  if (!raw) return 900_000
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900_000
}

function safePathSegment(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
  if (!safe || safe === "." || safe === "..") throw new Error(`invalid path segment: ${value}`)
  return safe
}
