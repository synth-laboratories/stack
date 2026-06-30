import { pushSkillContext, readStackSkill } from "./codex/skills.js"
import { appendThreadMetaEvent } from "./thread-events.js"

export type SkillSuggestEventType = "monitor.skill_context_push" | "gardener.skill_suggest"

export type SuggestSkillToThreadInput = {
  stackRoot: string
  threadId: string
  actorId: string
  actorRole: "monitor" | "gardener" | "system" | "primary"
  eventType: SkillSuggestEventType
  skillId: string
  reason: string
  targetActorId?: string
  evidenceEventIds?: string[]
  message?: string
  workspaceRoot?: string
}

export type SuggestSkillToThreadResult = {
  ok: boolean
  skillId?: string
  message?: string
  sourcePath?: string
  eventId?: string
  error?: string
}

/** Record a visible skill suggestion on a worker thread (monitor or gardener). */
export function suggestSkillToThread(input: SuggestSkillToThreadInput): SuggestSkillToThreadResult {
  const read = readStackSkill(input.stackRoot, input.skillId, { workspaceRoot: input.workspaceRoot, maxBytes: 1 })
  if (!read) {
    return { ok: false, error: `unknown skill: ${input.skillId}` }
  }

  try {
    const push = pushSkillContext(input.stackRoot, {
      threadId: input.threadId,
      monitorActorId: input.actorId,
      targetActorId: input.targetActorId ?? "primary_codex",
      skillId: read.skill.skillId,
      reason: input.reason,
      evidenceEventIds: input.evidenceEventIds ?? [],
      message: input.message,
      workspaceRoot: input.workspaceRoot,
    })
    appendThreadMetaEvent(input.stackRoot, {
      event_id: push.eventId,
      type: input.eventType,
      thread_id: push.threadId,
      observed_at: push.createdAt,
      actor_id: input.actorId,
      actor_role: input.actorRole === "gardener" ? "system" : input.actorRole,
      payload: {
        target_actor_id: push.targetActorId,
        skill_id: push.skillId,
        source_path: push.sourcePath,
        reason: push.reason,
        evidence_event_ids: push.evidenceEventIds,
        message_id: push.messageId,
        message: push.message,
        suggested_by: input.actorRole,
      },
    })
    return {
      ok: true,
      skillId: push.skillId,
      message: push.message,
      sourcePath: push.sourcePath,
      eventId: push.eventId,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function formatSkillSuggestionSteerMessage(skillId: string, message: string): string {
  return [`[gardener skill suggest: ${skillId}]`, message.trim()].filter(Boolean).join("\n")
}
