import type { StackdMetaThreadManifest } from "./client/stackd.js"
import type { StackLocalSession, StackSessionHarness } from "./session.js"
import type { StackResumeCheckpoint } from "./resume-checkpoint.js"

export type HarnessResumePhase = "saved" | "restored" | "unavailable" | "fresh"

export type HarnessResumeState = {
  provider: StackSessionHarness | string
  backendSessionId?: string
  transport: "exec" | "app-server" | "acp" | string
  resumeMethod: "thread/resume" | "session/load" | "exec-transcript" | "fresh" | string
  resumePhase: HarnessResumePhase | string
}

export type MetaThreadCheckpointPhase =
  | "unbound"
  | "bound"
  | "goal_active"
  | "goal_paused"
  | "goal_blocked"
  | "goal_done"
  | "segment_sealed"

export type MetaThreadCheckpointState = {
  phase: MetaThreadCheckpointPhase
  metaThreadId?: string
  segmentId?: string
  headThreadId?: string
  goalStatus?: string
  goalObjective?: string
}

export function harnessResumeMethod(
  provider: string,
  transport: string,
  backendSessionId?: string,
): HarnessResumeState["resumeMethod"] {
  if (!backendSessionId) return "fresh"
  if (provider === "cursor") return "session/load"
  if (transport === "app-server") return "thread/resume"
  return "exec-transcript"
}

export function buildHarnessResumeState(input: {
  session: StackLocalSession
  transport: string
  backendSessionId?: string
  resumePhase?: HarnessResumePhase
}): HarnessResumeState {
  const provider = input.session.harness ?? "codex"
  const backendSessionId = input.backendSessionId ?? input.session.codexThreadId
  return {
    provider,
    backendSessionId,
    transport: input.transport,
    resumeMethod: harnessResumeMethod(provider, input.transport, backendSessionId),
    resumePhase: input.resumePhase ?? "saved",
  }
}

export function buildMetaThreadCheckpointState(
  session: StackLocalSession,
  manifest?: StackdMetaThreadManifest,
): MetaThreadCheckpointState {
  const metaThreadId = session.metaThreadId ?? manifest?.id
  const segmentId = session.segmentId ?? manifest?.head_segment_id
  const headThreadId = manifest?.head_thread_id ?? session.id

  if (!metaThreadId) {
    return { phase: "unbound" }
  }

  const headSegment = manifest?.segments?.find((segment) => segment.segmentId === manifest.head_segment_id)
  if (headSegment?.status === "sealed") {
    return {
      phase: "segment_sealed",
      metaThreadId,
      segmentId,
      headThreadId,
      goalStatus: manifest?.active_goal?.status,
      goalObjective: manifest?.active_goal?.objective,
    }
  }

  const goal = manifest?.active_goal
  if (!goal?.objective?.trim()) {
    return {
      phase: "bound",
      metaThreadId,
      segmentId,
      headThreadId,
    }
  }

  const status = goal.status?.trim().toLowerCase()
  let phase: MetaThreadCheckpointPhase = "goal_active"
  if (status === "paused") phase = "goal_paused"
  else if (status === "blocked") phase = "goal_blocked"
  else if (status === "done" || status === "cleared" || status === "completed") phase = "goal_done"

  return {
    phase,
    metaThreadId,
    segmentId,
    headThreadId,
    goalStatus: goal.status,
    goalObjective: goal.objective,
  }
}

export function enrichResumeCheckpoint(input: {
  checkpoint: StackResumeCheckpoint
  session: StackLocalSession
  manifest?: StackdMetaThreadManifest
  transport: string
  backendSessionId?: string
}): StackResumeCheckpoint {
  const backendSessionId =
    input.backendSessionId ??
    input.checkpoint.codexThreadId ??
    input.session.codexThreadId
  return {
    ...input.checkpoint,
    metaThreadId: input.checkpoint.metaThreadId ?? input.session.metaThreadId,
    segmentId: input.checkpoint.segmentId ?? input.session.segmentId,
    codexThreadId: backendSessionId,
    harness: input.checkpoint.harness ?? input.session.harness,
    harnessResume:
      input.checkpoint.harnessResume ??
      buildHarnessResumeState({
        session: input.session,
        transport: input.transport,
        backendSessionId,
      }),
    metaThreadState:
      input.checkpoint.metaThreadState ??
      buildMetaThreadCheckpointState(input.session, input.manifest),
  }
}

export function harnessBackendSessionId(checkpoint?: StackResumeCheckpoint): string | undefined {
  return checkpoint?.harnessResume?.backendSessionId ?? checkpoint?.codexThreadId
}

export async function resumeHarnessSession(
  session: HarnessSession | undefined,
  checkpoint?: StackResumeCheckpoint,
): Promise<{ backendSessionId?: string; resumePhase: HarnessResumePhase }> {
  if (!session) {
    return { resumePhase: checkpoint?.harnessResume?.backendSessionId ? "unavailable" : "fresh" }
  }
  try {
    await session.ensureReady()
    const backendSessionId = session.codexThreadId
    return { backendSessionId, resumePhase: backendSessionId ? "restored" : "fresh" }
  } catch {
    return { resumePhase: "unavailable" }
  }
}

type HarnessSession = {
  ensureReady(): Promise<void>
  codexThreadId?: string
}

export function metaThreadResumeLooksComplete(
  checkpoint: StackResumeCheckpoint,
  manifest?: StackdMetaThreadManifest,
): boolean {
  const state = checkpoint.metaThreadState
  if (!state || state.phase === "unbound") return false
  if (!checkpoint.metaThreadId) return false
  if (state.goalObjective && manifest?.active_goal?.objective !== state.goalObjective) return false
  if (manifest && manifest.id !== checkpoint.metaThreadId) return false
  return true
}
