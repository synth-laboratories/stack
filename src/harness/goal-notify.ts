export type HarnessGoalNotifyPayload = {
  action: "set" | "pause" | "resume" | "clear" | "criteria"
  objective?: string
  status?: string
  acceptanceCriteria?: readonly string[]
  blockers?: readonly string[]
}

export type HarnessGoalNotifyResult = {
  channel: "acp-notify" | "steer" | "next-turn" | "none"
}

export function buildHarnessGoalContextBlock(payload: HarnessGoalNotifyPayload): string {
  const lines = ["<stack_internal_context source=\"goal\">"]
  if (payload.objective?.trim()) lines.push(`Objective: ${payload.objective.trim()}`)
  if (payload.status?.trim()) lines.push(`Status: ${payload.status.trim()}`)
  if (payload.acceptanceCriteria && payload.acceptanceCriteria.length > 0) {
    lines.push("Acceptance criteria:")
    for (const criterion of payload.acceptanceCriteria) {
      const normalized = criterion.trim()
      if (normalized) lines.push(`- ${normalized}`)
    }
  }
  if (payload.blockers && payload.blockers.length > 0) {
    lines.push("Blockers:")
    for (const blocker of payload.blockers) {
      const normalized = blocker.trim()
      if (normalized) lines.push(`- ${normalized}`)
    }
  }
  lines.push(`Action: ${payload.action}`)
  lines.push("</stack_internal_context>")
  return lines.join("\n")
}

export function buildGoalWorkerKickoffPrompt(payload: HarnessGoalNotifyPayload): string {
  const block = buildHarnessGoalContextBlock({ ...payload, action: "set" })
  return `${block}\n\nBegin executing the active goal now. Plan your first steps and start work.`
}

export function goalKickoffTranscriptLabel(objective: string): string {
  const trimmed = objective.trim()
  if (!trimmed) return "goal kickoff"
  return `goal kickoff · ${trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed}`
}

export function harnessGoalPayloadFromManifest(
  manifest: import("../client/stackd.js").StackdMetaThreadManifest | undefined,
  action: HarnessGoalNotifyPayload["action"],
): HarnessGoalNotifyPayload | undefined {
  const goal = manifest?.active_goal
  if (!goal?.objective?.trim() && action !== "clear") return undefined
  return {
    action,
    objective: goal?.objective?.trim(),
    status: goal?.status,
    acceptanceCriteria: goal?.acceptance_criteria ?? [],
    blockers: goal?.blockers ?? [],
  }
}
