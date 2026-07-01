import { stackdCreateMetaThread, stackdUpdateMetaThreadGoal } from "../client/stackd.js"
import { harnessModel, isCursorHarness, type StackConfig } from "../config.js"
import { emptyGoalContext, mergeGoalContext, type CodexGoalSnapshot } from "../codex/goal-context.js"
import { CodexAppServerSession } from "../codex/app-server-session.js"
import {
  formatCodexGoalStatusFeedback,
  goalSnapshotFromCodexThreadGoal,
  parseGoalSlashArgs,
  type CodexThreadGoal,
  type GoalSlashAction,
} from "../codex/thread-goal.js"
import { CursorAcpSession } from "../cursor/acp-session.js"
import {
  buildGoalWorkerKickoffPrompt,
  buildHarnessGoalContextBlock,
  harnessGoalPayloadFromManifest,
  type HarnessGoalNotifyPayload,
} from "../harness/goal-notify.js"
import {
  applyCriteriaMutation,
  formatCriteriaListFeedback,
  formatCriteriaMutationFeedback,
} from "../meta-thread-goal-criteria.js"
import {
  appendGoalLifecycleEvent,
  shouldAppendGoalStarted,
} from "../goal-session.js"
import { enrichGameBenchGoalContext } from "../gamebench-goal.js"
import { mergeMetaThreadGoalContext, readMetaThreadManifest } from "../meta-thread-goal.js"
import { readThreadMetaEvents } from "../thread-events.js"
import { writeSessionLog, type StackLocalSession } from "../session.js"

export type GoalSlashRunContext = {
  config: StackConfig
  session: StackLocalSession
}

export type GoalSlashAppState = {
  goalContext: CodexGoalSnapshot
  metaThreadManifest?: import("../client/stackd.js").StackdMetaThreadManifest
  codexTransport: "app-server" | "exec" | "acp"
  goalPanelSelectedIndex?: number
}

type GoalSlashRefresh = () => void
type HarnessSession = CodexAppServerSession | CursorAcpSession

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function activeGoalObjective(state: GoalSlashAppState): string | undefined {
  return state.metaThreadManifest?.active_goal?.objective?.trim() ?? state.goalContext.objective?.trim()
}

function activeGoalCriteria(state: GoalSlashAppState): string[] {
  return state.metaThreadManifest?.active_goal?.acceptance_criteria ?? []
}

function activeGoalBlockers(state: GoalSlashAppState): string[] {
  return state.metaThreadManifest?.active_goal?.blockers ?? []
}

function activeGoalStatus(state: GoalSlashAppState): string {
  return state.metaThreadManifest?.active_goal?.status ?? state.goalContext.status ?? "active"
}

function applyThreadGoalToState(
  state: GoalSlashAppState,
  goal: CodexThreadGoal | null,
  cleared: boolean,
): void {
  if (cleared) {
    state.goalContext = mergeMetaThreadGoalContext(emptyGoalContext(), state.metaThreadManifest)
    return
  }
  if (!goal) return
  state.goalContext = mergeMetaThreadGoalContext(
    mergeGoalContext(state.goalContext, goalSnapshotFromCodexThreadGoal(goal)),
    state.metaThreadManifest,
  )
}

async function syncMetaThreadGoalPatch(
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  patch: {
    objective?: string
    status?: string
    acceptance_criteria?: string[]
    blockers?: string[]
  },
): Promise<void> {
  const metaThreadId = ctx.session.metaThreadId
  if (!metaThreadId) return
  const manifest = await stackdUpdateMetaThreadGoal(metaThreadId, patch)
  state.metaThreadManifest = manifest
  state.goalContext = mergeMetaThreadGoalContext(state.goalContext, manifest)
}

async function syncMetaThreadGoalFromObjective(
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  objective: string,
  status = "active",
): Promise<void> {
  const enriched = enrichGameBenchGoalContext(
    {
      objective,
      status,
      acceptanceCriteria: activeGoalCriteria(state),
      blockers: activeGoalBlockers(state),
      source: "meta_thread",
    },
    ctx.config.workspaceRoot,
  )
  await syncMetaThreadGoalPatch(ctx, state, {
    objective,
    status,
    acceptance_criteria: enriched.acceptanceCriteria ?? activeGoalCriteria(state),
    blockers: activeGoalBlockers(state),
  })
  state.goalContext = mergeGoalContext(state.goalContext, enriched)
}

async function syncMetaThreadGoalStatus(
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  status: string,
): Promise<void> {
  const objective = activeGoalObjective(state)
  if (!objective) return
  await syncMetaThreadGoalFromObjective(ctx, state, objective, status)
}

async function clearMetaThreadGoal(ctx: GoalSlashRunContext, state: GoalSlashAppState): Promise<void> {
  await syncMetaThreadGoalPatch(ctx, state, {
    objective: "",
    status: "cleared",
    acceptance_criteria: [],
    blockers: [],
  })
}

async function syncMetaThreadCriteria(
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  acceptanceCriteria: string[],
): Promise<void> {
  const objective = activeGoalObjective(state)
  if (!objective) {
    throw new Error("set a goal objective before editing criteria · /goal <objective>")
  }
  await syncMetaThreadGoalPatch(ctx, state, {
    objective,
    status: activeGoalStatus(state),
    acceptance_criteria: acceptanceCriteria,
    blockers: activeGoalBlockers(state),
  })
}

async function notifyHarnessGoalChange(
  harnessSession: HarnessSession | undefined,
  state: GoalSlashAppState,
  action: HarnessGoalNotifyPayload["action"],
): Promise<string | undefined> {
  const payload =
    action === "clear"
      ? { action, objective: "", status: "cleared", acceptanceCriteria: [], blockers: [] }
      : harnessGoalPayloadFromManifest(state.metaThreadManifest, action)
  if (!payload) return undefined
  if (harnessSession instanceof CursorAcpSession) {
    const result = await harnessSession.publishGoalUpdate(payload)
    if (result.channel === "acp-notify") return "cursor goal notify · acp"
    if (result.channel === "steer") return "cursor goal notify · steer"
    return "cursor goal notify · next turn"
  }
  return undefined
}

function formatMergedGoalFeedback(snapshot: CodexGoalSnapshot, config: StackConfig): string {
  const lines: string[] = []
  if (snapshot.objective) {
    lines.push(`goal ${snapshot.status ?? "active"}`)
    lines.push(snapshot.objective)
  } else {
    lines.push("no active goal")
  }
  if (isCursorHarness(config)) {
    lines.push("harness cursor · meta-thread goal when bound")
  } else {
    lines.push("harness codex · native thread/goal RPC")
  }
  if (!snapshot.objective) lines.push("next: /goal <objective>")
  return lines.join("\n")
}

async function runCodexGoalAction(
  session: CodexAppServerSession,
  action: GoalSlashAction,
): Promise<{ feedback: string; goal: CodexThreadGoal | null; cleared: boolean }> {
  switch (action.action) {
    case "panel":
    case "show": {
      const goal = await session.threadGoalGet()
      return { feedback: formatCodexGoalStatusFeedback(goal), goal, cleared: false }
    }
    case "set": {
      const goal = await session.threadGoalSet(action.objective)
      if (!goal) throw new Error("thread/goal/set returned no goal")
      return {
        feedback: [`goal set`, goal.objective, `status ${goal.status ?? "active"}`].join("\n"),
        goal,
        cleared: false,
      }
    }
    case "pause": {
      const goal = await session.threadGoalPause()
      if (!goal) throw new Error("thread/goal/pause failed")
      return { feedback: `goal paused\n${goal.objective}`, goal, cleared: false }
    }
    case "resume": {
      const goal = await session.threadGoalResume()
      if (!goal) throw new Error("thread/goal/resume failed")
      return { feedback: `goal resumed\n${goal.objective}`, goal, cleared: false }
    }
    case "clear": {
      await session.threadGoalClear()
      return { feedback: "goal cleared", goal: null, cleared: true }
    }
    default:
      throw new Error("unsupported codex goal action")
  }
}

function goalLifecycleSource(state: GoalSlashAppState, ctx: GoalSlashRunContext): "codex" | "manifest" | "operator" {
  if (ctx.session.metaThreadId && state.metaThreadManifest?.active_goal?.objective?.trim()) return "manifest"
  if (state.goalContext.source === "context" || state.goalContext.source === "meta_thread") {
    return state.goalContext.source === "meta_thread" ? "manifest" : "codex"
  }
  return "operator"
}

function recordGoalLifecycleEvent(
  ctx: GoalSlashRunContext,
  type: "goal.started" | "goal.paused" | "goal.resumed" | "goal.cleared",
  objective: string,
  source: "codex" | "manifest" | "operator",
  status?: string,
): void {
  if (!objective.trim()) return
  appendGoalLifecycleEvent({
    stackRoot: ctx.config.stackDataRoot,
    threadId: ctx.session.id,
    metaThreadId: ctx.session.metaThreadId,
    segmentId: ctx.session.segmentId,
    type,
    objective: objective.trim(),
    source,
    status,
  })
}

/**
 * Lift a goal registered directly on the underlying harness (native Codex
 * thread/goal RPC, or a Cursor-side goal) into a Stack meta-thread so it's
 * tracked the same way as a Stack-native `/goal set`. No-op if a meta-thread
 * is already bound — the caller is responsible for syncing further field
 * changes (objective/status edits) onto the existing meta-thread.
 */
async function ensureMetaThreadBound(
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  objective: string,
  status = "active",
): Promise<void> {
  if (ctx.session.metaThreadId) return
  const title = objective.length > 80 ? `${objective.slice(0, 77)}...` : objective
  const enriched = enrichGameBenchGoalContext({ objective, status, source: "meta_thread" }, ctx.config.workspaceRoot)
  const created = await stackdCreateMetaThread({
    title,
    thread_id: ctx.session.id,
    role: "implement",
    model: harnessModel(ctx.config),
    reasoning_effort: ctx.config.codexReasoningEffort,
    harness: ctx.config.harness,
    active_goal: { objective, status, acceptance_criteria: enriched.acceptanceCriteria ?? [], blockers: [] },
  })
  ctx.session.metaThreadId = created.id
  ctx.session.segmentId = created.head_segment_id
  ctx.session.segmentRole = "implement"
  state.metaThreadManifest = created
  state.goalContext = mergeGoalContext(mergeMetaThreadGoalContext(state.goalContext, created), enriched)
  await writeSessionLog(ctx.session, ctx.config.sessionLogDir, {
    codexModel: harnessModel(ctx.config),
    pricingRows: ctx.config.codexPricing,
  })
}

async function runMetaThreadGoalAction(
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  action: GoalSlashAction,
): Promise<string> {
  if (action.action === "set") {
    await ensureMetaThreadBound(ctx, state, action.objective)
  } else if (!ctx.session.metaThreadId) {
    if (action.action === "panel" || action.action === "show") {
      return "no active goal\nnext: /goal <objective>"
    }
    throw new Error("no active goal · start one with /goal <objective>")
  }

  const metaThreadId = ctx.session.metaThreadId
  if (!metaThreadId) {
    throw new Error("no meta-thread bound · start a goal-first session or use ChatGPT harness for native Codex goals")
  }

  switch (action.action) {
    case "panel":
    case "show": {
      const manifest = state.metaThreadManifest ?? (await readMetaThreadManifest(ctx.config.stackDataRoot, metaThreadId))
      state.metaThreadManifest = manifest
      const goal = manifest?.active_goal
      if (!goal?.objective?.trim()) return "no active goal\nnext: /goal <objective>"
      const lines = [`goal ${goal.status}`, goal.objective]
      if (goal.acceptance_criteria.length > 0) lines.push(formatCriteriaListFeedback(goal.acceptance_criteria))
      lines.push("next: /goal pause · /goal clear · Tab goal panel")
      return lines.join("\n")
    }
    case "set":
      await syncMetaThreadGoalFromObjective(ctx, state, action.objective)
      if (shouldAppendGoalStarted(readThreadMetaEvents(ctx.config.stackDataRoot, ctx.session.id), action.objective)) {
        recordGoalLifecycleEvent(ctx, "goal.started", action.objective, goalLifecycleSource(state, ctx), "active")
      }
      return `goal set\n${action.objective}`
    case "pause":
      await syncMetaThreadGoalStatus(ctx, state, "paused")
      if (activeGoalObjective(state)) {
        recordGoalLifecycleEvent(ctx, "goal.paused", activeGoalObjective(state)!, goalLifecycleSource(state, ctx), "paused")
      }
      return "goal paused"
    case "resume":
      await syncMetaThreadGoalStatus(ctx, state, "active")
      if (activeGoalObjective(state)) {
        recordGoalLifecycleEvent(ctx, "goal.resumed", activeGoalObjective(state)!, goalLifecycleSource(state, ctx), "active")
      }
      return "goal resumed"
    case "clear": {
      const objective = activeGoalObjective(state)
      if (objective) {
        recordGoalLifecycleEvent(ctx, "goal.cleared", objective, goalLifecycleSource(state, ctx), "cleared")
      }
      await clearMetaThreadGoal(ctx, state)
      return "goal cleared"
    }
    case "criteria_show":
      return formatCriteriaListFeedback(activeGoalCriteria(state))
    case "criteria_add": {
      const next = applyCriteriaMutation(activeGoalCriteria(state), { kind: "add", text: action.text })
      await syncMetaThreadCriteria(ctx, state, next)
      return formatCriteriaMutationFeedback("add", next)
    }
    case "criteria_toggle": {
      const next = applyCriteriaMutation(activeGoalCriteria(state), { kind: "toggle", index: action.index })
      await syncMetaThreadCriteria(ctx, state, next)
      return formatCriteriaMutationFeedback("toggle", next)
    }
    case "criteria_remove": {
      const next = applyCriteriaMutation(activeGoalCriteria(state), { kind: "remove", index: action.index })
      await syncMetaThreadCriteria(ctx, state, next)
      return formatCriteriaMutationFeedback("remove", next)
    }
    case "criteria_clear": {
      await syncMetaThreadCriteria(ctx, state, [])
      return formatCriteriaMutationFeedback("clear", [])
    }
  }
}

async function runCriteriaAction(
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  harnessSession: HarnessSession | undefined,
  action: GoalSlashAction,
): Promise<string> {
  if (!ctx.session.metaThreadId) {
    throw new Error("criteria require a bound meta-thread")
  }
  const message = await runMetaThreadGoalAction(ctx, state, action)
  const notify = await notifyHarnessGoalChange(harnessSession, state, "criteria")
  return notify ? `${message}\n${notify}` : message
}

function harnessNotifyActionForGoalAction(action: GoalSlashAction): HarnessGoalNotifyPayload["action"] | undefined {
  switch (action.action) {
    case "set":
      return "set"
    case "pause":
      return "pause"
    case "resume":
      return "resume"
    case "clear":
      return "clear"
    case "criteria_add":
    case "criteria_toggle":
    case "criteria_remove":
    case "criteria_clear":
      return "criteria"
    default:
      return undefined
  }
}

export async function runGoalPanelAction(
  action: "pause" | "resume" | "clear" | "toggle",
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  harnessSession: HarnessSession | undefined,
  selectedIndex: number,
  feedback: (message: string) => void,
  refresh: GoalSlashRefresh,
): Promise<void> {
  const goalAction: GoalSlashAction =
    action === "pause"
      ? { action: "pause" }
      : action === "resume"
        ? { action: "resume" }
        : action === "clear"
          ? { action: "clear" }
          : { action: "criteria_toggle", index: selectedIndex }

  try {
    const message = await runGoalSlashCommandInternal(
      goalAction,
      ctx,
      state,
      harnessSession instanceof CodexAppServerSession ? harnessSession : undefined,
      harnessSession,
    )
    feedback(message)
    refresh()
  } catch (error) {
    feedback(`goal failed: ${errorMessage(error)}`)
    refresh()
  }
}

export async function refreshGoalPanelState(
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  harnessSession: HarnessSession | undefined,
): Promise<void> {
  const metaThreadId = ctx.session.metaThreadId
  if (metaThreadId) {
    state.metaThreadManifest =
      state.metaThreadManifest ?? (await readMetaThreadManifest(ctx.config.stackDataRoot, metaThreadId))
  }
  if (
    !isCursorHarness(ctx.config) &&
    state.codexTransport === "app-server" &&
    harnessSession instanceof CodexAppServerSession
  ) {
    const goal = await harnessSession.threadGoalGet()
    applyThreadGoalToState(state, goal, false)
    if (goal?.objective) {
      // Codex may have registered this goal on its own mid-turn, with no
      // /goal command ever run — lift it into a meta-thread the first time
      // we observe it so it still gets Stack-side tracking.
      await ensureMetaThreadBound(ctx, state, goal.objective, goal.status ?? "active")
    }
  }
}

async function runGoalSlashCommandInternal(
  action: GoalSlashAction,
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  codexSession: CodexAppServerSession | undefined,
  harnessSession?: HarnessSession,
): Promise<string> {
  if (action.action.startsWith("criteria_")) {
    return runCriteriaAction(ctx, state, harnessSession, action)
  }

  if (
    !isCursorHarness(ctx.config) &&
    state.codexTransport === "app-server" &&
    codexSession instanceof CodexAppServerSession
  ) {
    const priorObjective = activeGoalObjective(state)
    const result = await runCodexGoalAction(codexSession, action)
    applyThreadGoalToState(state, result.goal, result.cleared)
    if (result.goal?.objective) {
      // Codex registered/updated this goal natively (thread/goal RPC) — lift
      // it into a Stack meta-thread so it gets the same tracking as a
      // Stack-native /goal set, instead of staying client-side only.
      await ensureMetaThreadBound(ctx, state, result.goal.objective, result.goal.status ?? "active")
    }
    if (ctx.session.metaThreadId) {
      if (action.action === "set") {
        await syncMetaThreadGoalFromObjective(ctx, state, action.objective)
        if (shouldAppendGoalStarted(readThreadMetaEvents(ctx.config.stackDataRoot, ctx.session.id), action.objective)) {
          recordGoalLifecycleEvent(ctx, "goal.started", action.objective, "codex", "active")
        }
      } else if (action.action === "pause") {
        await syncMetaThreadGoalStatus(ctx, state, "paused")
        if (priorObjective) {
          recordGoalLifecycleEvent(ctx, "goal.paused", priorObjective, "codex", "paused")
        }
      } else if (action.action === "resume") {
        await syncMetaThreadGoalStatus(ctx, state, "active")
        if (priorObjective) {
          recordGoalLifecycleEvent(ctx, "goal.resumed", priorObjective, "codex", "active")
        }
      } else if (action.action === "clear") {
        if (priorObjective) {
          recordGoalLifecycleEvent(ctx, "goal.cleared", priorObjective, "codex", "cleared")
        }
        await clearMetaThreadGoal(ctx, state)
      }
    } else {
      const source = "codex" as const
      const events = readThreadMetaEvents(ctx.config.stackDataRoot, ctx.session.id)
      if (action.action === "set") {
        if (shouldAppendGoalStarted(events, action.objective)) {
          recordGoalLifecycleEvent(ctx, "goal.started", action.objective, source, "active")
        }
      } else if (action.action === "pause" && priorObjective) {
        recordGoalLifecycleEvent(ctx, "goal.paused", priorObjective, source, "paused")
      } else if (action.action === "resume" && priorObjective) {
        recordGoalLifecycleEvent(ctx, "goal.resumed", priorObjective, source, "active")
      } else if (action.action === "clear" && priorObjective) {
        recordGoalLifecycleEvent(ctx, "goal.cleared", priorObjective, source, "cleared")
      }
    }
    const notifyAction = harnessNotifyActionForGoalAction(action)
    const notify =
      notifyAction && harnessSession instanceof CursorAcpSession
        ? await notifyHarnessGoalChange(harnessSession, state, notifyAction)
        : undefined
    return notify ? `${result.feedback}\n${notify}` : result.feedback
  }

  const message = await runMetaThreadGoalAction(ctx, state, action)
  const notifyAction = harnessNotifyActionForGoalAction(action)
  if (notifyAction && harnessSession) {
    const notify = await notifyHarnessGoalChange(harnessSession, state, notifyAction)
    return notify ? `${message}\n${notify}` : message
  }
  return message
}

export type GoalSlashCommandResult = {
  handled: boolean
  workerKickoffObjective?: string
}

function workerKickoffObjectiveForAction(
  action: GoalSlashAction,
  state: GoalSlashAppState,
): string | undefined {
  if (action.action === "set") {
    const objective = action.objective.trim()
    return objective || undefined
  }
  if (action.action === "resume") {
    return activeGoalObjective(state)?.trim() || undefined
  }
  return undefined
}

export async function runGoalSlashCommand(
  prompt: string,
  ctx: GoalSlashRunContext,
  state: GoalSlashAppState,
  codexSession: CodexAppServerSession | undefined,
  harnessSession: HarnessSession | undefined,
  refresh: GoalSlashRefresh,
  feedback: (message: string) => void,
): Promise<GoalSlashCommandResult> {
  const trimmed = prompt.trim()
  if (!trimmed.startsWith("/goal")) return { handled: false }
  const args = trimmed.slice("/goal".length).trim()
  const action = parseGoalSlashArgs(args)

  if (action.action === "panel") {
    return { handled: false }
  }

  try {
    const message = await runGoalSlashCommandInternal(action, ctx, state, codexSession, harnessSession)
    feedback(message)
    refresh()
    return {
      handled: true,
      workerKickoffObjective: workerKickoffObjectiveForAction(action, state),
    }
  } catch (error) {
    feedback(`goal failed: ${errorMessage(error)}`)
    refresh()
    return { handled: true }
  }
}

export function goalPanelNotifyPreview(state: GoalSlashAppState): string | undefined {
  const payload = harnessGoalPayloadFromManifest(state.metaThreadManifest, "criteria")
  return payload ? buildHarnessGoalContextBlock(payload) : undefined
}
