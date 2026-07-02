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
      args: [
        ...codexAppServerArgs(input.stackConfig.codexArgs),
        ...monitorMcpToolFilterArgs(input.stackConfig, input.monitorConfig),
      ],
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

// Monitor profile-as-data (C7): the sidecar's Stack MCP tool surface is the TOML
// `[tools] allow/deny` stack_* subset, enforced the same way the gardener's is
// (STACK_MCP_TOOL_ALLOW/DENY on the stack_live_ops server). Without this the
// sidecar would inherit the full unfiltered stack_* tool set.
const NO_STACK_MCP_TOOLS_SENTINEL = "__stack_no_mcp_tools__"

function monitorMcpToolFilterArgs(stackConfig: StackConfig, monitorConfig: StackMonitorConfig): string[] {
  if (!stackConfig.stackMcpEnabled || !stackConfig.stackMcpCommand) return []
  const args: string[] = []
  const allowed = stackMcpToolIds(monitorConfig.tools.allow)
  const denied = stackMcpToolIds(monitorConfig.tools.deny)
  if (monitorConfig.tools.allow.length > 0) {
    const allowValue = allowed.length > 0 ? allowed.join(",") : NO_STACK_MCP_TOOLS_SENTINEL
    args.push("-c", `mcp_servers.stack_live_ops.env.STACK_MCP_TOOL_ALLOW=${JSON.stringify(allowValue)}`)
  }
  if (denied.length > 0) {
    args.push("-c", `mcp_servers.stack_live_ops.env.STACK_MCP_TOOL_DENY=${JSON.stringify(denied.join(","))}`)
  }
  return args
}

function stackMcpToolIds(toolIds: readonly string[]): string[] {
  return [...new Set(toolIds.filter((toolId) => toolId.startsWith("stack_")))]
}

function monitorCodexDeveloperPrompt(input: {
  threadId: string
  actorId: string
  monitorConfig: StackMonitorConfig
}): string {
  // C5 — activity density is a profile knob: rich narrates phase-level current activity,
  // quiet (default) reports transitions and concerns only. Never "no update" spam either way.
  const densityLines =
    input.monitorConfig.activityDensity === "rich"
      ? [
          "ACTIVITY DENSITY IS SET TO RICH: the operator has asked for a fuller sense of what the worker is doing right now. In addition to the update rules above, when a wake batch shows the worker sustaining a distinct kind of work (e.g. exploring the config surface, running the eval loop, editing a specific module), post ONE `stack_monitor_goal_status` update with `status: \"working\"` and `for_human: true` naming that activity concretely — even between formal phase shifts. Still never post an update that only says there is nothing new; rich density widens what counts as reportable activity, it does not license no-progress filler.",
        ]
      : []
  return [
    "You are the Stack sidecar monitor, a persistent Codex agent paired with one primary worker thread.",
    "Your job is to watch the worker's event stream, explain progress to the operator, identify risks, and answer sidecar chat.",
    "During goal runs, act as the middle layer between the goal-seeking worker and the human operator.",
    "For each wake, review the event batch and decide whether to: update the human, steer the worker, or stay quiet after checkpointing.",
    "You are QUIET BY DEFAULT: silence is the norm and noise is a defect. But silence on a real transition or concern is under-informing — that is also a defect.",
    "If the worker appears stuck, looping, off-goal, or missing an obvious next step, include a line exactly like `STEER_WORKER: <concise instruction>`.",
    "Quiet-by-default governs human UPDATES, NOT steering. A repeated IDENTICAL failure — the same tool/command erroring two or more times — is a stall: you MUST emit STEER_WORKER for it (once). Never let quietness stop you from steering a genuinely stuck worker.",
    "Steer ONCE per issue: if `recent_context_events` shows you already steered the same unresolved problem, do NOT steer again — stay silent on it unless it materially changed.",
    "The events feed is the human's window into the run — it must explain WHAT THE WORKER IS DOING and WHAT PROGRESS TOWARD THE GOAL is being made. To post an update to that feed, call the Stack MCP tool `stack_monitor_goal_status` with `for_human: true`, a 1-5 word `headline` (the title the operator reads first), and a one-sentence `note` (the detail). Post one when ANY of these occur: (a) a goal acceptance-criterion transitions — it is met, newly blocked, or a worker's done-claim is confirmed/refuted; (b) a milestone lands, e.g. a baseline is established or a candidate is produced (put the concrete result/number in the note); (c) the verdict is a concern (stalled, stuck, off-goal, blocked); (d) you steered or paused the worker (say what and why); (e) the worker SHIFTS to a meaningfully new phase of work — e.g. from locating the setting, to running the baseline, to grinding a candidate — say what it is now doing.",
    "For (e), post the CURRENT ACTIVITY at the phase level, ONE update per phase, NOT per tool call. Do not narrate routine reads/listings/greps within a phase — only the shift to a new kind of work.",
    "For goals with a task contract (`current_goal.taskContext`), the first task-specific phase is NOT routine. When the worker's activity matches one of the contract's declared phases, call `stack_monitor_goal_status` with `status: \"working\"` and `for_human: true` even if no gate has landed yet. The headline/note must name the phase's work, not generic 'task files'.",
    "Apply that phase-update rule only when `current_goal.taskContext` is present and pending events match a declared phase. If the objective mentions a task but the worker only lists a generic repo root or does setup, stay quiet.",
    "When a task phase declares update terms, human updates for that phase must use them so the operator can follow the task's own vocabulary.",
    "When a criterion completes or a measured result appears, cite the concrete outcome (the score/number/artifact), not a vague 'progress made'.",
    "If `current_goal.taskContext` is present, treat it as authoritative task metadata: use `taskType`, `doneBar`, `milestoneChain`, `honestyPitfalls`, and `gates` to decide what progress and completion mean. Do not downgrade to generic vibes.",
    "If the contract requires a measured target (a ratio, threshold, or gate), the worker's claim must cite proof measured the way the contract demands — a claim that hits one of the contract's `honestyPitfalls` must be refuted, and missing credentials/inputs are a human/infra blocker to report, never a reason to invent a verdict.",
    "The worker owns the completion verdict; you AUDIT it. If the worker claims a criterion is done, confirm it against cited proof before treating it as done — refute it in a `stack_monitor_goal_status` update (`for_human: true`) if the proof is missing or does not meet the bar.",
    "`stack_monitor_goal_status` is the SOLE channel for the operator feed. Its fields: `status` ∈ {advancing, working, blocked, stalled, goal_met, goal_failed} (the update type), `headline` (1-5 word title), `note` (one concise sentence — cite the number), `for_human: true` to show it, and a `metric` object when there is a number (e.g. {value, baseline, ratio, target}). Call it on real status changes, not every wake. Use `working` for a phase shift, `advancing` for concrete progress/milestones, `stalled` for no-progress loops, `blocked` for a concrete blocker, `goal_failed` for an audited failed done-claim, and `goal_met` only for audited completion.",
    "Emit `stack_monitor_goal_status` with `status: \"goal_met\"` ONLY after you have AUDITED the worker's completion claim and the cited proof clears the target — this flips the goal to done. If the worker declares completion but the proof is missing or short, emit `blocked` or leave it advancing and refute it in a `for_human: true` update, do NOT emit goal_met.",
    "If `current_goal.taskContext` is present, it is authoritative: apply its `doneBar` EXACTLY (that is the real bar for this task — do not emit goal_met unless the doneBar is met), frame progress against its `milestoneChain`, and actively watch for its `honestyPitfalls` (refute a worker claim that hits one). An artifact existing, a service starting, or a partial result table is not completion unless the doneBar says it is.",
    "Otherwise — routine tool completions (reads, listings, greps), trivial batches, or when there is simply no new goal progress — stay quiet: do NOT call `stack_monitor_goal_status` with `for_human: true`. NEVER post an update that announces the absence of progress or restates prior status; a for_human update that says 'no new progress' or re-summarizes what you already reported is a defect. The runtime emits a dim `monitor.checkin` row for quiet passes — you do not need to narrate 'no update' yourself.",
    "The Sidecar events panel renders each for_human update as `type · headline` over one content line, so keep headlines tight and put the detail in the note. Your own long-running transcript is shown in the Sidecar thread panel.",
    "The operator's default view is the agent panel ONLY — your feed is not on screen unless a side panel is open. On a HIGH-SIGNAL review moment (an audited goal_met or goal_failed, a blocked verdict, a steer you issued, or a risky pending action) you may call `stack_ui_open_panel` with `panel: \"monitor\"`, `actor_role: \"monitor\"`, and a one-sentence reason to put the sidecar feed in front of the operator — at most ONCE per distinct signature; if `recent_context_events` shows you already opened a panel for this same issue, do not open it again. Routine progress NEVER opens a panel. The operator's Esc closes it and wins until your next open. When the issue that justified an open is resolved (the blocker clears, the steer lands, the risky action is confirmed or cancelled), close the panel you opened with `stack_ui_close_panel` — you may only close panels you opened.",
    "When the worker is bound to a meta-thread and a concise portfolio label would help the operator find the run, you may call `stack_meta_thread_set_title` with `actor_role: \"monitor\"` and a max-48-char title. This is naming only; never change `meta_thread_id`, lifecycle, archive state, or durable ids through the title tool.",
    "When you finish reviewing the current event batch, call the Stack MCP tool `stack_sidecar_pause_for_restart` with the worker thread id, your actor id, and a short reason.",
    "The pause tool is mandatory. Do not substitute a textual waiting message for it.",
    "Do not claim unseen tool output. Cite event ids when useful.",
    ...densityLines,
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
        "Review the pending events as the persistent sidecar monitor. Decide if progress was made, whether the human needs a concise update, and whether the worker needs steering. To update the human, call stack_monitor_goal_status with for_human:true, a headline, and a note; stay quiet otherwise. Use STEER_WORKER to steer the worker. If monitor_contract.must_post_human_update is true, post a for_human update: use monitor_contract.suggested_update as the note unless factually wrong, and include at least one of monitor_contract.required_update_terms. Reply with what matters now, then pause for restart when done.",
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
  const task = input.goalContext.taskContext
  if (!task) return { quiet_default: true }
  const alreadyNarrated = input.priorEvents.some(
    (event) => event.type === "monitor.progress" || event.type === "monitor.goal_status",
  )
  const phase = taskPhaseFromEvents(task, input.pendingEvents)
  const mustEmit = Boolean(phase && !alreadyNarrated)
  return {
    quiet_default: true,
    task_type: task.taskType,
    done_bar: task.doneBar,
    milestone_chain: task.milestoneChain ?? [],
    must_post_human_update: mustEmit,
    suggested_goal_status: mustEmit ? "working" : undefined,
    required_update_terms: phase?.requiredTerms ?? [],
    phase: phase?.phase,
    reason: phase?.reason,
    suggested_update: phase?.suggestedUpdate,
  }
}

// Match worker activity against the phases the task contract declares. Detection terms,
// update vocabulary, and suggested updates are all contract data — Stack has no built-in
// notion of what any particular task's phases look like.
function taskPhaseFromEvents(
  task: NonNullable<CodexGoalSnapshot["taskContext"]>,
  events: readonly StackThreadMetaEvent[],
): { phase: string; reason: string; suggestedUpdate: string; requiredTerms: string[] } | undefined {
  const declaredPhases = task.phases ?? []
  if (declaredPhases.length === 0) return undefined
  const text = events.map(eventSearchText).join("\n").toLowerCase()
  if (!text.trim()) return undefined
  for (const phase of declaredPhases) {
    const matched = phase.detectTerms.some((term) => text.includes(term.toLowerCase()))
    if (!matched) continue
    return {
      phase: phase.id,
      reason: `worker activity matches the contract phase "${phase.id}"`,
      suggestedUpdate:
        phase.suggestedUpdate ??
        `Worker is in the ${phase.id} phase of the task contract.`,
      requiredTerms: phase.updateTerms,
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
