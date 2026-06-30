import type { StackMonitorSnapshot } from "../monitor.js"

export type SidecarQueueUiState = {
  monitorSnapshot: StackMonitorSnapshot
  sidecarChatInFlight?: boolean
  sidecarQueuedMessages?: readonly string[]
  spinnerFrame?: number
  status?: string
}

export function sidecarAgentActive(state: SidecarQueueUiState): boolean {
  return Boolean(state.sidecarChatInFlight) || state.monitorSnapshot.status === "running"
}

function spinner(frame: number): string {
  return ["|", "/", "-", "\\"][frame % 4] ?? "|"
}

export function sidecarInputStatusLine(state: SidecarQueueUiState): string {
  const workerRunning = state.status === "running"
  const queueCount = state.sidecarQueuedMessages?.length ?? 0
  const queueSuffix = queueCount > 0 ? ` · ${queueCount} queued` : ""
  const active = sidecarAgentActive(state)
  const spin = spinner(state.spinnerFrame ?? 0)

  if (active) {
    if (workerRunning) {
      return `Sidecar active ${spin} · worker running · esc peek${queueSuffix} · ctrl+enter send now`
    }
    return `Sidecar active ${spin} · reviewing${queueSuffix} · ctrl+enter send now`
  }
  if (workerRunning) {
    return `Worker running · esc worker peek · ask sidecar anytime${queueSuffix}`
  }
  if (queueCount > 0) {
    return `Sidecar idle · ${queueCount} queued · enter to wait or ctrl+enter send now`
  }
  return "Message sidecar · enter to send"
}
