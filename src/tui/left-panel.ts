import { agentRolePanelTitle } from "../agent-roles.js"
import { StyledText, fg, type TextChunk } from "@opentui/core"
import { basename } from "node:path"
import type { GardenerInboxItem } from "../gardener.js"
import { gardenerPanelLines } from "../gardener.js"
import type { RemoteAccountSnapshot } from "../remote/account.js"
import type { RemoteUsageSnapshot } from "../remote/usage.js"
import {
  subscriptionPanelLineCount,
  subscriptionPanelLines,
  type OpsPanelAgentUsage,
} from "./ops-panel.js"
import { renderThreadsRailStyled, type ThreadsRailRenderInput } from "./threads-rail.js"
import { stackTuiTheme as theme } from "./theme.js"

export type LeftPanelMode = "threads" | "account" | "gardener" | "bridge"

export type LeftPanelState = {
  leftPanelMode: LeftPanelMode
  leftPanelScrollOffset: number
}

export function leftPanelTitle(
  mode: LeftPanelMode,
  workspaceRoot: string,
  environmentName: string,
  liveOpsMode: "local" | "remote",
): string {
  if (mode === "account") return `Subscription · ${environmentName}`
  if (mode === "gardener") return agentRolePanelTitle("gardener")
  if (mode === "bridge") return `Bridge · ${liveOpsModeLabel(liveOpsMode)}`
  return basename(workspaceRoot) || workspaceRoot
}

export function leftPanelHint(mode: LeftPanelMode, focused: boolean): string {
  if (!focused) return "click or tab to focus · scroll"
  const next =
    mode === "threads"
      ? "account"
      : mode === "account"
        ? "gardener"
        : mode === "gardener"
          ? "bridge"
          : "threads"
  const scrollHint =
    mode === "threads"
      ? " · j/k sessions · n new · f fork · enter resume"
      : mode === "account"
        ? " · r refresh"
        : mode === "gardener"
          ? " · j/k inbox · w target · enter route · a route all · d dismiss"
          : " · tab bridge controls · x toggle local/remote"
  return `p → ${next}${scrollHint}`
}

export function toggleLeftPanelMode(state: LeftPanelState): void {
  state.leftPanelMode =
    state.leftPanelMode === "threads"
      ? "account"
      : state.leftPanelMode === "account"
        ? "gardener"
        : state.leftPanelMode === "gardener"
          ? "bridge"
          : "threads"
  state.leftPanelScrollOffset = 0
}

export function leftPanelLineCount(input: {
  mode: LeftPanelMode
  threadsInput: ThreadsRailRenderInput
  account: RemoteAccountSnapshot
  usage: RemoteUsageSnapshot
  agentUsage: OpsPanelAgentUsage
  environmentName: string
  bridgeText: string
  codexAuthHistory?: string[]
  gardener?: {
    stackRoot: string
    threadId: string
    workerStatus: string
    talkToGardener: boolean
    inbox: GardenerInboxItem[]
    selectedIndex: number
    workerQueueCount: number
    workerTargetLabel?: string
    workerTargetStatus?: string
    lastGardenRewrite?: string
    authSwapHint?: string
    workspaceGardenPath?: string
    gardenPath?: string
  }
}): number {
  if (input.mode === "threads") return input.threadsInput.history.length + 4
  if (input.mode === "account") {
    return (
      subscriptionPanelLineCount(
        input.account,
        input.usage,
        input.agentUsage,
        input.environmentName,
        input.codexAuthHistory,
      ) + 2
    )
  }
  if (input.mode === "gardener" && input.gardener) {
    return gardenerPanelLines(input.gardener).length + 2
  }
  return input.bridgeText.split("\n").length + 2
}

export function renderLeftPanelStyled(input: {
  mode: LeftPanelMode
  threadsInput: ThreadsRailRenderInput
  account: RemoteAccountSnapshot
  usage: RemoteUsageSnapshot
  agentUsage: OpsPanelAgentUsage
  environmentName: string
  bridgeText: string
  focused: boolean
  scrollOffset: number
  visibleRows: number
  codexAuthHistory?: string[]
  gardener?: {
    stackRoot: string
    threadId: string
    workerStatus: string
    talkToGardener: boolean
    inbox: GardenerInboxItem[]
    selectedIndex: number
    workerQueueCount: number
    workerTargetLabel?: string
    workerTargetStatus?: string
    lastGardenRewrite?: string
    authSwapHint?: string
    workspaceGardenPath?: string
    gardenPath?: string
  }
}): StyledText {
  if (input.mode === "threads") {
    return renderThreadsRailStyled(input.threadsInput)
  }

  const body =
    input.mode === "account"
      ? subscriptionPanelLines(
          input.account,
          input.usage,
          input.agentUsage,
          input.environmentName,
          input.codexAuthHistory,
        )
      : input.mode === "gardener" && input.gardener
        ? gardenerPanelLines(input.gardener)
        : input.bridgeText.split("\n")
  const window = scrollWindow(body, input.scrollOffset, input.visibleRows)
  const header = [leftPanelHint(input.mode, input.focused), ""]
  if (body.length > window.length) {
    header.unshift(`scroll ${input.scrollOffset + 1}-${input.scrollOffset + window.length}/${body.length}`)
  }
  const text = [...header, ...window].join("\n")
  const chunks: TextChunk[] = []
  for (const [index, line] of text.split("\n").entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    if (line.includes("@") && input.mode === "account") {
      chunks.push(fg(theme.synth.amber)(line))
    } else if (line.startsWith("▸") || (input.mode === "gardener" && line.includes("talk mode ON"))) {
      chunks.push(fg(theme.synth.amber)(line))
    } else if (line.startsWith("  blocked") || line.includes("missing-auth")) {
      chunks.push(fg(theme.synth.red)(line))
    } else if (
      line.startsWith("Synth") ||
      line.startsWith("Bridge") ||
      line.startsWith("Agent") ||
      line.startsWith("Gardener")
    ) {
      chunks.push(fg(theme.synth.orangeDark)(line))
    } else {
      chunks.push(fg(theme.fgPrimary)(line))
    }
  }
  return new StyledText(chunks)
}

function scrollWindow(lines: string[], offset: number, visibleRows: number): string[] {
  const start = Math.max(0, Math.min(offset, Math.max(0, lines.length - visibleRows)))
  return lines.slice(start, start + visibleRows)
}

function liveOpsModeLabel(mode: "local" | "remote"): string {
  return mode === "local" ? "local" : "remote"
}
