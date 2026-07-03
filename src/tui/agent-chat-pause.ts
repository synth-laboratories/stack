export type AgentChatPauseContext = {
  status: "idle" | "running" | "error"
  focusMode: string
  agentChatPaused?: boolean
}

export function agentChatPauseEligible(state: AgentChatPauseContext): boolean {
  return state.status === "running" && state.focusMode === "agent"
}

export function agentChatPauseInstructions(paused: boolean): string {
  if (paused) {
    return "paused · j/k scroll · Enter steer · ctrl+enter queue · Esc stop turn · type to draft"
  }
  return "Esc pause"
}

export function agentChatRunningInputLine(spinner: string, extras = ""): string {
  return `› running ${spinner}${extras}`
}

export function agentChatPauseInputLine(paused: boolean): string {
  return paused ? "› paused" : ""
}
