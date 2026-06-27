import {
  Box,
  createCliRenderer,
  Text,
  type CliRenderer,
} from "@opentui/core"
import { stackTuiTheme as theme } from "./theme.js"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { basename, relative, resolve } from "node:path"
import {
  CODEX_MODEL_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
  STACK_ENVIRONMENT_OPTIONS,
  environmentAuthStatus,
  setCodexModel,
  setCodexReasoningEffort,
  setStackEnvironment,
  type StackConfig,
  type StackEnvironmentName,
} from "../config.js"
import {
  agentContextRailLineCount,
  agentContextRailText,
  emptyAgentContext,
  extractCodexThreadIdFromTurns,
  mergeAgentContext,
  noteUsedSkillsFromText,
  readAgentContextFromSession,
  type AgentContextSnapshot,
} from "../codex/agent-context.js"
import {
  formatCodexBudgetSuffix,
  readCodexRateLimitsFromSession,
  readLatestCodexRateLimits,
  type CodexRateLimitsSnapshot,
} from "../codex/rate-limits.js"
import {
  buildSessionUsageSummary,
  formatSessionUsageSummary,
  formatThreadUsageLine,
} from "../codex/usage-cost.js"
import { runCodexTurn } from "../codex/adapter.js"
import {
  isEvalLaunchActive,
  readReadmeSmokeEvalLaunch,
  startReadmeSmokeEval,
  type StackEvalLaunch,
} from "../local/evals.js"
import {
  ensureLocalStackBootstrap,
  isOptimizerCliAvailable,
  refreshLocalBootstrapSnapshot,
  shouldAutoStartDevSlot,
  shouldAutoStartLocalOptimizer,
  type LocalBootstrapSnapshot,
} from "../local/bootstrap.js"
import {
  readOptimizerSnapshot,
  startOptimizerService,
  type OptimizerRunSummary,
  type OptimizerSnapshot,
} from "../local/optimizers.js"
import type { WorkspaceInfo } from "../local/workspace.js"
import { authSetupHint, readRemoteAccountSnapshot, type RemoteAccountSnapshot } from "../remote/account.js"
import {
  downloadRemoteOutput,
  executeRemoteRunAction,
  previewRemoteOutput,
  previewSavedRemoteDownload,
  previewRemoteFactoryWakeDue,
  readRemoteDownloadHistory,
  sendRemoteFactoryMessage,
  sendRemoteRunMessage,
  uploadRemoteRunFile,
  type RemoteActionKind,
  type RemoteActionResult,
  type RemoteDownloadRecord,
  type RemoteOutputSelection,
  type RemoteOutputPreview,
  type RemoteSavedDownloadPreview,
} from "../remote/actions.js"
import {
  readContainersPanelSnapshot,
  type ContainersPanelSnapshot,
} from "../remote/containers.js"
import {
  cancelHostedOptimizerRun,
  downloadHostedOptimizerArtifact,
  previewHostedOptimizerArtifact,
  readHostedOptimizerSnapshot,
  type HostedOptimizerArtifactDownload,
  type HostedOptimizerArtifactPreview,
  type HostedOptimizerRunSummary,
  type HostedOptimizerSnapshot,
} from "../remote/optimizers.js"
import {
  readRemoteProjectsPanelSnapshot,
  readRemoteResearchSnapshot,
  type RemoteFactorySummary,
  type RemoteProjectsPanelSnapshot,
  type RemoteRunDetail,
  type RemoteResearchSnapshot,
  type RemoteSmrRunSummary,
} from "../remote/research.js"
import {
  listSessionHistory,
  readSessionLog,
  readUsageFromStdout,
  type StackCodexTurn,
  type StackCodexUsage,
  type StackLocalSession,
  type StackSessionSummary,
  type StackSessionUsageSummary,
  writeSessionLog,
} from "../session.js"
import {
  appendStackBlock,
  appendUserBlock,
  applyCodexLine,
  blocksFromTurnStdout,
  maxTranscriptScrollOffset,
  parseCodexJsonLine,
  renderTranscriptStyledView,
  upsertToolLog,
  type ToolLog,
  type TranscriptBlock,
  type TranscriptRenderOptions,
  type TranscriptViewport,
} from "./transcript.js"
import type { SubagentLog } from "./subagents.js"
import { upsertSubagentLog } from "./subagents.js"
import {
  compactUsageWithThroughput,
  displayTokensPerSecond,
  formatAverageTokensPerSecond,
  refreshSessionThroughput,
  seedEmaFromTurns,
  type LiveTurnThroughput,
} from "./throughput.js"
import {
  emptyRemoteUsageSnapshot,
  readRemoteUsageSnapshot,
  type RemoteUsageSnapshot,
} from "../remote/usage.js"
import {
  opsPanelLineCount,
  opsPanelText,
  opsPanelTitle,
  type OpsPanelAgentUsage,
  type RightPanelMode,
} from "./ops-panel.js"

type FocusMode = "agent" | "model" | "effort" | "environment" | "ops" | "optimizers" | "hosted" | "remote" | "history"
type LiveOpsMode = "local" | "remote"
type HostedOptimizerActionKind = "cancel-run" | "preview-artifact" | "download-artifact"
type MediationTargetKind = "remote-run" | "factory" | "hosted-optimizer"
type LiveActionKind = RemoteActionKind | "start-readme-smoke"

export type StackAppOptions = {
  config: StackConfig
  workspace: WorkspaceInfo
  session: StackLocalSession
}

type AppState = {
  focusMode: FocusMode
  liveOpsMode: LiveOpsMode
  /** Agent Bridge + session detail panels (right). Threads rail stays visible. */
  railsVisible: boolean
  showDetails: boolean
  expandedBlockIds: Set<string>
  selectedToolIndex: number
  selectedHistoryIndex: number
  agentScrollOffset: number
  lastAgentScrollAt?: number
  status: "idle" | "running" | "error"
  spinnerFrame: number
  lastUsage?: StackCodexUsage
  averageTokensPerSecond?: number
  emaTokensPerSecond?: number
  currentTurnStartedAt?: string
  liveThinkingText?: string
  liveThinkingId?: string
  turnStartedAt?: string
  blocks: TranscriptBlock[]
  inputBuffer: string
  toolLogs: ToolLog[]
  subagentLogs: SubagentLog[]
  history: StackSessionSummary[]
  lastSessionLogPath?: string
  optimizerSnapshot: OptimizerSnapshot
  selectedOptimizerRunIndex: number
  remoteAccountSnapshot: RemoteAccountSnapshot
  remoteUsageSnapshot: RemoteUsageSnapshot
  remoteResearchSnapshot: RemoteResearchSnapshot
  remoteProjectsSnapshot: RemoteProjectsPanelSnapshot
  containersSnapshot: ContainersPanelSnapshot
  rightPanelMode: RightPanelMode
  optimizerCliAvailable: boolean
  localBootstrapSnapshot: LocalBootstrapSnapshot
  opsScrollOffset: number
  hostedOptimizerSnapshot: HostedOptimizerSnapshot
  evalLaunch: StackEvalLaunch
  recentRemoteDownloads: RemoteDownloadRecord[]
  recentRemoteOutputPreview?: RemoteOutputPreview
  recentRemoteDownloadPreview?: RemoteSavedDownloadPreview
  selectedRemoteJobIndex: number
  selectedRemoteFactoryIndex: number
  selectedRemoteOutputIndex: number
  selectedHostedOptimizerRunIndex: number
  selectedHostedOptimizerArtifactIndex: number
  recentHostedOptimizerArtifactPreview?: HostedOptimizerArtifactPreview
  recentHostedOptimizerArtifactDownload?: HostedOptimizerArtifactDownload
  mediationTargetKind: MediationTargetKind
  pendingHostedOptimizerAction?: HostedOptimizerActionKind
  hostedOptimizerActionMessage?: string
  pendingRemoteAction?: LiveActionKind
  remoteActionMessage?: string
  agentContext: AgentContextSnapshot
  threadsRailColumns: number
  harnessCommand: string
  codexRateLimits?: CodexRateLimitsSnapshot
}

type MountedView = {
  root: ReturnType<typeof Box>
}

type StackKeyEvent = {
  name?: string
  ctrl?: boolean
  sequence?: string
  raw?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}

const COMMON_FOCUS_ORDER: FocusMode[] = ["agent", "model", "effort", "environment", "ops"]
const LOCAL_FOCUS_ORDER: FocusMode[] = [...COMMON_FOCUS_ORDER, "optimizers", "history"]
const REMOTE_FOCUS_ORDER: FocusMode[] = [...COMMON_FOCUS_ORDER, "hosted", "remote", "history"]
const SESSION_HISTORY_VISIBLE_ROWS = 7

export async function runStackApp(options: StackAppOptions): Promise<void> {
  const optimizerSnapshot = await readOptimizerSnapshot(options.config)
  const optimizerCliAvailable = isOptimizerCliAvailable(options.config.optimizerCommand)
  const localStackBoot = await ensureLocalStackBootstrap(options.config)
  const remoteAccountSnapshot = await readRemoteAccountSnapshot(options.config)
  const remoteUsageSnapshot = await readRemoteUsageSnapshot(options.config)
  const remoteResearchSnapshot = await readRemoteResearchSnapshot(options.config)
  const remoteProjectsSnapshot = await readRemoteProjectsPanelSnapshot(options.config)
  const containersSnapshot = await readContainersPanelSnapshot(options.config)
  const hostedOptimizerSnapshot = await readHostedOptimizerSnapshot(options.config)
  const recentRemoteDownloads = await readRemoteDownloadHistory(options.config)
  const state: AppState = {
    focusMode: "agent",
    liveOpsMode: "local",
    railsVisible: false,
    showDetails: false,
    expandedBlockIds: new Set<string>(),
    selectedToolIndex: 0,
    selectedHistoryIndex: 0,
    agentScrollOffset: 0,
    status: "idle",
    spinnerFrame: 0,
    emaTokensPerSecond: seedEmaFromTurns(options.session.turns),
    blocks: [],
    inputBuffer: "",
    toolLogs: [],
    subagentLogs: [],
    history: await listSessionHistory(options.config.sessionLogDir, options.config.codexPricing),
    optimizerSnapshot: localStackBoot.optimizer ?? optimizerSnapshot,
    optimizerCliAvailable,
    localBootstrapSnapshot: localStackBoot.bootstrap,
    selectedOptimizerRunIndex: 0,
    remoteAccountSnapshot,
    remoteUsageSnapshot,
    remoteResearchSnapshot,
    remoteProjectsSnapshot,
    containersSnapshot,
    rightPanelMode: options.config.environmentName === "dev" ? "local" : "hosted",
    opsScrollOffset: 0,
    hostedOptimizerSnapshot,
    evalLaunch: readReadmeSmokeEvalLaunch(options.config),
    recentRemoteDownloads,
    selectedRemoteJobIndex: 0,
    selectedRemoteFactoryIndex: 0,
    selectedRemoteOutputIndex: 0,
    selectedHostedOptimizerRunIndex: 0,
    selectedHostedOptimizerArtifactIndex: 0,
    mediationTargetKind: "remote-run",
    agentContext: emptyAgentContext(options.config.workspaceRoot),
    threadsRailColumns: 40,
    harnessCommand: options.config.codexCommand,
  }
  refreshSessionThroughput(state, options.session.turns)
  selectEvalRunIfKnown(state)
  const currentThreadIndex = state.history.findIndex((summary) => summary.id === options.session.id)
  state.selectedHistoryIndex =
    currentThreadIndex >= 0 ? currentThreadIndex : clampIndex(state.selectedHistoryIndex, state.history.length)

  let view: MountedView | undefined
  let remount = () => {
    view?.root.requestRender()
  }

  const refreshHistory = async () => {
    state.history = await listSessionHistory(options.config.sessionLogDir, options.config.codexPricing)
    state.selectedHistoryIndex = clampIndex(state.selectedHistoryIndex, state.history.length)
  }

  let spinnerInterval: ReturnType<typeof setInterval> | undefined
  let optimizerInterval: ReturnType<typeof setInterval> | undefined
  let rateLimitsInterval: ReturnType<typeof setInterval> | undefined

  const refreshCodexRateLimits = async () => {
    const latest = await readLatestCodexRateLimits()
    if (!latest) return
    state.codexRateLimits = latest
  }

  const refreshLocalBootstrap = async () => {
    state.localBootstrapSnapshot = await refreshLocalBootstrapSnapshot(
      options.config,
      state.localBootstrapSnapshot,
    )
  }

  const refreshOptimizers = async () => {
    state.optimizerSnapshot = await readOptimizerSnapshot(options.config)
    state.selectedOptimizerRunIndex = clampIndex(state.selectedOptimizerRunIndex, state.optimizerSnapshot.runs.length)
  }

  const refreshRemoteAccount = async () => {
    state.remoteAccountSnapshot = await readRemoteAccountSnapshot(options.config)
  }

  const refreshRemoteUsage = async () => {
    state.remoteUsageSnapshot = await readRemoteUsageSnapshot(options.config)
  }

  const refreshRemoteResearch = async () => {
    state.remoteResearchSnapshot = await readRemoteResearchSnapshot(options.config)
    state.selectedRemoteJobIndex = clampIndex(state.selectedRemoteJobIndex, state.remoteResearchSnapshot.jobs.length)
    state.selectedRemoteFactoryIndex = clampIndex(
      state.selectedRemoteFactoryIndex,
      state.remoteResearchSnapshot.factories.length,
    )
    state.selectedRemoteOutputIndex = clampIndex(
      state.selectedRemoteOutputIndex,
      currentRemoteOutputCount(state),
    )
    selectEvalRunIfKnown(state)
  }

  const refreshRemoteOpsPanel = async () => {
    await Promise.all([
      refreshRemoteProjects(),
      refreshRemoteUsage(),
      refreshHostedOptimizers(),
      refreshLocalBootstrap(),
    ])
  }

  const refreshRemoteProjects = async () => {
    state.remoteProjectsSnapshot = await readRemoteProjectsPanelSnapshot(options.config)
    state.containersSnapshot = await readContainersPanelSnapshot(options.config)
  }

  const refreshHostedOptimizers = async () => {
    state.hostedOptimizerSnapshot = await readHostedOptimizerSnapshot(options.config)
    state.selectedHostedOptimizerRunIndex = clampIndex(
      state.selectedHostedOptimizerRunIndex,
      state.hostedOptimizerSnapshot.runs.length,
    )
    state.selectedHostedOptimizerArtifactIndex = clampIndex(
      state.selectedHostedOptimizerArtifactIndex,
      currentHostedOptimizerArtifactCount(state),
    )
  }

  const refreshEvalLaunch = () => {
    state.evalLaunch = readReadmeSmokeEvalLaunch(options.config)
    selectEvalRunIfKnown(state)
  }

  const refreshAfterEnvironmentChange = async (environmentName: StackEnvironmentName) => {
    await applyStackEnvironment(options, state, environmentName, remount, async () => {
      await Promise.all([
        refreshRemoteAccount(),
        refreshRemoteUsage(),
        refreshRemoteResearch(),
        refreshRemoteProjects(),
        refreshHostedOptimizers(),
      ])
      state.recentRemoteDownloads = await readRemoteDownloadHistory(options.config)
      state.optimizerCliAvailable = isOptimizerCliAvailable(options.config.optimizerCommand)
      const booted = await ensureLocalStackBootstrap(options.config)
      state.localBootstrapSnapshot = booted.bootstrap
      if (booted.optimizer) state.optimizerSnapshot = booted.optimizer
      else await refreshOptimizers()
    })
    remount()
  }

  const cycleStackEnvironmentFromUi = async (direction: number) => {
    const current = options.config.environmentName
    const index = STACK_ENVIRONMENT_OPTIONS.indexOf(current)
    const next =
      STACK_ENVIRONMENT_OPTIONS[(index + direction + STACK_ENVIRONMENT_OPTIONS.length) % STACK_ENVIRONMENT_OPTIONS.length] ??
      current
    await refreshAfterEnvironmentChange(next)
  }

  const submitFromCurrentInput = (key?: StackKeyEvent): boolean => {
    if (!view || state.focusMode !== "agent" || state.status === "running") return false
    const prompt = state.inputBuffer.trim()
    if (!prompt) return false
    key?.preventDefault?.()
    key?.stopPropagation?.()
    submitInputValue(prompt, options, state, renderer, remount, refreshHistory)
    return true
  }

  let renderer: CliRenderer
  renderer = await createCliRenderer({
    exitOnCtrlC: true,
    prependInputHandlers: [
      (sequence: string) => {
        return handleRawInput(
          sequence,
          options,
          state,
          renderer,
          submitFromCurrentInput,
          remount,
          refreshHistory,
          refreshOptimizers,
          refreshRemoteAccount,
          refreshRemoteUsage,
          refreshRemoteResearch,
          refreshRemoteProjects,
          refreshHostedOptimizers,
          refreshRemoteOpsPanel,
          () => closeRenderer(renderer, spinnerInterval, optimizerInterval, projectsInterval, rateLimitsInterval),
          cycleStackEnvironmentFromUi,
        )
      },
    ],
  })

  view = mountView(renderer, options, state, undefined)
  remount = () => {
    view = mountView(renderer, options, state, view)
  }

  spinnerInterval = setInterval(() => {
    if (state.status !== "running") return
    if (isRecentAgentScroll(state)) return
    state.spinnerFrame += 1
    remount()
  }, 120)

  optimizerInterval = setInterval(() => {
    refreshEvalLaunch()
    void refreshOptimizers().finally(remount)
  }, 2500)

  const projectsInterval = setInterval(() => {
    if (state.remoteAccountSnapshot.status !== "connected") return
    void refreshRemoteOpsPanel().finally(remount)
  }, 20_000)

  void refreshCodexRateLimits().finally(remount)
  rateLimitsInterval = setInterval(() => {
    void refreshCodexRateLimits().finally(remount)
  }, 120_000)

  renderer._internalKeyInput.onInternal("keypress", (key: StackKeyEvent) => {
    if (isEnterKey(key) && submitFromCurrentInput(key)) return
  })

  renderer.keyInput.on("keypress", (key: StackKeyEvent) => {
    if (key.ctrl && key.name === "c") return
    if (key.name === "tab") {
      state.focusMode = nextFocusMode(state.focusMode, state.liveOpsMode)
      remount()
      return
    }

    if (key.name === "x" && state.focusMode !== "agent") {
      toggleLiveOpsMode(state)
      remount()
      return
    }

    if (key.name === "escape") {
      if (state.status === "running") return
      closeRenderer(renderer, spinnerInterval, optimizerInterval, projectsInterval, rateLimitsInterval)
      return
    }

    if (key.name === "b" && state.focusMode === "agent") {
      state.railsVisible = !state.railsVisible
      remount()
      return
    }

    if (key.name === "d" && state.focusMode === "agent") {
      state.showDetails = !state.showDetails
      remount()
      return
    }

    if (state.focusMode === "agent" && (key.name === "]" || key.name === "[")) {
      void cycleStackEnvironmentFromUi(key.name === "]" ? 1 : -1)
      return
    }

    if (isEnterKey(key) && submitFromCurrentInput(key)) {
      return
    }

    if (
      isEnterKey(key) &&
      state.focusMode === "agent" &&
      state.rightPanelMode === "local" &&
      state.status !== "running" &&
      !state.inputBuffer.trim() &&
      state.optimizerCliAvailable &&
      state.optimizerSnapshot.status !== "running"
    ) {
      void startLocalOptimizerFromUi(options, state, remount, refreshOptimizers)
      return
    }

    if (handleAgentScrollKey(key, state, renderer)) {
      remount()
      return
    }

    if (state.focusMode === "history") {
      void handleHistoryKey(key, options, state, remount, refreshHistory)
      return
    }

    if (state.focusMode === "ops") {
      handleOpsKey(key, state, renderer, options, buildOpsPanelInput(options, state), opsVisibleRows(renderer, state), remount, refreshRemoteOpsPanel, refreshOptimizers)
      return
    }

  if (state.focusMode === "remote") {
    void handleRemoteKey(key, options, state, remount, refreshRemoteResearch)
    return
  }

    if (state.focusMode === "hosted") {
      void handleHostedOptimizerKey(key, options, state, remount, refreshHostedOptimizers)
      return
    }

    if (state.focusMode === "optimizers") {
      void handleOptimizerKey(key, options, state, remount, refreshOptimizers)
      return
    }

    if (state.focusMode === "model") {
      handleModelKey(key, options.config)
      remount()
      return
    }

    if (state.focusMode === "effort") {
      handleEffortKey(key, options.config)
      remount()
      return
    }

    if (state.focusMode === "environment") {
      void handleEnvironmentKey(key, options, state, refreshRemoteAccount, refreshRemoteUsage, refreshRemoteResearch, refreshRemoteProjects, refreshHostedOptimizers, remount)
    }
  })

  function mountView(
    renderer: CliRenderer,
    options: StackAppOptions,
    state: AppState,
    existing: MountedView | undefined,
  ): MountedView {
    if (existing) {
      renderer.root.remove("stack-root")
    }

    const nextView = createView(renderer, options, state, remount, refreshAfterEnvironmentChange)
    renderer.root.add(nextView.root)
    nextView.root.requestRender()
    return nextView
  }
}

function createView(
  renderer: CliRenderer,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  applyStackEnvironmentFromUi: (environmentName: StackEnvironmentName) => Promise<void>,
): MountedView {
  const switcher = switcherPanel(options.config, state)
  const transcriptViewport = transcriptViewportMetrics(renderer, state)
  updateThreadsRailColumns(renderer, state)
  const threadRows = threadsVisibleRows(renderer, state)
  const projectsRows = opsVisibleRows(renderer, state)
  const opsPanelInput = buildOpsPanelInput(options, state)
  const agentChildren = [
    agentHeaderBar(options, state, refresh, applyStackEnvironmentFromUi),
    ...(state.railsVisible ? [Text({ content: mediationTopStrip(options, state), fg: theme.fgAccentStrong })] : []),
    Text({ content: renderTranscriptPanel(state, transcriptViewport), flexGrow: 1 }),
    ...(switcher ? [switcher] : []),
    agentControlRow(options.config, state),
  ]

  const root = Box(
    {
      id: "stack-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
      gap: 1,
    },
    Box(
      {
        flexDirection: "row",
        flexGrow: 1,
        gap: 1,
      },
      Box(
        {
          width: "24%",
          flexDirection: "column",
          gap: 1,
        },
        Box(
          {
            border: true,
            borderStyle: "single",
            borderColor: state.focusMode === "history" ? theme.borderActive : theme.borderInactive,
            title: threadsRailTitle(options),
            flexGrow: state.railsVisible ? 0 : 1,
            flexDirection: "column",
            padding: 1,
            onMouseScroll(event) {
              handleThreadsMouseScroll(event, state, refresh)
            },
          },
          Text({ content: threadsRailText(options, state, threadRows), fg: theme.fgPrimary, flexGrow: 1 }),
          Text({
            content: agentContextRailText(state.agentContext, options.config.workspaceRoot, state.threadsRailColumns),
            fg: theme.fgSecondary,
          }),
        ),
        ...(state.railsVisible
          ? [
              Box(
                {
                  border: true,
                  borderStyle: "single",
                  borderColor: isLiveOpsFocus(state.focusMode) ? theme.borderActive : theme.borderInactive,
                  title: `Agent Bridge: ${liveOpsModeLabel(state.liveOpsMode)}`,
                  flexGrow: 1,
                  padding: 1,
                },
                Text({ content: liveOperationsRailText(options, state), fg: theme.fgPrimary }),
              ),
            ]
          : []),
      ),
      Box(
        {
          border: true,
          borderStyle: "single",
          borderColor:
            state.focusMode === "agent" ||
            state.focusMode === "model" ||
            state.focusMode === "effort" ||
            state.focusMode === "environment"
              ? theme.borderActive
              : theme.borderInactive,
          title: "Agent",
          flexGrow: 1,
          padding: 1,
          flexDirection: "column",
          gap: 1,
          onMouseScroll(event) {
            event.preventDefault()
            event.stopPropagation()
            state.lastAgentScrollAt = Date.now()
            const direction = event.scroll?.direction
            if (direction === "up") {
              scrollAgentTranscript(state, 3, transcriptViewport, "up")
            } else if (direction === "down") {
              scrollAgentTranscript(state, 3, transcriptViewport, "down")
            }
            refresh()
          },
        },
        ...agentChildren,
      ),
      Box(
        {
          width: state.railsVisible ? "30%" : "26%",
          flexDirection: "column",
          gap: 1,
        },
        Box(
          {
            border: true,
            borderStyle: "single",
            borderColor: state.focusMode === "ops" ? theme.borderActive : theme.borderInactive,
            title: opsPanelTitle(state.rightPanelMode, options.config.environmentName),
            flexGrow: state.railsVisible ? 1 : 1,
            padding: 1,
            onMouseDown(event) {
              event.preventDefault?.()
              event.stopPropagation?.()
              state.focusMode = "ops"
              refresh()
            },
            onMouseScroll(event) {
              state.focusMode = "ops"
              handleOpsMouseScroll(event, state, opsPanelInput, projectsRows, refresh)
            },
          },
          Text({
            content: opsPanelText({ ...opsPanelInput, scrollOffset: state.opsScrollOffset, visibleRows: projectsRows }),
            fg: theme.fgPrimary,
          }),
        ),
        ...(state.railsVisible
          ? [
              Box(
                {
                  border: true,
                  borderStyle: "single",
                  borderColor:
                    state.focusMode === "history" || state.focusMode === "remote" || state.focusMode === "hosted"
                      ? theme.borderActive
                      : theme.borderInactive,
                  title: "Session",
                  flexGrow: 1,
                  padding: 1,
                  onMouseScroll(event) {
                    handleSessionsMouseScroll(event, state, transcriptViewport, refresh)
                  },
                },
                Text({ content: sessionText(options, state), fg: theme.fgPrimary }),
              ),
            ]
          : []),
      ),
    ),
    Text({
      content: footerHint(state),
      fg: theme.fgMuted,
    }),
  )

  return { root }
}

function switcherPanel(config: StackConfig, state: AppState): ReturnType<typeof Box> | undefined {
  if (state.focusMode !== "model" && state.focusMode !== "effort" && state.focusMode !== "environment") {
    return undefined
  }

  const lines =
    state.focusMode === "environment"
      ? environmentSwitcherLines(config, state)
      : optionSwitcherLines(
          state.focusMode,
          state.focusMode === "model" ? config.codexModel : config.codexReasoningEffort,
          state.focusMode === "model" ? CODEX_MODEL_OPTIONS : CODEX_REASONING_EFFORT_OPTIONS,
        )
  const title =
    state.focusMode === "model"
      ? "Model Switcher"
      : state.focusMode === "effort"
        ? "Effort Switcher"
        : "Target Switcher"

  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderActive,
      title,
      padding: 1,
      height: Math.min(state.focusMode === "environment" ? 11 : 8, lines.length + 2),
    },
    Text({ content: lines.join("\n"), fg: theme.fgPrimary }),
  )
}

function optionSwitcherLines<T extends string>(label: string, current: T, options: readonly T[]): string[] {
  return [
    `${label}: ${current}`,
    "j/k or arrows change selection. Enter/Space cycles.",
    ...options.map((option) => `${option === current ? ">" : " "} ${option}`),
  ]
}

function environmentSwitcherLines(config: StackConfig, state: AppState): string[] {
  return [
    `env: ${config.environmentName} (${config.environment.label})`,
    "j/k or [ ] change env. r refreshes remote checks.",
    ...STACK_ENVIRONMENT_OPTIONS.map((name) => environmentOptionLine(config, state, name)),
    `bridge: ${state.liveOpsMode} (x toggles)`,
    `remote: ${state.remoteResearchSnapshot.status} jobs ${state.remoteResearchSnapshot.jobs.length}`,
    `hosted: ${state.hostedOptimizerSnapshot.status} jobs ${state.hostedOptimizerSnapshot.runs.length}`,
    `api: ${config.environment.apiBaseUrl}`,
  ]
}

function environmentOptionLine(config: StackConfig, state: AppState, environmentName: StackEnvironmentName): string {
  const isCurrent = config.environmentName === environmentName
  const environment = config.environments[environmentName]
  const authStatus = environmentAuthStatus(environment).hasAuth ? "key ok" : `needs ${environment.authEnv}`
  const accountStatus = isCurrent ? state.remoteAccountSnapshot.status : "—"
  return `${isCurrent ? ">" : " "} ${environmentName.padEnd(7)} ${environment.label.padEnd(8)} ${authStatus.padEnd(14)} ${accountStatus}`
}

function agentControlRow(config: StackConfig, state: AppState): ReturnType<typeof Box> {
  const budget = formatCodexBudgetSuffix(config.codexAuthPlan, state.codexRateLimits)
  return Box(
    {
      flexDirection: "column",
      gap: 1,
    },
    Text({
      content: renderAgentInput(state),
      fg: state.inputBuffer ? theme.fgOnAccent : theme.fgPlaceholder,
      bg: state.focusMode === "agent" ? theme.bgSubtle : undefined,
      width: "100%",
    }),
    Box(
      {
        flexDirection: "row",
        gap: 1,
        alignItems: "center",
      },
      controlChip(`model ${config.codexModel}`, state.focusMode === "model"),
      controlDivider(),
      controlChip(`effort ${config.codexReasoningEffort}`, state.focusMode === "effort"),
      controlDivider(),
      controlChip(`env ${config.environmentName}`, state.focusMode === "environment"),
    ),
    Box(
      {
        flexDirection: "row",
        gap: 1,
        alignItems: "center",
      },
      controlChip(`auth ${config.codexAuthPlan}`, false),
      ...(budget ? [controlDivider(), controlChip(budget, false)] : []),
    ),
  )
}

function controlChip(content: string, active: boolean): ReturnType<typeof Text> {
  return Text({
    content,
    fg: active ? theme.fgOnAccent : theme.fgAccent,
    bg: active ? theme.bgChipActive : theme.bgSubtle,
    flexShrink: 0,
  })
}

function controlDivider(): ReturnType<typeof Text> {
  return Text({
    content: "│",
    fg: theme.fgDivider,
    bg: theme.bgSubtle,
    flexShrink: 0,
  })
}

function submitInputValue(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
): void {
  if (!prompt || state.status === "running") return
  state.inputBuffer = ""
  void submitPrompt(prompt, options, state, renderer, refresh, refreshHistory)
}

function isEnterKey(key: StackKeyEvent): boolean {
  return (
    key.name === "return" ||
    key.name === "enter" ||
    key.name === "linefeed" ||
    key.name === "kpenter" ||
    (key.ctrl === true && (key.name === "m" || key.name === "j")) ||
    key.sequence === "\r" ||
    key.sequence === "\n" ||
    key.raw === "\r" ||
    key.raw === "\n"
  )
}

function isRawEnterSequence(sequence: string): boolean {
  return (
    sequence === "\r" ||
    sequence === "\n" ||
    sequence === "\r\n" ||
    sequence === "\x1bOM" ||
    sequence === "\x1b[13~"
  )
}

function handleRawAgentInput(
  sequence: string,
  state: AppState,
  submit: () => boolean,
  refresh: () => void,
): boolean {
  if (state.focusMode !== "agent") return false

  if (sequence === "\n" || sequence === "\x0a") {
    state.inputBuffer += "\n"
    refresh()
    return true
  }

  if (isRawEnterSequence(sequence)) {
    return submit()
  }

  if (sequence === "\t" || sequence === "\x1b" || state.status === "running") {
    return false
  }

  if (sequence === "\x7f" || sequence === "\b") {
    state.inputBuffer = state.inputBuffer.slice(0, -1)
    refresh()
    return true
  }

  if (!isPrintableInput(sequence)) return false

  state.inputBuffer += sequence
  refresh()
  return true
}

function handleRawInput(
  sequence: string,
  options: StackAppOptions,
  state: AppState,
  renderer: CliRenderer,
  submit: () => boolean,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshOptimizers: () => Promise<void>,
  refreshRemoteAccount: () => Promise<void>,
  refreshRemoteUsage: () => Promise<void>,
  refreshRemoteResearch: () => Promise<void>,
  refreshRemoteProjects: () => Promise<void>,
  refreshHostedOptimizers: () => Promise<void>,
  refreshRemoteOpsPanel: () => Promise<void>,
  close: () => void,
  cycleStackEnvironmentFromUi: (direction: number) => Promise<void>,
): boolean {
  if (sequence === "\x1b") {
    if (state.status === "running") return true
    close()
    return true
  }

  if (sequence === "b" && state.focusMode === "agent") {
    state.railsVisible = !state.railsVisible
    refresh()
    return true
  }

  if (sequence === "d" && state.focusMode === "agent") {
    state.showDetails = !state.showDetails
    refresh()
    return true
  }

  if (state.focusMode === "agent" && (sequence === "]" || sequence === "[")) {
    void cycleStackEnvironmentFromUi(sequence === "]" ? 1 : -1)
    return true
  }

  if (sequence === "\t") {
    state.focusMode = nextFocusMode(state.focusMode, state.liveOpsMode)
    refresh()
    return true
  }

  const keyName = rawSequenceKeyName(sequence)

  if (handleAgentScrollKey({ name: keyName }, state, renderer)) {
    refresh()
    return true
  }

  if (state.focusMode === "agent") {
    return handleRawAgentInput(sequence, state, submit, refresh)
  }

  if (!keyName) return false

  if (keyName === "x") {
    toggleLiveOpsMode(state)
    refresh()
    return true
  }

  if (state.focusMode === "history") {
    void handleHistoryKey({ name: keyName }, options, state, refresh, refreshHistory)
    return true
  }

  if (state.focusMode === "ops") {
    handleOpsKey(
      { name: keyName },
      state,
      renderer,
      options,
      buildOpsPanelInput(options, state),
      opsVisibleRows(renderer, state),
      refresh,
      refreshRemoteOpsPanel,
      refreshOptimizers,
    )
    return true
  }

  if (state.focusMode === "remote") {
    void handleRemoteKey({ name: keyName }, options, state, refresh, refreshRemoteResearch)
    return true
  }

  if (state.focusMode === "hosted") {
    void handleHostedOptimizerKey({ name: keyName }, options, state, refresh, refreshHostedOptimizers)
    return true
  }

  if (state.focusMode === "optimizers") {
    void handleOptimizerKey({ name: keyName }, options, state, refresh, refreshOptimizers)
    return true
  }

  if (state.focusMode === "model") {
    handleModelKey({ name: keyName }, options.config)
    refresh()
    return true
  }

  if (state.focusMode === "effort") {
    handleEffortKey({ name: keyName }, options.config)
    refresh()
    return true
  }

  if (state.focusMode === "environment") {
    void handleEnvironmentKey({ name: keyName }, options, state, refreshRemoteAccount, refreshRemoteUsage, refreshRemoteResearch, refreshRemoteProjects, refreshHostedOptimizers, refresh)
    return true
  }

  return false
}

function rawSequenceKeyName(sequence: string): string | undefined {
  if (isRawEnterSequence(sequence)) return "enter"
  if (sequence === "\x15") return "pageup"
  if (sequence === "\x04") return "pagedown"
  if (sequence === " ") return "space"
  if (sequence === "a") return "a"
  if (sequence === "j") return "j"
  if (sequence === "k") return "k"
  if (sequence === "l") return "l"
  if (sequence === "e") return "e"
  if (sequence === "f") return "f"
  if (sequence === "c") return "c"
  if (sequence === "d") return "d"
  if (sequence === "m") return "m"
  if (sequence === "o") return "o"
  if (sequence === "p") return "p"
  if (sequence === "t") return "t"
  if (sequence === "u") return "u"
  if (sequence === "v") return "v"
  if (sequence === "s") return "s"
  if (sequence === "w") return "w"
  if (sequence === "x") return "x"
  if (sequence === "r") return "r"
  if (sequence === "\x1b[A") return "up"
  if (sequence === "\x1b[B") return "down"
  if (sequence === "\x1b[C") return "right"
  if (sequence === "\x1b[D") return "left"
  if (sequence === "\x1b[5~") return "pageup"
  if (sequence === "\x1b[6~") return "pagedown"
  if (sequence === "\x1b[H" || sequence === "\x1b[1~") return "home"
  if (sequence === "\x1b[F" || sequence === "\x1b[4~") return "end"
  return undefined
}

function isPrintableInput(sequence: string): boolean {
  for (const char of sequence) {
    const code = char.codePointAt(0)
    if (code === undefined) return false
    if (code < 32 || code === 127) return false
  }
  return sequence.length > 0
}

function agentHeaderLine(options: StackAppOptions, state: AppState): string {
  const parts = [displayCwd(options.workspace.root), options.config.codexModel]
  const stats = agentStatsSuffix(options, state)
  if (stats) parts.push(stats)
  if (state.liveOpsMode === "local") parts.push("bridge local")
  if (!state.railsVisible) parts.push("b ops")
  return parts.join(" · ")
}

function agentHeaderBar(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  applyStackEnvironmentFromUi: (environmentName: StackEnvironmentName) => Promise<void>,
): ReturnType<typeof Box> {
  const environmentName = options.config.environmentName
  const connection = synthConnectionBadge(options.config, state)
  return Box(
    {
      flexDirection: "row",
      width: "100%",
      gap: 1,
    },
    Text({ content: agentHeaderLine(options, state), fg: theme.fgAccent, flexGrow: 1 }),
    Text({ content: connection.label, fg: connection.fg, flexShrink: 0 }),
    ...STACK_ENVIRONMENT_OPTIONS.map((name) =>
      environmentChip(name, name === environmentName, () => {
        if (name === environmentName) return
        void applyStackEnvironmentFromUi(name).then(refresh)
      }),
    ),
  )
}

function environmentChip(
  label: StackEnvironmentName,
  active: boolean,
  onSelect: () => void,
): ReturnType<typeof Text> {
  return Text({
    content: ` ${label} `,
    fg: active ? theme.fgOnAccent : theme.chipInactive,
    bg: active ? theme.bgChipActive : theme.bgSubtle,
    flexShrink: 0,
    onMouseDown(event) {
      event.preventDefault?.()
      event.stopPropagation?.()
      onSelect()
    },
  })
}

function synthConnectionBadge(
  config: StackConfig,
  state: AppState,
): { label: string; fg: string } {
  const env = config.environment.label
  const auth = environmentAuthStatus(config.environment)
  const snap = state.remoteAccountSnapshot
  const hint = snap.keyHint

  if (!auth.hasAuth) {
    return { label: `○ ${env} · add key`, fg: "#f48771" }
  }
  if (snap.status === "invalid-auth") {
    return { label: `○ ${env} · bad key`, fg: "#f48771" }
  }
  if (snap.status === "missing-auth") {
    return { label: `○ ${env} · add key`, fg: "#f48771" }
  }
  if (snap.status === "offline") {
    return { label: `◐ ${env} · ${hint ?? "key"} offline`, fg: "#dcdcaa" }
  }
  if (snap.status === "connected") {
    return { label: `● ${env} · ${hint ?? "key"}`, fg: theme.fgAccentStrong }
  }
  return { label: `◐ ${env} · ${hint ?? "key"}`, fg: "#b5cea8" }
}

async function applyStackEnvironment(
  options: StackAppOptions,
  state: AppState,
  environmentName: StackEnvironmentName,
  refresh: () => void,
  refreshRemotes: () => Promise<void>,
): Promise<void> {
  if (options.config.environmentName !== environmentName) {
    setStackEnvironment(options.config, environmentName)
    markEnvironmentChecking(options.config, state)
  }
  refresh()
  await refreshRemotes()
}

function threadsRailTitle(options: StackAppOptions): string {
  return basename(options.workspace.root)
}

function opsVisibleRows(renderer: CliRenderer, state: AppState): number {
  if (state.railsVisible) return Math.max(8, Math.floor(renderer.terminalHeight * 0.28))
  return Math.max(12, renderer.terminalHeight - 12)
}

function handleOpsMouseScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  const direction = event.scroll?.direction
  if (direction !== "up" && direction !== "down") return
  scrollOpsPanel(state, input, visibleRows, direction)
  refresh()
}

function scrollOpsPanel(
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  visibleRows: number,
  direction: "up" | "down",
): void {
  const lineCount = opsPanelLineCount(input)
  const maxOffset = Math.max(0, lineCount - visibleRows)
  if (direction === "up") {
    state.opsScrollOffset = Math.max(0, state.opsScrollOffset - 3)
  } else {
    state.opsScrollOffset = Math.min(maxOffset, state.opsScrollOffset + 3)
  }
}

function toggleRightPanelMode(state: AppState): void {
  state.rightPanelMode = state.rightPanelMode === "hosted" ? "local" : "hosted"
  state.opsScrollOffset = 0
}

function handleOpsKey(
  key: StackKeyEvent,
  state: AppState,
  renderer: CliRenderer,
  options: StackAppOptions,
  opsInput: ReturnType<typeof buildOpsPanelInput>,
  visibleRows: number,
  refresh: () => void,
  refreshRemoteOpsPanel: () => Promise<void>,
  refreshOptimizers: () => Promise<void>,
): void {
  if (key.name === "p") {
    toggleRightPanelMode(state)
    refresh()
    return
  }
  if (key.name === "r") {
    void refreshRemoteOpsPanel().finally(refresh)
    return
  }
  if (key.name === "j" || key.name === "down") {
    scrollOpsPanel(state, opsInput, visibleRows, "down")
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    scrollOpsPanel(state, opsInput, visibleRows, "up")
    refresh()
    return
  }
  if (
    isEnterKey(key) &&
    state.rightPanelMode === "local" &&
    state.status !== "running" &&
    state.optimizerCliAvailable &&
    state.optimizerSnapshot.status !== "running"
  ) {
    void startLocalOptimizerFromUi(options, state, refresh, refreshOptimizers)
  }
}

function threadsVisibleRows(renderer: CliRenderer, state: AppState): number {
  const contextLines = agentContextRailLineCount(state.agentContext)
  if (state.railsVisible) return Math.max(4, Math.floor(renderer.terminalHeight * 0.32) - contextLines)
  return Math.max(6, renderer.terminalHeight - 11 - contextLines)
}

function updateThreadsRailColumns(renderer: CliRenderer, state: AppState): void {
  state.threadsRailColumns = Math.max(24, Math.floor(renderer.terminalWidth * 0.24) - 4)
}

function threadsRailText(options: StackAppOptions, state: AppState, visibleRows: number): string {
  const focusHint = state.focusMode === "history" ? "j/k select" : "tab threads"
  const actionHint = "enter resume · f fork"
  return [
    focusHint,
    actionHint,
    "",
    ...threadRowsText(options, state, visibleRows, options.session.id),
  ].join("\n")
}

function threadRowsText(
  options: StackAppOptions,
  state: AppState,
  visibleRows: number,
  currentSessionId: string,
): string[] {
  if (state.history.length === 0) return ["(no threads yet)"]
  const start = historyWindowStart(state, visibleRows)
  const rows: string[] = []
  for (const [offset, summary] of state.history.slice(start, start + visibleRows).entries()) {
    const index = start + offset
    const cursor = index === state.selectedHistoryIndex ? "›" : " "
    const time = formatRelativeTime(summary.updatedAt)
    const prompt = summary.lastPrompt ? oneLine(summary.lastPrompt, 22) : "(empty)"
    const active = summary.id === currentSessionId ? " ·" : "  "
    rows.push(`${cursor} ${time.padStart(3)}${active} ${prompt}`)
    const usageLine = threadUsageLine(options, state, summary, currentSessionId)
    if (usageLine) rows.push(`    ${usageLine}`)
  }
  if (start > 0) rows.unshift(`  ... ${start} newer`)
  const hiddenOlder = state.history.length - (start + visibleRows)
  if (hiddenOlder > 0) rows.push(`  ... ${hiddenOlder} older`)
  return rows
}

function threadUsageLine(
  options: StackAppOptions,
  state: AppState,
  summary: StackSessionSummary,
  currentSessionId: string,
): string | undefined {
  const base = formatThreadUsageLine(threadUsageSummary(options, summary), state.threadsRailColumns - 4)
  if (!base || summary.id !== currentSessionId) return base
  const tps = formatAverageTokensPerSecond(displayTokensPerSecond(state))
  if (!tps) return base
  const combined = `${base} · ${tps}`
  if (combined.length <= state.threadsRailColumns - 4) return combined
  return combined.slice(0, Math.max(0, state.threadsRailColumns - 5)) + "…"
}

function threadUsageSummary(
  options: StackAppOptions,
  summary: StackSessionSummary,
): StackSessionUsageSummary | undefined {
  if (summary.id === options.session.id) {
    return (
      buildSessionUsageSummary(options.session.turns, options.config.codexModel, options.config.codexPricing) ??
      summary.usageSummary
    )
  }
  return summary.usageSummary
}

function formatRelativeTime(value: string): string {
  const parsed = parseTimestamp(value)
  if (!parsed) return "--"
  const diffMs = Math.max(0, Date.now() - parsed.getTime())
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function handleThreadsMouseScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  const direction = event.scroll?.direction
  if (direction === "up") {
    moveSelectedHistory(state, -1)
    refresh()
  } else if (direction === "down") {
    moveSelectedHistory(state, 1)
    refresh()
  }
}

function agentStatsSuffix(options: StackAppOptions, state: AppState): string | undefined {
  const sessionUsage = buildSessionUsageSummary(
    options.session.turns,
    options.config.codexModel,
    options.config.codexPricing,
  )
  const tps = formatAverageTokensPerSecond(displayTokensPerSecond(state))
  if (sessionUsage) {
    const base = formatSessionUsageSummary(sessionUsage)
    return tps ? `${base} · ${tps}` : base
  }
  if (!state.lastUsage && !tps) return undefined
  const text = compactUsageWithThroughput(state.lastUsage, displayTokensPerSecond(state))
  return text === "after first turn" ? undefined : text
}

function footerHint(state: AppState): string {
  if (state.focusMode === "agent") {
    const localStart =
      state.rightPanelMode === "local" && state.optimizerSnapshot.status !== "running" && state.optimizerCliAvailable
        ? " · enter start GEPA"
        : ""
    return `enter send · shift+enter newline · [ ] env · b ops rail · d details · tab focus · esc quit`
  }
  if (state.focusMode === "ops") {
    const toggle = state.rightPanelMode === "hosted" ? "p → local" : "p → hosted"
    const localStart =
      state.rightPanelMode === "local" && state.optimizerSnapshot.status !== "running" && state.optimizerCliAvailable
        ? " · enter start GEPA"
        : ""
    return `${toggle} · j/k scroll · r refresh${localStart} · tab focus · esc quit`
  }
  return "tab focus · x bridge · j/k navigate · enter confirm · esc quit"
}

async function startLocalOptimizerFromUi(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshOptimizers: () => Promise<void>,
): Promise<void> {
  state.optimizerSnapshot = {
    ...state.optimizerSnapshot,
    status: "starting",
    message: `starting ${options.config.optimizerCommand} gepa service on ${options.config.optimizerBind}`,
    checkedAt: new Date().toISOString(),
  }
  refresh()
  state.optimizerSnapshot = await startOptimizerService(options.config)
  state.selectedOptimizerRunIndex = clampIndex(state.selectedOptimizerRunIndex, state.optimizerSnapshot.runs.length)
  await refreshOptimizers()
  refresh()
}

function buildOpsPanelAgentUsage(options: StackAppOptions, state: AppState): OpsPanelAgentUsage {
  const sessionUsage = buildSessionUsageSummary(
    options.session.turns,
    options.config.codexModel,
    options.config.codexPricing,
  )
  const tps = formatAverageTokensPerSecond(displayTokensPerSecond(state))
  let sessionSummary: string | undefined
  if (sessionUsage) {
    const base = formatSessionUsageSummary(sessionUsage)
    sessionSummary = tps ? `${base} · ${tps}` : base
  } else if (state.lastUsage) {
    const text = compactUsageWithThroughput(state.lastUsage, displayTokensPerSecond(state))
    sessionSummary = text === "after first turn" ? undefined : text
  }
  return {
    codexAuthPlan: options.config.codexAuthPlan,
    sessionSummary,
    codexBudget: formatCodexBudgetSuffix(options.config.codexAuthPlan, state.codexRateLimits),
  }
}

function buildOpsPanelInput(options: StackAppOptions, state: AppState) {
  const auth = environmentAuthStatus(options.config.environment)
  return {
    mode: state.rightPanelMode,
    setup: {
      authMessage: auth.message,
      authEnvFile: auth.envFile,
      hasAuth: auth.hasAuth,
      optimizerCliAvailable: state.optimizerCliAvailable,
      autoStartLocalOptimizer: shouldAutoStartLocalOptimizer(options.config),
      autoStartDevSlot: shouldAutoStartDevSlot(options.config),
      localBootstrap: state.localBootstrapSnapshot,
    },
    account: state.remoteAccountSnapshot,
    usage: state.remoteUsageSnapshot,
    agentUsage: buildOpsPanelAgentUsage(options, state),
    projects: state.remoteProjectsSnapshot,
    hosted: state.hostedOptimizerSnapshot,
    containers: state.containersSnapshot,
    localOptimizers: state.optimizerSnapshot,
    focus: {
      focusMode: state.focusMode,
      selectedHostedOptimizerRunIndex: state.selectedHostedOptimizerRunIndex,
      selectedOptimizerRunIndex: state.selectedOptimizerRunIndex,
    },
  }
}

function transcriptRenderOptions(state: AppState): TranscriptRenderOptions {
  return {
    expandedBlockIds: state.expandedBlockIds,
    showDetails: state.showDetails,
    liveThinkingText: state.liveThinkingText,
    running: state.status === "running",
    spinnerFrame: state.spinnerFrame,
    harnessCommand: state.harnessCommand,
  }
}

function renderTranscriptPanel(state: AppState, viewport: TranscriptViewport) {
  return renderTranscriptStyledView(
    state.blocks,
    state.toolLogs,
    state.subagentLogs,
    viewport,
    transcriptRenderOptions(state),
    state.agentScrollOffset,
  )
}

function handleSessionsMouseScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  transcriptViewport: TranscriptViewport,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  const direction = event.scroll?.direction
  if (state.focusMode !== "history" && state.focusMode !== "hosted" && state.focusMode !== "remote" && state.focusMode !== "ops") {
    if (direction === "up") scrollAgentTranscript(state, 3, transcriptViewport, "up")
    else if (direction === "down") scrollAgentTranscript(state, 3, transcriptViewport, "down")
  } else if (state.focusMode === "hosted") {
    if (direction === "up") {
      state.selectedHostedOptimizerRunIndex = clampIndex(
        state.selectedHostedOptimizerRunIndex - 1,
        state.hostedOptimizerSnapshot.runs.length,
      )
      state.selectedHostedOptimizerArtifactIndex = 0
    } else if (direction === "down") {
      state.selectedHostedOptimizerRunIndex = clampIndex(
        state.selectedHostedOptimizerRunIndex + 1,
        state.hostedOptimizerSnapshot.runs.length,
      )
      state.selectedHostedOptimizerArtifactIndex = 0
    }
  } else if (state.focusMode === "remote") {
    if (direction === "up") {
      state.selectedRemoteJobIndex = clampIndex(state.selectedRemoteJobIndex - 1, state.remoteResearchSnapshot.jobs.length)
    } else if (direction === "down") {
      state.selectedRemoteJobIndex = clampIndex(state.selectedRemoteJobIndex + 1, state.remoteResearchSnapshot.jobs.length)
    }
  } else {
    if (direction === "up") moveSelectedHistory(state, -1)
    else if (direction === "down") moveSelectedHistory(state, 1)
  }
  refresh()
}

function renderAgentInput(state: AppState): string {
  if (state.status === "running") {
    const throughput = formatAverageTokensPerSecond(displayTokensPerSecond(state))
    return throughput
      ? `${runningSpinner(state)} Codex is running… · ${throughput}`
      : `${runningSpinner(state)} Codex is running…`
  }
  const preview = state.inputBuffer.replace(/\n/g, " ↵ ")
  return preview ? `${preview}_` : "Ask Codex…"
}

function runningSpinner(state: AppState): string {
  const frames = ["|", "/", "-", "\\"]
  return frames[state.spinnerFrame % frames.length] ?? "|"
}

function statusLine(options: StackAppOptions, state: AppState): string {
  return [
    `workspace=${shortPath(options.workspace.root)}`,
    `repo=${options.workspace.repoName}`,
    `branch=${options.workspace.branch}`,
    `model=${options.config.codexModel}`,
    `provider=${options.config.codexProvider}`,
    `auth=${options.config.codexAuthPlan}`,
    `effort=${options.config.codexReasoningEffort}`,
    `env=${options.config.environmentName}`,
    `account=${state.remoteAccountSnapshot.status}`,
    `codex=${options.config.codexCommand} ${options.config.codexArgs.join(" ")}`,
    `bridge=${state.liveOpsMode}`,
    `bridge_tool=${bridgeStatusToolName(state)}`,
    `optimizers=${state.optimizerSnapshot.status}`,
    `focus=${state.focusMode}`,
    `status=${state.status}`,
  ].join("   ")
}

function mediationTopStrip(options: StackAppOptions, state: AppState): string {
  if (state.liveOpsMode === "local") {
    const optimizerCounts = optimizerJobCounts(state.optimizerSnapshot)
    return [
      "bridge local",
      `tool ${bridgeStatusToolName(state)}`,
      `mcp ${stackMcpStatusLabel(options.config)}`,
      `eval ${state.evalLaunch.status}`,
      `optimizers ${state.optimizerSnapshot.status} ${optimizerCounts.active}/${optimizerCounts.total} active`,
      "x remote bridge",
    ].join(" | ")
  }

  return [
    "bridge remote",
    `env ${options.config.environmentName}`,
    `tool ${bridgeStatusToolName(state)}`,
    `mcp ${stackMcpStatusLabel(options.config)}`,
    `auth ${authRailLabel(options.config)}`,
    `target ${mediationTargetLabel(state)}`,
    `target-tool ${bridgeTargetToolName(state)}`,
    `draft ${state.inputBuffer.trim() ? inlineText(state.inputBuffer.trim(), 36) : "-"}`,
    state.pendingRemoteAction ? `pending ${remoteActionLabel(state.pendingRemoteAction)}` : "",
  ]
    .filter((part) => part.length > 0)
    .join(" | ")
}

function liveOperationsRailText(options: StackAppOptions, state: AppState): string {
  const optimizerCounts = optimizerJobCounts(state.optimizerSnapshot)
  const remoteCounts = countRemoteJobs(state.remoteResearchSnapshot.jobs)
  const hostedCounts = countHostedOptimizerRuns(state.hostedOptimizerSnapshot.runs)
  const localLines = [
    "Agent Bridge",
    `mode local-only`,
    `status ${bridgeStatusToolName(state)}`,
    `mcp ${stackMcpStatusLabel(options.config)}`,
    `skill synth-via-stack · stack-agent-bridge`,
    `x switches remote bridge`,
    "",
    "Read Smoke Eval",
    evalLaunchRailLine(state.evalLaunch),
    evalLaunchTailLine(state.evalLaunch),
    "",
    "Local Optimizers",
    `${state.optimizerSnapshot.status} jobs ${optimizerCounts.total} active ${optimizerCounts.active}`,
    state.optimizerSnapshot.message ? oneLine(state.optimizerSnapshot.message, 36) : "",
    "",
    state.focusMode === "optimizers" ? "local: enter start | r refresh | j/k jobs" : "tab local optimizers for controls",
  ]
  const remoteLines = [
    "Agent Bridge",
    `mode remote-only`,
    `status ${bridgeStatusToolName(state)}`,
    `target ${bridgeTargetToolName(state)}`,
    `mcp ${stackMcpStatusLabel(options.config)}`,
    `skill synth-via-stack · stack-agent-bridge`,
    `x switches local bridge`,
    "",
    "Mediation",
    `target ${mediationTargetLabel(state)}`,
    `mcp ${stackMcpStatusLabel(options.config)}`,
    `auth ${authRailLabel(options.config)}`,
    state.inputBuffer.trim() ? `draft ${inlineText(state.inputBuffer.trim(), 28)}` : "draft -",
    "",
    "Hosted Optimizers",
    `${state.hostedOptimizerSnapshot.status} jobs ${state.hostedOptimizerSnapshot.runs.length} active ${hostedCounts.active}`,
    selectedHostedOptimizerRailLine(state),
    "",
    "Live SMRs",
    `${state.remoteResearchSnapshot.status} jobs ${state.remoteResearchSnapshot.jobs.length} active ${remoteCounts.active}`,
    selectedRemoteRunRailLine(state),
    latestRemoteDownloadRailLine(state),
    latestRemoteDownloadPreviewRailLine(state),
    latestRemotePreviewRailLine(state),
    "",
    "Factories",
    `count ${state.remoteResearchSnapshot.factories.length}`,
    selectedFactoryRailLine(state),
    "",
    state.focusMode === "remote" ? "remote: e eval | t target | m message | a attach | d download | v remote | l saved" : "tab remote for live actions",
    state.focusMode === "hosted" ? "hosted: o artifact | v preview | d download | c cancel" : "",
  ]
  return (state.liveOpsMode === "local" ? localLines : remoteLines).filter((line) => line.length > 0).join("\n")
}

function stackMcpStatusLabel(config: StackConfig): string {
  if (!config.stackMcpEnabled) return "disabled"
  const auth = environmentAuthStatus(config.environment)
  if (!auth.hasAuth) return `needs ${auth.authEnv}`
  return `env ${config.environmentName}`
}

function bridgeStatusToolName(state: AppState): string {
  return state.liveOpsMode === "local" ? "stack_status local" : "stack_status remote"
}

function bridgeTargetToolName(state: AppState): string {
  if (state.liveOpsMode === "local") return "stack_status"
  switch (state.mediationTargetKind) {
    case "remote-run":
      return "stack_list_live_smrs"
    case "factory":
      return "stack_list_factories"
    case "hosted-optimizer":
      return "stack_list_hosted_optimizer_runs"
  }
}

function authRailLabel(config: StackConfig): string {
  const auth = environmentAuthStatus(config.environment)
  if (auth.hasAuth) {
    return auth.source === "env-file" && auth.envFile
      ? `${auth.authEnv} loaded ${shortAuthPath(config, auth.envFile)}`
      : `${auth.authEnv} present`
  }
  return auth.envFile
    ? `needs ${auth.authEnv} from ${shortAuthPath(config, auth.envFile)}`
    : `needs ${auth.authEnv}`
}

function shortAuthPath(config: StackConfig, path: string): string {
  const rel = relative(config.appRoot, path)
  return rel.startsWith("..") ? path : rel
}

function evalLaunchRailLine(launch: StackEvalLaunch): string {
  return [
    launch.status,
    launch.pid ? `pid ${launch.pid}` : "",
    launch.runId ? `run ${inlineText(launch.runId, 10)}` : "",
    `${launch.instance}/${launch.target}`,
  ].filter((part) => part.length > 0).join(" ")
}

function evalLaunchTailLine(launch: StackEvalLaunch): string {
  if (launch.verificationFailures?.length) {
    return oneLine(`verify failed ${launch.verificationFailures.join(", ")}`, 36)
  }
  if (launch.failureLines?.length) return oneLine(`fail ${launch.failureLines.at(-1) ?? ""}`, 36)
  if (launch.verificationState) return oneLine(`verify ${launch.verificationState}`, 36)
  if (launch.smrState) return oneLine(`smr ${launch.smrState}`, 36)
  if (launch.message) return oneLine(launch.message, 36)
  return oneLine(launch.suite, 36)
}

function mediationTargetLabel(state: AppState): string {
  switch (state.mediationTargetKind) {
    case "remote-run": {
      const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
      return run ? `run ${inlineText(run.runId, 18)} ${run.state}` : "run none"
    }
    case "factory": {
      const factory = state.remoteResearchSnapshot.factories[state.selectedRemoteFactoryIndex]
      return factory ? `factory ${inlineText(factory.name, 18)} ${factory.status ?? "-"}` : "factory none"
    }
    case "hosted-optimizer": {
      const run = state.hostedOptimizerSnapshot.runs[state.selectedHostedOptimizerRunIndex]
      return run ? `hosted ${inlineText(run.runId, 18)} ${run.status}` : "hosted none"
    }
  }
}

function selectEvalRunIfKnown(state: AppState): void {
  const index = state.remoteResearchSnapshot.jobs.findIndex((run) => {
    if (state.evalLaunch.runId) return run.runId === state.evalLaunch.runId
    return Boolean(state.evalLaunch.projectId && run.projectId === state.evalLaunch.projectId)
  })
  if (index < 0) return
  state.evalLaunch.runId = state.remoteResearchSnapshot.jobs[index]?.runId ?? state.evalLaunch.runId
  state.selectedRemoteJobIndex = index
  state.selectedRemoteOutputIndex = clampIndex(state.selectedRemoteOutputIndex, currentRemoteOutputCount(state))
  state.mediationTargetKind = "remote-run"
}

function selectedRemoteRunRailLine(state: AppState): string {
  const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  if (!run) return "selected -"
  const detail = state.remoteResearchSnapshot.runDetails[run.runId]
  const messages = detail ? ` msg ${detail.runtimeMessageCount}/${detail.pendingRuntimeMessageCount}` : ""
  const files = detail ? ` files ${detail.activeFileMountCount}/${detail.fileMountCount}` : ""
  const download = latestRemoteDownloadForRun(state, run.runId)
  const downloaded = download ? ` dl ${inlineText(basename(download.path), 10)}` : ""
  return `selected ${inlineText(run.runbook ?? run.runId, 20)} ${run.phase ?? run.state}${messages}${files}${downloaded}`
}

function latestRemoteDownloadRailLine(state: AppState): string {
  const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  const download = run ? latestRemoteDownloadForRun(state, run.runId) : state.recentRemoteDownloads[0]
  if (!download) return "download -"
  const size = download.bytes === undefined ? "" : ` ${formatBytes(download.bytes)}`
  return `download ${inlineText(download.kind, 12)} ${inlineText(basename(download.path), 18)}${size}`
}

function latestRemoteDownloadPreviewRailLine(state: AppState): string {
  const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  const preview = run && state.recentRemoteDownloadPreview?.runId === run.runId ? state.recentRemoteDownloadPreview : undefined
  if (!preview) return "saved preview -"
  return `saved preview ${formatBytes(preview.previewBytes)}${preview.truncated ? "+" : ""} ${oneLine(preview.preview, 16)}`
}

function latestRemotePreviewRailLine(state: AppState): string {
  const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  const preview = run && state.recentRemoteOutputPreview?.runId === run.runId ? state.recentRemoteOutputPreview : undefined
  if (!preview) return "preview -"
  return `preview ${inlineText(preview.kind, 12)} ${formatBytes(preview.previewBytes)}${preview.truncated ? "+" : ""} ${oneLine(preview.preview, 18)}`
}

function selectedFactoryRailLine(state: AppState): string {
  const factory = state.remoteResearchSnapshot.factories[state.selectedRemoteFactoryIndex]
  if (!factory) return "selected -"
  const project = factory.canonicalProjectId ?? factory.latestProjectId
  return `selected ${inlineText(factory.name, 22)}${project ? ` project ${inlineText(project, 8)}` : ""}`
}

function selectedHostedOptimizerRailLine(state: AppState): string {
  const run = state.hostedOptimizerSnapshot.runs[state.selectedHostedOptimizerRunIndex]
  if (!run) return "selected -"
  const detail = state.hostedOptimizerSnapshot.runDetails[run.runId]
  const events = detail ? ` evt ${detail.eventCount}` : ""
  return `selected ${inlineText(run.algorithm, 8)} ${inlineText(run.runId, 18)}${events}`
}

function cycleMediationTarget(state: AppState): void {
  const options: MediationTargetKind[] = ["remote-run", "factory", "hosted-optimizer"]
  const current = Math.max(0, options.findIndex((option) => option === state.mediationTargetKind))
  state.mediationTargetKind = options[(current + 1) % options.length] ?? "remote-run"
}

function messageActionForMediationTarget(state: AppState): RemoteActionKind {
  return state.mediationTargetKind === "factory" ? "message-factory" : "message-run"
}

function optimizerLocalText(options: StackAppOptions, state: AppState): string {
  const snapshot = state.optimizerSnapshot
  const selectedRun = snapshot.runs[state.selectedOptimizerRunIndex]
  const counts = optimizerJobCounts(snapshot)
  return [
    "Local Research",
    `jobs ${counts.total} total   ${counts.active} active   ${counts.queued} queued`,
    `done ${counts.succeeded}   failed ${counts.failed}   canceled ${counts.cancelled}`,
    "",
    "Jobs",
    "  state     started  run",
    ...optimizerRunRows(state, 8),
    "",
    "Selected",
    ...(selectedRun ? selectedOptimizerRunText(options, selectedRun) : ["none"]),
    "",
    "Service",
    `${snapshot.status}  ${snapshot.serviceUrl}`,
    `pid ${snapshot.pid ? `${snapshot.pid}${snapshot.pidAlive === false ? " dead" : ""}` : "-"}`,
    `workers ${formatOptional(snapshot.activeWorkers)}/${formatOptional(snapshot.workerCount)}  queue ${formatOptional(snapshot.queuedRunnable)}/${formatOptional(snapshot.queuedBlocked)}`,
    `db ${oneLine(relative(options.workspace.root, snapshot.dbPath), 44)}`,
    "",
    state.focusMode === "optimizers" ? "enter start | r refresh | j/k select" : "tab here for start/refresh",
    snapshot.message ? oneLine(snapshot.message, 58) : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n")
}

function selectedOptimizerRunText(options: StackAppOptions, run: OptimizerRunSummary): string[] {
  return [
    `run ${oneLine(run.runId, 38)}`,
    run.requestId ? `req ${oneLine(run.requestId, 38)}` : "",
    `state ${run.status}${run.phase ? ` / ${run.phase}` : ""}`,
    `started ${formatOptimizerTimestamp(run.startedAt)}`,
    run.submittedAt && run.submittedAt !== run.startedAt ? `submitted ${formatOptimizerTimestamp(run.submittedAt)}` : "",
    run.finishedAt ? `finished ${formatOptimizerTimestamp(run.finishedAt)}` : "",
    run.error ? `issue ${oneLine(run.error, 48)}` : "",
    run.configPath ? `config ${oneLine(relative(options.workspace.root, run.configPath), 44)}` : "",
  ].filter((line) => line.length > 0)
}

function sessionText(options: StackAppOptions, state: AppState): string {
  const selected = state.history[state.selectedHistoryIndex]
  const remoteSections =
    state.liveOpsMode === "remote"
      ? [
          "",
          "Remote Account",
          ...remoteAccountText(state.remoteAccountSnapshot),
          "",
          "Hosted Optimizers",
          ...hostedOptimizerText(state),
          "",
          "Remote SMR",
          ...remoteResearchText(state),
        ]
      : [
          "",
          "Local Agent Bridge",
          "Remote Account hidden",
          "Hosted Optimizers hidden",
          "Remote SMR hidden",
          "x switches remote bridge",
        ]
  const currentUsage = buildSessionUsageSummary(
    options.session.turns,
    options.config.codexModel,
    options.config.codexPricing,
  )
  const selectedUsage = selected ? threadUsageSummary(options, selected) : undefined
  return [
    "Current",
    `${options.session.id.slice(0, 8)}  ${options.session.turns.length} turns  ${state.status}`,
    state.lastSessionLogPath ? `log: ${relative(options.workspace.root, state.lastSessionLogPath)}` : "log: after first turn",
    "",
    `session usage: ${formatSessionUsageSummary(currentUsage)}`,
    `last turn: ${compactUsageWithThroughput(state.lastUsage, state.emaTokensPerSecond)}`,
    "",
    "Selected Thread",
    selected ? `${selected.id.slice(0, 8)}  ${selected.turnCount} turns` : "(none)",
    selected ? `usage: ${formatSessionUsageSummary(selectedUsage)}` : "",
    selected ? `updated: ${selected.updatedAt}` : "",
    selected ? `prompt: ${selected.lastPrompt ? oneLine(selected.lastPrompt, 30) : "(empty)"}` : "",
    ...remoteSections,
  ].join("\n")
}

function remoteAccountText(snapshot: RemoteAccountSnapshot): string[] {
  const lines = [
    `env: ${snapshot.environmentLabel} (${snapshot.environmentName})`,
    `status: ${snapshot.status}`,
    `api: ${snapshot.apiBaseUrl}`,
    `auth: ${snapshot.hasAuth ? "present" : "needs"} ${snapshot.authEnv}`,
    snapshot.keyHint ? `key: ${snapshot.keyHint}` : "",
    snapshot.auth.envFile ? `auth file: ${oneLine(snapshot.auth.envFile, 46)}` : "",
    snapshot.message ? `note: ${oneLine(snapshot.message, 46)}` : "",
  ].filter((line) => line.length > 0)
  if (!snapshot.hasAuth || snapshot.status === "missing-auth" || snapshot.status === "invalid-auth") {
    lines.push(`setup: ${oneLine(authSetupHint(snapshot.auth), 46)}`)
  }
  return lines
}

function remoteResearchText(state: AppState): string[] {
  const snapshot = state.remoteResearchSnapshot
  const selectedJob = snapshot.jobs[state.selectedRemoteJobIndex]
  const selectedFactory = snapshot.factories[state.selectedRemoteFactoryIndex]
  const jobCounts = countRemoteJobs(snapshot.jobs)
  return [
    `env: ${snapshot.environmentName}  ${snapshot.status}`,
    snapshot.message ? oneLine(snapshot.message, 40) : "",
    state.focusMode === "remote" ? "r refresh | e eval | j/k jobs | f factory | o output | t target" : "tab here for remote SMR",
    state.focusMode === "remote" ? "m message | a attach | p pause | u resume | s stop | w wake | d download | v remote | l saved" : "",
    state.focusMode === "remote" ? "attach draft: local/path -> optional/remote/path" : "",
    state.pendingRemoteAction ? `pending: ${remoteActionLabel(state.pendingRemoteAction)}` : "",
    state.remoteActionMessage ? `action: ${oneLine(state.remoteActionMessage, 40)}` : "",
    ...evalLaunchDetailText(state.evalLaunch),
    "",
    `jobs: ${snapshot.jobs.length} recent  active ${jobCounts.active}`,
    "  state     at     run",
    ...remoteJobRows(state, 4),
    "",
    "Selected Run",
    ...(selectedJob ? selectedRemoteJobText(state, selectedJob) : ["none"]),
    "",
    `factories: ${snapshot.factories.length}`,
    ...remoteFactoryRows(state, 3),
    "",
    "Selected Factory",
    ...(selectedFactory ? selectedRemoteFactoryText(selectedFactory) : ["none"]),
  ].filter((line) => line.length > 0)
}

function evalLaunchDetailText(launch: StackEvalLaunch): string[] {
  return [
    `eval: ${launch.status} ${launch.pid ? `pid ${launch.pid}` : launch.instance}`,
    launch.exitCode !== undefined ? `eval exit ${launch.exitCode ?? launch.signal ?? "-"}` : "",
    launch.runId ? `eval run ${inlineText(launch.runId, 34)}` : "",
    launch.projectId ? `eval project ${inlineText(launch.projectId, 30)}` : "",
    launch.smrState ? `eval smr ${launch.smrState}` : "",
    launch.verificationState ? `eval verify ${inlineText(launch.verificationState, 30)}` : "",
    launch.verificationFailures?.length
      ? `eval failures ${inlineText(launch.verificationFailures.join(", "), 28)}`
      : "",
    launch.reward !== undefined || launch.gradeCost !== undefined
      ? `eval score ${launch.reward ?? "-"} cost ${launch.gradeCost ?? "-"}`
      : "",
    launch.actualCostCents !== undefined ? `eval spend ${launch.actualCostCents}c` : "",
    launch.outputRoot ? `eval output ${inlineText(launch.outputRoot, 30)}` : "",
    launch.runlog ? `eval runlog ${inlineText(launch.runlog, 30)}` : "",
    launch.phaseLog ? `eval phase log ${inlineText(launch.phaseLog, 26)}` : "",
    ...evalFailureText(launch),
    launch.message ? `eval note: ${oneLine(launch.message, 36)}` : "",
  ].filter((line) => line.length > 0)
}

function evalFailureText(launch: StackEvalLaunch): string[] {
  const lines = launch.failureLines ?? []
  if (lines.length === 0) return []
  return [
    "Eval Failure Context",
    ...lines.slice(-3).map((line) => `  ${oneLine(line, 38)}`),
  ]
}

function hostedOptimizerText(state: AppState): string[] {
  const snapshot = state.hostedOptimizerSnapshot
  const selectedRun = snapshot.runs[state.selectedHostedOptimizerRunIndex]
  const counts = countHostedOptimizerRuns(snapshot.runs)
  return [
    `env: ${snapshot.environmentName}  ${snapshot.status}`,
    snapshot.message ? oneLine(snapshot.message, 40) : "",
    state.focusMode === "hosted" ? "r refresh | j/k jobs | o artifact | v preview | d download | c cancel" : "tab here for hosted jobs",
    state.focusMode === "hosted" ? "enter confirms staged action" : "",
    state.pendingHostedOptimizerAction ? `pending: ${hostedOptimizerActionLabel(state.pendingHostedOptimizerAction)}` : "",
    state.hostedOptimizerActionMessage ? `action: ${oneLine(state.hostedOptimizerActionMessage, 40)}` : "",
    "",
    `jobs: ${snapshot.runs.length} recent  active ${counts.active}`,
    `done ${counts.done}   failed ${counts.failed}   canceled ${counts.cancelled}`,
    "  state     at     optimizer",
    ...hostedOptimizerRows(state, 4),
    "",
    "Selected Hosted Job",
    ...(selectedRun ? selectedHostedOptimizerText(state, snapshot, selectedRun) : ["none"]),
  ].filter((line) => line.length > 0)
}

function hostedOptimizerRows(state: AppState, limit: number): string[] {
  const runs = state.hostedOptimizerSnapshot.runs
  if (runs.length === 0) return ["  no hosted optimizer jobs"]
  const start = selectedWindowStart(state.selectedHostedOptimizerRunIndex, runs.length, limit)
  const rows = runs.slice(start, start + limit).map((run, offset) => {
    const index = start + offset
    const cursor = state.focusMode === "hosted" && index === state.selectedHostedOptimizerRunIndex ? ">" : " "
    const status = inlineText(run.status, 8).padEnd(8)
    const at = formatRemoteShortTime(run.submittedAt ?? run.createdAt ?? run.updatedAt)
    const label = inlineText(`${run.algorithm} ${run.runId}`, 23)
    const cancellation = run.cancellationRequested ? " canceling" : ""
    return `${cursor} ${status} ${at} ${label}${cancellation}`
  })
  if (start > 0) rows.unshift(`  ... ${start} newer`)
  const hiddenOlder = runs.length - (start + limit)
  if (hiddenOlder > 0) rows.push(`  ... ${hiddenOlder} older`)
  return rows
}

function selectedHostedOptimizerText(
  state: AppState,
  snapshot: HostedOptimizerSnapshot,
  run: HostedOptimizerRunSummary,
): string[] {
  const detail = snapshot.runDetails[run.runId]
  return [
    `run ${inlineText(run.runId, 28)}`,
    run.projectId ? `project ${inlineText(run.projectId, 26)}` : "",
    `algorithm ${run.algorithm}`,
    `status ${run.status}${run.finalizeState ? ` / ${run.finalizeState}` : ""}`,
    run.storageMode ? `storage ${run.storageMode}` : "",
    `submitted ${formatRemoteTimestamp(run.submittedAt ?? run.createdAt)}`,
    run.updatedAt ? `updated ${formatRemoteTimestamp(run.updatedAt)}` : "",
    run.terminalAt ? `terminal ${formatRemoteTimestamp(run.terminalAt)}` : "",
    run.cursorSeq !== undefined ? `cursor ${run.cursorSeq}` : "",
    run.cancellationRequested ? "cancellation requested" : "",
    run.error ? `issue ${inlineText(run.error, 34)}` : "",
    ...(detail ? selectedHostedOptimizerDetailText(detail) : ["detail: not loaded"]),
    ...selectedHostedOptimizerArtifactText(state, run),
  ].filter((line) => line.length > 0)
}

function selectedHostedOptimizerDetailText(
  detail: HostedOptimizerSnapshot["runDetails"][string],
): string[] {
  return [
    detail.status ? `detail status ${detail.status}` : "",
    detail.backendUpdatedAt ? `backend ${formatRemoteTimestamp(detail.backendUpdatedAt)}` : "",
    detail.resultKeys.length ? `result ${inlineText(detail.resultKeys.join(", "), 34)}` : "",
    detail.stateKeys.length ? `state ${inlineText(detail.stateKeys.join(", "), 34)}` : "",
    detail.artifactNames.length ? `artifacts ${inlineText(detail.artifactNames.join(", "), 30)}` : "",
    `events ${detail.eventCount}${detail.latestEventSeq !== undefined ? ` latest ${detail.latestEventSeq}` : ""}`,
    detail.eventTypes.length ? `event types ${inlineText(detail.eventTypes.join(", "), 32)}` : "",
    detail.message ? `detail issue ${inlineText(detail.message, 34)}` : "",
  ].filter((line) => line.length > 0)
}

function selectedHostedOptimizerArtifactText(state: AppState, run: HostedOptimizerRunSummary): string[] {
  const artifactName = selectedHostedOptimizerArtifactName(state)
  const detail = state.hostedOptimizerSnapshot.runDetails[run.runId]
  const total = detail?.artifactNames.length ?? 0
  const preview = state.recentHostedOptimizerArtifactPreview
  const download = state.recentHostedOptimizerArtifactDownload
  const selectedPreview = preview?.runId === run.runId && preview.artifactName === artifactName ? preview : undefined
  const selectedDownload = download?.runId === run.runId && download.artifactName === artifactName ? download : undefined
  return [
    total ? `artifact ${state.selectedHostedOptimizerArtifactIndex + 1}/${total} ${inlineText(artifactName ?? "-", 30)}` : "",
    selectedPreview ? `artifact preview ${formatBytes(selectedPreview.previewBytes)}${selectedPreview.truncated ? "+" : ""} ${oneLine(selectedPreview.preview, 30)}` : "",
    selectedDownload ? `artifact download ${inlineText(basename(selectedDownload.outputPath), 28)} ${formatBytes(selectedDownload.bytes)}` : "",
  ].filter((line) => line.length > 0)
}

function remoteJobRows(state: AppState, limit: number): string[] {
  const jobs = state.remoteResearchSnapshot.jobs
  if (jobs.length === 0) return ["  no remote jobs"]
  const start = selectedWindowStart(state.selectedRemoteJobIndex, jobs.length, limit)
  const rows = jobs.slice(start, start + limit).map((job, offset) => {
    const index = start + offset
    const cursor = state.focusMode === "remote" && index === state.selectedRemoteJobIndex ? ">" : " "
    const runState = inlineText(job.state, 8).padEnd(8)
    const at = formatRemoteShortTime(job.startedAt ?? job.createdAt ?? job.updatedAt)
    const name = inlineText(job.runbook ?? job.runId, 20)
    return `${cursor} ${runState} ${at} ${name}`
  })
  if (start > 0) rows.unshift(`  ... ${start} newer`)
  const hiddenOlder = jobs.length - (start + limit)
  if (hiddenOlder > 0) rows.push(`  ... ${hiddenOlder} older`)
  return rows
}

function remoteFactoryRows(state: AppState, limit: number): string[] {
  const factories = state.remoteResearchSnapshot.factories
  if (factories.length === 0) return ["  no factories"]
  const start = selectedWindowStart(state.selectedRemoteFactoryIndex, factories.length, limit)
  const rows = factories.slice(start, start + limit).map((factory, offset) => {
    const index = start + offset
    const cursor = state.focusMode === "remote" && index === state.selectedRemoteFactoryIndex ? ">" : " "
    const status = inlineText(factory.status ?? "-", 7).padEnd(7)
    const wake = factory.nextWakeAt ? ` wake ${formatRemoteShortTime(factory.nextWakeAt)}` : ""
    return `${cursor} ${status} ${inlineText(factory.name, 22)}${wake}`
  })
  if (start > 0) rows.unshift(`  ... ${start} newer`)
  const hiddenOlder = factories.length - (start + limit)
  if (hiddenOlder > 0) rows.push(`  ... ${hiddenOlder} older`)
  return rows
}

function selectedRemoteJobText(state: AppState, job: RemoteSmrRunSummary): string[] {
  const detail = state.remoteResearchSnapshot.runDetails[job.runId]
  const download = latestRemoteDownloadForRun(state, job.runId)
  const downloadPreview = selectedRemoteDownloadPreview(state, download)
  return [
    `run ${inlineText(job.runId, 28)}`,
    job.projectId ? `project ${inlineText(job.projectId, 26)}` : "",
    `state ${job.state}${job.phase ? ` / ${job.phase}` : ""}`,
    `started ${formatRemoteTimestamp(job.startedAt ?? job.createdAt)}`,
    job.updatedAt ? `updated ${formatRemoteTimestamp(job.updatedAt)}` : "",
    job.finishedAt ? `finished ${formatRemoteTimestamp(job.finishedAt)}` : "",
    job.runbook ? `runbook ${inlineText(job.runbook, 30)}` : "",
    job.reason ? `reason ${inlineText(job.reason, 30)}` : "",
    download ? `downloaded ${remoteDownloadLabel(download)}` : "",
    ...(downloadPreview ? remoteSavedDownloadPreviewText(downloadPreview) : []),
    ...remoteRunDetailText(state, detail),
  ].filter((line) => line.length > 0)
}

function latestRemoteDownloadForRun(state: AppState, runId: string): RemoteDownloadRecord | undefined {
  return state.recentRemoteDownloads.find((download) => download.runId === runId)
}

function remoteDownloadLabel(download: RemoteDownloadRecord): string {
  const size = download.bytes === undefined ? "" : ` ${formatBytes(download.bytes)}`
  return `${download.kind} ${inlineText(download.label, 18)} -> ${inlineText(basename(download.path), 18)}${size}`
}

function selectedRemoteDownloadPreview(
  state: AppState,
  download: RemoteDownloadRecord | undefined,
): RemoteSavedDownloadPreview | undefined {
  const preview = state.recentRemoteDownloadPreview
  if (!preview || !download) return undefined
  if (preview.runId !== download.runId) return undefined
  if (preview.outputId !== download.outputId) return undefined
  if (preview.path !== download.path) return undefined
  return preview
}

function remoteSavedDownloadPreviewText(preview: RemoteSavedDownloadPreview): string[] {
  const suffix = preview.truncated ? ` of ${formatBytes(preview.bytes)}` : ""
  return [
    `saved preview ${formatBytes(preview.previewBytes)}${suffix}`,
    ...preview.preview.split(/\r?\n/).slice(0, 3).map((line) => `  > ${oneLine(line, 34)}`),
  ].filter((line) => line.length > 0)
}

function remoteRunDetailText(state: AppState, detail: RemoteRunDetail | undefined): string[] {
  if (!detail) return ["detail: not loaded"]
  const artifactKinds = compactCounts(detail.artifactTypes)
  const workProductKinds = compactCounts(detail.workProductKinds)
  const selected = selectedRemoteOutput(state)
  return [
    `artifacts ${detail.artifactCount}${artifactKinds ? ` (${artifactKinds})` : ""}`,
    `work products ${detail.workProductCount}${workProductKinds ? ` (${workProductKinds})` : ""}`,
    `runtime messages ${detail.runtimeMessageCount} pending ${detail.pendingRuntimeMessageCount}`,
    `run files ${detail.activeFileMountCount} active / ${detail.fileMountCount} mounted`,
    detail.runtimeMessages[0] ? `latest msg ${inlineText(runtimeMessageLabel(detail.runtimeMessages[0]), 32)}` : "",
    selected ? `selected output ${selected.kind} ${inlineText(remoteOutputLabel(selected), 24)}` : "",
    ...(selected ? selectedRemoteOutputDetailText(state, selected, detail) : []),
    ...remoteFileMountRows(detail, 3),
    ...remoteWorkProductRows(state, detail, 3),
    ...remoteArtifactRows(state, detail, 3),
    detail.message ? `detail issue ${inlineText(detail.message, 34)}` : "",
  ].filter((line) => line.length > 0)
}

function selectedRemoteOutputDetailText(
  state: AppState,
  selection: RemoteOutputSelection,
  detail: RemoteRunDetail,
): string[] {
  const current = clampIndex(state.selectedRemoteOutputIndex, detail.workProducts.length + detail.artifacts.length) + 1
  const total = detail.workProducts.length + detail.artifacts.length
  const preview = selectedRemoteOutputPreview(state, selection)
  const previewLines = preview ? remoteOutputPreviewText(preview) : []
  if (selection.kind === "work-product") {
    const item = selection.item
    return [
      `output ${current}/${total} work-product`,
      `  id ${inlineText(item.workProductId, 30)}`,
      item.kind ? `  kind ${inlineText(item.kind, 28)}` : "",
      item.status || item.readiness ? `  status ${inlineText(item.status ?? item.readiness ?? "-", 26)}` : "",
      item.artifactId ? `  artifact ${inlineText(item.artifactId, 26)}` : "",
      item.createdAt ? `  created ${formatRemoteTimestamp(item.createdAt)}` : "",
      ...previewLines,
    ].filter((line) => line.length > 0)
  }
  const item = selection.item
  return [
    `output ${current}/${total} artifact`,
    `  id ${inlineText(item.artifactId, 30)}`,
    item.artifactType ? `  type ${inlineText(item.artifactType, 28)}` : "",
    item.createdAt ? `  created ${formatRemoteTimestamp(item.createdAt)}` : "",
    ...previewLines,
  ].filter((line) => line.length > 0)
}

function selectedRemoteOutputPreview(
  state: AppState,
  selection: RemoteOutputSelection,
): RemoteOutputPreview | undefined {
  const preview = state.recentRemoteOutputPreview
  if (!preview) return undefined
  if (preview.runId !== selection.run.runId) return undefined
  if (preview.kind !== selection.kind) return undefined
  if (preview.outputId !== remoteOutputSelectionId(selection)) return undefined
  return preview
}

function remoteOutputPreviewText(preview: RemoteOutputPreview): string[] {
  const suffix = preview.truncated ? ` of ${formatBytes(preview.bytes)}` : ""
  return [
    `  preview ${formatBytes(preview.previewBytes)}${suffix}`,
    ...preview.preview.split(/\r?\n/).slice(0, 3).map((line) => `  > ${oneLine(line, 34)}`),
  ].filter((line) => line.length > 0)
}

function remoteFileMountRows(detail: RemoteRunDetail, limit: number): string[] {
  if (detail.fileMounts.length === 0) return []
  return [
    "Run Files",
    ...detail.fileMounts.slice(0, limit).map((mount) => {
      const active = mount.active ? "active" : "inactive"
      const size = mount.contentBytes === undefined ? "" : ` ${formatBytes(mount.contentBytes)}`
      return `  ${inlineText(active, 8)} ${inlineText(mount.mountPath, 28)}${size}`
    }),
    detail.fileMounts.length > limit ? `  ... ${detail.fileMounts.length - limit} more` : "",
  ].filter((line) => line.length > 0)
}

function remoteWorkProductRows(state: AppState, detail: RemoteRunDetail, limit: number): string[] {
  if (detail.workProducts.length === 0) return []
  return [
    "WorkProducts",
    ...detail.workProducts.slice(0, limit).map((workProduct, index) => {
      const cursor = state.focusMode === "remote" && state.selectedRemoteOutputIndex === index ? ">" : " "
      const status = inlineText(workProduct.status ?? workProduct.readiness ?? "-", 8).padEnd(8)
      const label = inlineText(workProduct.title ?? workProduct.workProductId, 25)
      const kind = workProduct.kind ? `${inlineText(workProduct.kind, 8)} ` : ""
      return `${cursor} ${status} ${kind}${label}`
    }),
    detail.workProducts.length > limit ? `  ... ${detail.workProducts.length - limit} more` : "",
  ].filter((line) => line.length > 0)
}

function remoteArtifactRows(state: AppState, detail: RemoteRunDetail, limit: number): string[] {
  if (detail.artifacts.length === 0) return []
  const offset = detail.workProducts.length
  return [
    "Artifacts",
    ...detail.artifacts.slice(0, limit).map((artifact, index) => {
      const cursor = state.focusMode === "remote" && state.selectedRemoteOutputIndex === offset + index ? ">" : " "
      const type = inlineText(artifact.artifactType ?? "-", 9).padEnd(9)
      const label = inlineText(artifact.title ?? artifact.artifactId, 25)
      return `${cursor} ${type} ${label}`
    }),
    detail.artifacts.length > limit ? `  ... ${detail.artifacts.length - limit} more` : "",
  ].filter((line) => line.length > 0)
}

function runtimeMessageLabel(message: RemoteRunDetail["runtimeMessages"][number]): string {
  return [
    message.status ?? "-",
    message.mode ?? "",
    message.action ?? "",
    message.body ? `"${message.body}"` : "",
  ].filter((part) => part.length > 0).join(" ")
}

function selectedRemoteFactoryText(factory: RemoteFactorySummary): string[] {
  return [
    inlineText(factory.name, 34),
    `id ${inlineText(factory.factoryId, 30)}`,
    `status ${factory.status ?? "-"}${factory.kind ? ` / ${factory.kind}` : ""}`,
    factory.canonicalProjectId ? `project ${inlineText(factory.canonicalProjectId, 28)}` : "",
    factory.latestProjectId && factory.latestProjectId !== factory.canonicalProjectId ? `latest project ${inlineText(factory.latestProjectId, 20)}` : "",
    factory.nextWakeAt ? `next ${formatRemoteTimestamp(factory.nextWakeAt)}` : "next -",
    `active ${formatOptional(factory.activeEfforts)} waiting ${formatOptional(factory.pausedOrWaiting)}`,
    factory.latestRunId ? `latest run ${inlineText(factory.latestRunId, 25)}` : "",
    factory.latestWorkProductId ? `latest wp ${inlineText(factory.latestWorkProductId, 26)}` : "",
  ].filter((line) => line.length > 0)
}

function currentRemoteRunDetail(state: AppState): RemoteRunDetail | undefined {
  const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  return run ? state.remoteResearchSnapshot.runDetails[run.runId] : undefined
}

function currentRemoteOutputCount(state: AppState): number {
  const detail = currentRemoteRunDetail(state)
  return detail ? detail.workProducts.length + detail.artifacts.length : 0
}

function currentHostedOptimizerArtifactCount(state: AppState): number {
  const run = state.hostedOptimizerSnapshot.runs[state.selectedHostedOptimizerRunIndex]
  if (!run) return 0
  return state.hostedOptimizerSnapshot.runDetails[run.runId]?.artifactNames.length ?? 0
}

function selectedHostedOptimizerArtifactName(state: AppState): string | undefined {
  const run = state.hostedOptimizerSnapshot.runs[state.selectedHostedOptimizerRunIndex]
  if (!run) return undefined
  const names = state.hostedOptimizerSnapshot.runDetails[run.runId]?.artifactNames ?? []
  return names[clampIndex(state.selectedHostedOptimizerArtifactIndex, names.length)]
}

function selectedRemoteOutput(state: AppState): RemoteOutputSelection | undefined {
  const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  const detail = currentRemoteRunDetail(state)
  if (!run || !detail) return undefined
  const index = clampIndex(state.selectedRemoteOutputIndex, detail.workProducts.length + detail.artifacts.length)
  const workProduct = detail.workProducts[index]
  if (workProduct) {
    return { kind: "work-product", run, item: workProduct }
  }
  const artifact = detail.artifacts[index - detail.workProducts.length]
  if (artifact) {
    return { kind: "artifact", run, item: artifact }
  }
  return undefined
}

function remoteOutputLabel(selection: RemoteOutputSelection): string {
  return selection.kind === "work-product"
    ? selection.item.title ?? selection.item.workProductId
    : selection.item.title ?? selection.item.artifactId
}

function remoteOutputSelectionId(selection: RemoteOutputSelection): string {
  return selection.kind === "work-product" ? selection.item.workProductId : selection.item.artifactId
}

function compactCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .slice(0, 3)
    .map(([key, value]) => `${inlineText(key, 12)}:${value}`)
    .join(" ")
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value}B`
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10}KB`
  return `${Math.round(value / 104857.6) / 10}MB`
}

function selectedWindowStart(selectedIndex: number, length: number, limit: number): number {
  if (length <= limit) return 0
  const middleOffset = Math.floor(limit / 2)
  return Math.max(0, Math.min(length - limit, selectedIndex - middleOffset))
}

function formatRemoteShortTime(value: string | undefined): string {
  return value ? formatShortTime(value).padEnd(5) : "--:--"
}

function formatRemoteTimestamp(value: string | undefined): string {
  if (!value) return "-"
  return formatOptimizerTimestamp(value)
}

function countRemoteJobs(jobs: RemoteSmrRunSummary[]): { active: number } {
  const active = jobs.filter((job) => {
    const state = job.state.toLowerCase()
    return !["completed", "failed", "blocked", "cancelled", "canceled", "stopped"].includes(state)
  }).length
  return { active }
}

function countHostedOptimizerRuns(
  runs: HostedOptimizerRunSummary[],
): { active: number; done: number; failed: number; cancelled: number } {
  let active = 0
  let done = 0
  let failed = 0
  let cancelled = 0
  for (const run of runs) {
    const status = run.status.toLowerCase()
    if (status === "succeeded" || status === "completed") {
      done += 1
    } else if (status === "failed") {
      failed += 1
    } else if (status === "cancelled" || status === "canceled") {
      cancelled += 1
    } else {
      active += 1
    }
  }
  return { active, done, failed, cancelled }
}

function usageText(usage: StackCodexUsage | undefined): string[] {
  if (!usage) return ["(after first turn)"]
  return [
    `input: ${formatUsageNumber(usage.inputTokens)}`,
    `cached: ${formatUsageNumber(usage.cachedInputTokens)}`,
    `output: ${formatUsageNumber(usage.outputTokens)}`,
    `reasoning: ${formatUsageNumber(usage.reasoningOutputTokens)}`,
  ]
}

function formatUsageNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US")
}

function compactUsageText(usage: StackCodexUsage | undefined, emaTokensPerSecond?: number): string {
  return compactUsageWithThroughput(usage, emaTokensPerSecond)
}

function liveTurnThroughput(state: AppState): LiveTurnThroughput | undefined {
  if (!state.currentTurnStartedAt || !state.lastUsage) return undefined
  return { startedAt: state.currentTurnStartedAt, usage: state.lastUsage }
}

function historyWindowStart(state: AppState, visibleRows = SESSION_HISTORY_VISIBLE_ROWS): number {
  if (state.history.length <= visibleRows) return 0
  const middleOffset = Math.floor(visibleRows / 2)
  return Math.max(0, Math.min(state.history.length - visibleRows, state.selectedHistoryIndex - middleOffset))
}

function transcriptViewportMetrics(renderer: CliRenderer, state: AppState): TranscriptViewport {
  const lines = Math.max(8, renderer.terminalHeight - (state.railsVisible ? 12 : 10))
  const widthShare = state.railsVisible ? 0.5 : 0.72
  const columns = Math.max(40, Math.floor(renderer.terminalWidth * widthShare) - 8)
  return {
    lines,
    columns,
    pageLines: Math.max(3, Math.floor(lines * 0.8)),
  }
}

function scrollAgentTranscript(
  state: AppState,
  delta: number,
  viewport?: TranscriptViewport,
  direction: "up" | "down" = "up",
): void {
  const metrics = viewport ?? { lines: 12, columns: 80, pageLines: 10 }
  const maxOffset = maxTranscriptScrollOffset(
    state.blocks,
    state.toolLogs,
    state.subagentLogs,
    metrics.columns,
    transcriptRenderOptions(state),
    metrics.lines,
  )
  const signedDelta = direction === "up" ? delta : -delta
  state.agentScrollOffset = Math.max(0, Math.min(maxOffset, state.agentScrollOffset + signedDelta))
}

function handleAgentScrollKey(key: { name?: string; ctrl?: boolean }, state: AppState, renderer?: CliRenderer): boolean {
  const viewport = renderer ? transcriptViewportMetrics(renderer, state) : undefined
  if (key.name === "pageup" || (key.ctrl && key.name === "u")) {
    state.lastAgentScrollAt = Date.now()
    scrollAgentTranscript(state, viewport?.pageLines ?? 10, viewport, "up")
    return true
  }
  if (key.name === "pagedown" || (key.ctrl && key.name === "d")) {
    state.lastAgentScrollAt = Date.now()
    scrollAgentTranscript(state, viewport?.pageLines ?? 10, viewport, "down")
    return true
  }
  if (key.name === "home") {
    const metrics = viewport ?? { lines: 12, columns: 80, pageLines: 10 }
    state.lastAgentScrollAt = Date.now()
    state.agentScrollOffset = maxTranscriptScrollOffset(
      state.blocks,
      state.toolLogs,
      state.subagentLogs,
      metrics.columns,
      transcriptRenderOptions(state),
      metrics.lines,
    )
    return true
  }
  if (key.name === "end") {
    state.lastAgentScrollAt = Date.now()
    state.agentScrollOffset = 0
    return true
  }
  return false
}

function createCodexTranscriptSink(
  state: AppState,
  workspaceRoot: string,
  onUsage: (usage: StackCodexUsage) => void,
  onActivity?: () => void,
  onThreadStarted?: (threadId: string) => void,
  onRateLimits?: (limits: CodexRateLimitsSnapshot) => void,
): {
  write: (chunk: string) => void
  flush: () => void
  readonly hasVisibleOutput: boolean
} {
  let buffer = ""
  let visibleOutput = false
  const liveThinkingId = {
    get current() {
      return state.liveThinkingId
    },
    set current(value: string | undefined) {
      state.liveThinkingId = value
    },
  }
  const turnStartedAt = {
    get current() {
      return state.turnStartedAt
    },
    set current(value: string | undefined) {
      state.turnStartedAt = value
    },
  }

  const liveToolGroupId: { current?: string } = {}
  const liveSubagentGroupId: { current?: string } = {}
  const multiAgentCalls = new Map<string, import("./subagents.js").MultiAgentCallMeta & { callId: string }>()

  const processLine = (line: string) => {
    if (!line.trim()) return
    const rendered = applyCodexLine(
      state.blocks,
      state.toolLogs,
      state.subagentLogs,
      liveThinkingId,
      liveToolGroupId,
      liveSubagentGroupId,
      multiAgentCalls,
      turnStartedAt,
      line,
    )
    if (rendered === undefined) return
    if (rendered.usage) onUsage(rendered.usage as StackCodexUsage)
    if (rendered.agentText || rendered.stackText || rendered.tool || rendered.subagent) visibleOutput = true
    if (rendered.thinking !== undefined) state.liveThinkingText = rendered.thinking
    if (rendered.turnCompleted) state.liveThinkingText = undefined
    if (rendered.threadId) onThreadStarted?.(rendered.threadId)
    if (rendered.rateLimits) onRateLimits?.(rendered.rateLimits)
    if (rendered.tool) {
      state.selectedToolIndex = clampIndex(state.toolLogs.length - 1, state.toolLogs.length)
      const toolText = [rendered.tool.command, rendered.tool.output, rendered.tool.stdout, rendered.tool.stderr]
        .filter((part): part is string => Boolean(part))
        .join("\n")
      if (toolText.includes("SKILL.md")) {
        state.agentContext = {
          ...state.agentContext,
          usedSkills: noteUsedSkillsFromText(toolText, state.agentContext.usedSkills),
        }
      }
    }
    onActivity?.()
  }

  return {
    write(chunk: string) {
      buffer += chunk
      while (true) {
        const newlineIndex = buffer.indexOf("\n")
        if (newlineIndex < 0) return
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        processLine(line)
      }
    },
    flush() {
      if (!buffer) return
      processLine(buffer)
      buffer = ""
    },
    get hasVisibleOutput() {
      return visibleOutput || state.blocks.some((block) => block.kind === "agent")
    },
  }
}

function isRecentAgentScroll(state: AppState): boolean {
  return state.lastAgentScrollAt !== undefined && Date.now() - state.lastAgentScrollAt < 450
}

async function refreshAgentContextFromThread(
  state: AppState,
  threadId: string,
  workspaceRoot: string,
  refresh?: () => void,
): Promise<void> {
  const [sessionContext, rateLimits] = await Promise.all([
    readAgentContextFromSession(threadId),
    readCodexRateLimitsFromSession(threadId),
  ])
  if (sessionContext) {
    state.agentContext = mergeAgentContext(state.agentContext, sessionContext)
    if (state.agentContext.agentsMd.length === 0) {
      state.agentContext = {
        ...state.agentContext,
        agentsMd: emptyAgentContext(workspaceRoot).agentsMd,
      }
    }
  }
  if (rateLimits) state.codexRateLimits = rateLimits
  refresh?.()
}

async function refreshAgentContextFromSession(
  options: StackAppOptions,
  state: AppState,
  refresh?: () => void,
): Promise<void> {
  const threadId =
    options.session.codexThreadId ?? extractCodexThreadIdFromTurns(options.session.turns)
  if (threadId) {
    options.session.codexThreadId = threadId
    await refreshAgentContextFromThread(state, threadId, options.session.workspaceRoot, refresh)
    return
  }
  state.agentContext = emptyAgentContext(options.session.workspaceRoot)
  refresh?.()
}

function optimizerRunDetailText(options: StackAppOptions, state: AppState): string {
  const snapshot = state.optimizerSnapshot
  const run = snapshot.runs[state.selectedOptimizerRunIndex]
  if (!run) {
    return [
      "no optimizer job selected",
      `service: ${snapshot.status}   url: ${snapshot.serviceUrl}`,
      `log: ${relative(options.workspace.root, snapshot.logPath)}`,
      snapshot.message ?? "",
    ].join("\n")
  }

  return [
    `job ${state.selectedOptimizerRunIndex + 1}/${snapshot.runs.length} ${run.runId}`,
    run.requestId ? `request=${run.requestId}` : "",
    `status=${run.status} phase=${run.phase ?? "-"} generation=${run.generation ?? "-"}`,
    `candidates=${run.candidateCount ?? "-"} best=${run.bestCandidateId ?? "-"}`,
    `tokens=${formatUsageNumber(run.totalTokens)} cost=${run.costUsd === undefined ? "-" : `$${run.costUsd.toFixed(4)}`}`,
    `submitted=${run.submittedAt ?? "-"} started=${run.startedAt ?? "-"} finished=${run.finishedAt ?? "-"}`,
    run.configPath ? `config=${relative(options.workspace.root, run.configPath)}` : "",
    run.error ? `error=${run.error}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n")
}

function handleToolKey(key: { name?: string }, state: AppState): void {
  if (state.toolLogs.length === 0) return
  if (key.name === "j" || key.name === "down") {
    state.selectedToolIndex = Math.min(state.toolLogs.length - 1, state.selectedToolIndex + 1)
  } else if (key.name === "k" || key.name === "up") {
    state.selectedToolIndex = Math.max(0, state.selectedToolIndex - 1)
  }
}

function optimizerRunRows(state: AppState, limit: number): string[] {
  const counts = optimizerJobCounts(state.optimizerSnapshot)
  if (state.optimizerSnapshot.runs.length === 0) {
    if (counts.total > 0) return ["rows unavailable; press r to refresh or restart Stack"]
    return ["(no optimizer jobs yet)"]
  }
  return state.optimizerSnapshot.runs.slice(0, limit).map((run, index) => {
    const cursor = state.focusMode === "optimizers" && index === state.selectedOptimizerRunIndex ? ">" : " "
    return `${cursor} ${optimizerStatusLabel(run.status)} ${optimizerStartedTimeLabel(run)}  ${optimizerJobLabel(run)}`
  })
}

function optimizerJobCounts(snapshot: OptimizerSnapshot): {
  total: number
  queued: number
  active: number
  succeeded: number
  failed: number
  cancelled: number
} {
  const counts = snapshot.runCounts
  const queued = counts.queued ?? 0
  const active = (counts.running ?? 0) + (counts.leased ?? 0)
  const succeeded = counts.succeeded ?? 0
  const failed = counts.failed ?? 0
  const cancelled = counts.cancelled ?? 0
  return {
    total: snapshot.runs.length || queued + active + succeeded + failed + cancelled,
    queued,
    active,
    succeeded,
    failed,
    cancelled,
  }
}

function optimizerStatusLabel(status: string): string {
  const normalized = status.toLowerCase()
  const label =
    normalized === "queued"
      ? "queued"
      : normalized === "running" || normalized === "leased"
        ? "running"
        : normalized === "succeeded" || normalized === "completed"
          ? "done"
          : normalized === "failed"
            ? "failed"
            : normalized === "cancelled"
              ? "cancel"
              : normalized || "unknown"
  return label.padEnd(8).slice(0, 8)
}

function optimizerStartedTimeLabel(run: OptimizerRunSummary): string {
  const raw = run.startedAt ?? run.submittedAt ?? run.finishedAt
  if (!raw) return "--:--".padEnd(7)
  const time = formatShortTime(raw)
  return time.padEnd(7)
}

function formatOptimizerTimestamp(value: string | undefined): string {
  if (!value) return "-"
  const parsed = parseTimestamp(value)
  if (!parsed) return value
  return parsed.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatShortTime(value: string): string {
  const parsed = parseTimestamp(value)
  if (!parsed) return value.slice(11, 16) || value.slice(0, 5)
  const time = parsed.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })
  return time
}

function parseTimestamp(value: string): Date | undefined {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"))
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function optimizerJobLabel(run: OptimizerRunSummary): string {
  const name = run.runId || run.requestId || "(unknown)"
  return oneLine(name, 28)
}

function formatOptional(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US")
}

function selectedHistoryText(options: StackAppOptions, state: AppState): string {
  const summary = state.history[state.selectedHistoryIndex]
  if (!summary) return "no session selected"
  const usage = threadUsageSummary(options, summary)
  return [
    `${summary.id}`,
    `${summary.turnCount} turns   updated ${summary.updatedAt}`,
    `usage: ${formatSessionUsageSummary(usage)}`,
    `file: ${relative(options.workspace.root, summary.path)}`,
    "",
    `last prompt: ${summary.lastPrompt ?? "(empty)"}`,
    "",
    "Enter resume into this session. f fork turns into the current session.",
  ].join("\n")
}

async function handleHistoryKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
): Promise<void> {
  if (state.history.length === 0) return
  if (key.name === "j" || key.name === "down") {
    moveSelectedHistory(state, 1)
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    moveSelectedHistory(state, -1)
    refresh()
    return
  }
  if (key.name === "pagedown") {
    moveSelectedHistory(state, SESSION_HISTORY_VISIBLE_ROWS)
    refresh()
    return
  }
  if (key.name === "pageup") {
    moveSelectedHistory(state, -SESSION_HISTORY_VISIBLE_ROWS)
    refresh()
    return
  }
  if (key.name === "home") {
    state.selectedHistoryIndex = 0
    refresh()
    return
  }
  if (key.name === "end") {
    state.selectedHistoryIndex = state.history.length - 1
    refresh()
    return
  }
  if (key.name === "f") {
    await loadSelectedSession(options, state, refresh, refreshHistory, "fork")
    return
  }
  if (key.name === "return" || key.name === "enter") {
    await loadSelectedSession(options, state, refresh, refreshHistory, "resume")
  }
}

async function handleRemoteKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshRemoteResearch: () => Promise<void>,
): Promise<void> {
  if (key.name === "j" || key.name === "down") {
    state.selectedRemoteJobIndex = clampIndex(state.selectedRemoteJobIndex + 1, state.remoteResearchSnapshot.jobs.length)
    state.selectedRemoteOutputIndex = clampIndex(state.selectedRemoteOutputIndex, currentRemoteOutputCount(state))
    state.pendingRemoteAction = undefined
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    state.selectedRemoteJobIndex = clampIndex(state.selectedRemoteJobIndex - 1, state.remoteResearchSnapshot.jobs.length)
    state.selectedRemoteOutputIndex = clampIndex(state.selectedRemoteOutputIndex, currentRemoteOutputCount(state))
    state.pendingRemoteAction = undefined
    refresh()
    return
  }
  if (key.name === "f" || key.name === "right") {
    state.selectedRemoteFactoryIndex = clampIndex(
      state.selectedRemoteFactoryIndex + 1,
      state.remoteResearchSnapshot.factories.length,
    )
    state.pendingRemoteAction = undefined
    refresh()
    return
  }
  if (key.name === "left") {
    state.selectedRemoteFactoryIndex = clampIndex(
      state.selectedRemoteFactoryIndex - 1,
      state.remoteResearchSnapshot.factories.length,
    )
    state.pendingRemoteAction = undefined
    refresh()
    return
  }
  if (key.name === "p") {
    setPendingRemoteAction(state, "pause-run")
    refresh()
    return
  }
  if (key.name === "u") {
    setPendingRemoteAction(state, "resume-run")
    refresh()
    return
  }
  if (key.name === "s") {
    setPendingRemoteAction(state, "stop-run")
    refresh()
    return
  }
  if (key.name === "w") {
    setPendingRemoteAction(state, "preview-factory-wake")
    refresh()
    return
  }
  if (key.name === "e") {
    setPendingRemoteAction(state, "start-readme-smoke")
    refresh()
    return
  }
  if (key.name === "t") {
    cycleMediationTarget(state)
    state.pendingRemoteAction = undefined
    refresh()
    return
  }
  if (key.name === "m") {
    if (state.mediationTargetKind === "hosted-optimizer") {
      state.remoteActionMessage = "hosted optimizer messaging is not available; use hosted controls"
      state.pendingRemoteAction = undefined
      refresh()
      return
    }
    setPendingRemoteAction(state, messageActionForMediationTarget(state))
    refresh()
    return
  }
  if (key.name === "o") {
    state.selectedRemoteOutputIndex = clampIndex(state.selectedRemoteOutputIndex + 1, currentRemoteOutputCount(state))
    state.pendingRemoteAction = undefined
    refresh()
    return
  }
  if (key.name === "d") {
    setPendingRemoteAction(state, "download-output")
    refresh()
    return
  }
  if (key.name === "v") {
    setPendingRemoteAction(state, "preview-output")
    refresh()
    return
  }
  if (key.name === "l") {
    setPendingRemoteAction(state, "preview-download")
    refresh()
    return
  }
  if (key.name === "a") {
    setPendingRemoteAction(state, "upload-run-file")
    refresh()
    return
  }
  if (key.name === "enter" || key.name === "return") {
    await executePendingRemoteAction(options, state, refresh, refreshRemoteResearch)
    return
  }
  if (key.name === "r") {
    state.pendingRemoteAction = undefined
    state.remoteActionMessage = "refreshing remote SMR"
    refresh()
    await refreshRemoteResearch()
    state.remoteActionMessage = "remote SMR refreshed"
    refresh()
  }
}

async function handleHostedOptimizerKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHostedOptimizers: () => Promise<void>,
): Promise<void> {
  if (key.name === "j" || key.name === "down") {
    state.selectedHostedOptimizerRunIndex = clampIndex(
      state.selectedHostedOptimizerRunIndex + 1,
      state.hostedOptimizerSnapshot.runs.length,
    )
    state.selectedHostedOptimizerArtifactIndex = 0
    state.pendingHostedOptimizerAction = undefined
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    state.selectedHostedOptimizerRunIndex = clampIndex(
      state.selectedHostedOptimizerRunIndex - 1,
      state.hostedOptimizerSnapshot.runs.length,
    )
    state.selectedHostedOptimizerArtifactIndex = 0
    state.pendingHostedOptimizerAction = undefined
    refresh()
    return
  }
  if (key.name === "o" || key.name === "right" || key.name === "space") {
    state.selectedHostedOptimizerArtifactIndex = clampIndex(
      state.selectedHostedOptimizerArtifactIndex + 1,
      currentHostedOptimizerArtifactCount(state),
    )
    state.pendingHostedOptimizerAction = undefined
    refresh()
    return
  }
  if (key.name === "c") {
    setPendingHostedOptimizerAction(state, "cancel-run")
    refresh()
    return
  }
  if (key.name === "v") {
    setPendingHostedOptimizerAction(state, "preview-artifact")
    refresh()
    return
  }
  if (key.name === "d") {
    setPendingHostedOptimizerAction(state, "download-artifact")
    refresh()
    return
  }
  if (key.name === "enter" || key.name === "return") {
    await executePendingHostedOptimizerAction(options, state, refresh, refreshHostedOptimizers)
    return
  }
  if (key.name === "r") {
    state.pendingHostedOptimizerAction = undefined
    state.hostedOptimizerSnapshot = {
      ...state.hostedOptimizerSnapshot,
      message: "refreshing hosted optimizers",
      checkedAt: new Date().toISOString(),
    }
    refresh()
    await refreshHostedOptimizers()
    refresh()
  }
}

function setPendingHostedOptimizerAction(state: AppState, action: HostedOptimizerActionKind): void {
  state.pendingHostedOptimizerAction = action
  state.hostedOptimizerActionMessage = `Enter confirms ${hostedOptimizerActionLabel(action)}`
}

async function executePendingHostedOptimizerAction(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHostedOptimizers: () => Promise<void>,
): Promise<void> {
  const action = state.pendingHostedOptimizerAction
  if (!action) return
  const run = state.hostedOptimizerSnapshot.runs[state.selectedHostedOptimizerRunIndex]
  const artifactName = selectedHostedOptimizerArtifactName(state)

  state.hostedOptimizerActionMessage = `running ${hostedOptimizerActionLabel(action)}`
  refresh()

  const result = await executeHostedOptimizerActionResult(options, action, run, artifactName)

  state.pendingHostedOptimizerAction = undefined
  state.hostedOptimizerActionMessage = `${result.ok ? "ok" : "failed"} ${result.status || "-"} ${result.message}`
  if (result.ok && action === "preview-artifact") {
    state.recentHostedOptimizerArtifactPreview = hostedOptimizerArtifactPreviewFromResult(result)
  }
  if (result.ok && action === "download-artifact") {
    state.recentHostedOptimizerArtifactDownload = hostedOptimizerArtifactDownloadFromResult(result)
  }
  await refreshHostedOptimizers()
  refresh()
}

async function executeHostedOptimizerActionResult(
  options: StackAppOptions,
  action: HostedOptimizerActionKind,
  run: HostedOptimizerRunSummary | undefined,
  artifactName: string | undefined,
): Promise<{ ok: boolean; status: number; message: string; data?: Record<string, unknown> }> {
  if (!run) return { ok: false, status: 0, message: "no hosted optimizer job selected" }
  switch (action) {
    case "cancel-run":
      return await cancelHostedOptimizerRun(options.config, run)
    case "preview-artifact":
      return artifactName
        ? await previewHostedOptimizerArtifact(options.config, run, artifactName)
        : { ok: false, status: 0, message: "no hosted optimizer artifact selected" }
    case "download-artifact":
      return artifactName
        ? await downloadHostedOptimizerArtifact(options.config, run, artifactName)
        : { ok: false, status: 0, message: "no hosted optimizer artifact selected" }
  }
}

function hostedOptimizerActionLabel(action: HostedOptimizerActionKind): string {
  switch (action) {
    case "cancel-run":
      return "cancel selected hosted optimizer"
    case "preview-artifact":
      return "preview selected hosted artifact"
    case "download-artifact":
      return "download selected hosted artifact"
  }
}

function setPendingRemoteAction(state: AppState, action: LiveActionKind): void {
  state.pendingRemoteAction = action
  state.remoteActionMessage = `Enter confirms ${remoteActionLabel(action)}`
}

async function executePendingRemoteAction(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshRemoteResearch: () => Promise<void>,
): Promise<void> {
  const action = state.pendingRemoteAction
  if (!action) return
  const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  const factory = state.remoteResearchSnapshot.factories[state.selectedRemoteFactoryIndex]
  const output = selectedRemoteOutput(state)
  const download = run ? latestRemoteDownloadForRun(state, run.runId) : state.recentRemoteDownloads[0]
  const draft = state.inputBuffer.trim()

  state.remoteActionMessage = `running ${remoteActionLabel(action)}`
  refresh()

  const result =
    action === "start-readme-smoke"
      ? startReadmeSmokeFromTui(options, state, refresh, refreshRemoteResearch)
      : await executeRemoteActionResult(options, action, { run, factory, output, download, draft })

  state.pendingRemoteAction = undefined
  state.remoteActionMessage = `${result.ok ? "ok" : "failed"} ${result.status || "-"} ${result.message}`
  if (result.ok && action === "download-output" && output) {
    state.recentRemoteDownloads = mergeRemoteDownloadRecords([
      remoteDownloadRecordFromResult(options.config.environmentName, output, result),
      ...(await readRemoteDownloadHistory(options.config)),
      ...state.recentRemoteDownloads,
    ])
  }
  if (result.ok && action === "preview-output") {
    state.recentRemoteOutputPreview = remoteOutputPreviewFromResult(result)
  }
  if (result.ok && action === "preview-download") {
    state.recentRemoteDownloadPreview = remoteDownloadPreviewFromResult(result)
  }
  if (result.ok && (action === "message-run" || action === "message-factory" || action === "upload-run-file")) {
    state.inputBuffer = ""
  }
  await refreshRemoteResearch()
  refresh()
}

function remoteDownloadRecordFromResult(
  environmentName: string,
  output: RemoteOutputSelection,
  result: RemoteActionResult,
): RemoteDownloadRecord | undefined {
  const data = asRecord(result.data)
  const path = readString(data?.outputPath)
  const filename = readString(data?.filename)
  const bytes = readNumber(data?.bytes)
  const downloadedAt = readString(data?.downloadedAt)
  if (!path || !filename || bytes === undefined || !downloadedAt) return undefined
  return {
    environmentName,
    runId: output.run.runId,
    kind: output.kind,
    outputId: output.kind === "work-product" ? output.item.workProductId : output.item.artifactId,
    label: readString(data?.label) ?? remoteOutputLabel(output),
    path,
    filename,
    bytes,
    downloadedAt,
  }
}

function remoteOutputPreviewFromResult(result: RemoteActionResult): RemoteOutputPreview | undefined {
  const data = asRecord(result.data)
  const environmentName = readString(data?.environmentName)
  const runId = readString(data?.runId)
  const kind = readRemoteOutputKind(data?.kind)
  const outputId = readString(data?.outputId)
  const label = readString(data?.label)
  const contentType = readString(data?.contentType)
  const bytes = readNumber(data?.bytes)
  const previewBytes = readNumber(data?.previewBytes)
  const truncated = readBoolean(data?.truncated)
  const preview = readString(data?.preview)
  const previewedAt = readString(data?.previewedAt)
  if (
    !environmentName ||
    !runId ||
    !kind ||
    !outputId ||
    !label ||
    bytes === undefined ||
    previewBytes === undefined ||
    truncated === undefined ||
    preview === undefined ||
    !previewedAt
  ) {
    return undefined
  }
  return {
    environmentName,
    runId,
    kind,
    outputId,
    label,
    ...(contentType ? { contentType } : {}),
    bytes,
    previewBytes,
    truncated,
    preview,
    previewedAt,
  }
}

function remoteDownloadPreviewFromResult(result: RemoteActionResult): RemoteSavedDownloadPreview | undefined {
  const preview = remoteOutputPreviewFromResult(result)
  const data = asRecord(result.data)
  const path = readString(data?.path)
  const filename = readString(data?.filename)
  const downloadedAt = readString(data?.downloadedAt)
  if (!preview || !path || !filename || !downloadedAt) return undefined
  return {
    ...preview,
    path,
    filename,
    downloadedAt,
  }
}

function hostedOptimizerArtifactPreviewFromResult(result: { data?: Record<string, unknown> }): HostedOptimizerArtifactPreview | undefined {
  const data = asRecord(result.data)
  const environmentName = readString(data?.environmentName)
  const runId = readString(data?.runId)
  const artifactName = readString(data?.artifactName)
  const contentType = readString(data?.contentType)
  const bytes = readNumber(data?.bytes)
  const previewBytes = readNumber(data?.previewBytes)
  const truncated = readBoolean(data?.truncated)
  const preview = readString(data?.preview)
  const previewedAt = readString(data?.previewedAt)
  if (
    !environmentName ||
    !runId ||
    !artifactName ||
    bytes === undefined ||
    previewBytes === undefined ||
    truncated === undefined ||
    preview === undefined ||
    !previewedAt
  ) {
    return undefined
  }
  return {
    environmentName,
    runId,
    artifactName,
    ...(contentType ? { contentType } : {}),
    bytes,
    previewBytes,
    truncated,
    preview,
    previewedAt,
  }
}

function hostedOptimizerArtifactDownloadFromResult(result: { data?: Record<string, unknown> }): HostedOptimizerArtifactDownload | undefined {
  const data = asRecord(result.data)
  const environmentName = readString(data?.environmentName)
  const runId = readString(data?.runId)
  const artifactName = readString(data?.artifactName)
  const contentType = readString(data?.contentType)
  const outputPath = readString(data?.outputPath)
  const filename = readString(data?.filename)
  const bytes = readNumber(data?.bytes)
  const downloadedAt = readString(data?.downloadedAt)
  if (!environmentName || !runId || !artifactName || !outputPath || !filename || bytes === undefined || !downloadedAt) {
    return undefined
  }
  return {
    environmentName,
    runId,
    artifactName,
    ...(contentType ? { contentType } : {}),
    outputPath,
    filename,
    bytes,
    downloadedAt,
  }
}

function mergeRemoteDownloadRecords(records: Array<RemoteDownloadRecord | undefined>): RemoteDownloadRecord[] {
  const merged: RemoteDownloadRecord[] = []
  for (const record of records) {
    if (!record) continue
    if (merged.some((item) => item.runId === record.runId && item.outputId === record.outputId && item.path === record.path)) continue
    merged.push(record)
    if (merged.length >= 5) break
  }
  return merged
}

async function executeRemoteActionResult(
  options: StackAppOptions,
  action: RemoteActionKind,
  context: {
    run?: RemoteSmrRunSummary
    factory?: RemoteFactorySummary
    output?: RemoteOutputSelection
    download?: RemoteDownloadRecord
    draft: string
  },
): Promise<RemoteActionResult> {
  switch (action) {
    case "message-run":
      if (!context.run) return { ok: false, status: 0, message: "no run selected" }
      if (!context.draft) return { ok: false, status: 0, message: "agent input draft is empty" }
      return await sendRemoteRunMessage(options.config, context.run, context.draft)
    case "message-factory":
      if (!context.factory) return { ok: false, status: 0, message: "no factory selected" }
      if (!context.draft) return { ok: false, status: 0, message: "agent input draft is empty" }
      return await sendRemoteFactoryMessage(options.config, context.factory, context.draft)
    case "download-output":
      return context.output
        ? await downloadRemoteOutput(options.config, context.output)
        : { ok: false, status: 0, message: "no WorkProduct or artifact selected" }
    case "preview-output":
      return context.output
        ? await previewRemoteOutput(options.config, context.output)
        : { ok: false, status: 0, message: "no WorkProduct or artifact selected" }
    case "preview-download":
      return context.download
        ? await previewSavedRemoteDownload(options.config, context.download)
        : { ok: false, status: 0, message: "no saved download selected" }
    case "upload-run-file":
      return context.run
        ? await uploadSelectedRunFile(options.config, context.run, context.draft)
        : { ok: false, status: 0, message: "no run selected" }
    case "preview-factory-wake":
      return context.factory
        ? await previewRemoteFactoryWakeDue(options.config, context.factory)
        : { ok: false, status: 0, message: "no factory selected" }
    case "pause-run":
    case "resume-run":
    case "stop-run":
      return context.run
        ? await executeRemoteRunAction(options.config, context.run, action)
        : { ok: false, status: 0, message: "no run selected" }
  }
}

async function uploadSelectedRunFile(
  config: StackConfig,
  run: RemoteSmrRunSummary,
  draft: string,
): Promise<RemoteActionResult> {
  const request = parseRunFileUploadDraft(config, draft)
  if (!request) {
    return {
      ok: false,
      status: 0,
      message: "draft must be local path or local path -> remote path",
    }
  }
  return await uploadRemoteRunFile(config, {
    run,
    localPath: request.localPath,
    remotePath: request.remotePath,
    visibility: "model",
    metadata: {
      source: "stack_tui",
    },
  })
}

function parseRunFileUploadDraft(
  config: StackConfig,
  draft: string,
): { localPath: string; remotePath?: string } | undefined {
  const trimmed = draft.trim()
  if (!trimmed) return undefined
  const [localPart, remotePart] = trimmed.split(/\s+->\s+/, 2)
  const localPath = localPart?.trim()
  if (!localPath) return undefined
  const remotePath = remotePart?.trim()
  return {
    localPath: resolve(config.workingDir, localPath),
    ...(remotePath ? { remotePath } : {}),
  }
}

function startReadmeSmokeFromTui(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshRemoteResearch: () => Promise<void>,
): RemoteActionResult {
  state.evalLaunch = startReadmeSmokeEval(options.config, state.evalLaunch, (snapshot) => {
    state.evalLaunch = snapshot
    const runNeedsRefresh = Boolean(
      snapshot.runId && !state.remoteResearchSnapshot.jobs.some((run) => run.runId === snapshot.runId),
    )
    selectEvalRunIfKnown(state)
    if (runNeedsRefresh || !isEvalLaunchActive(snapshot)) {
      void refreshRemoteResearch()
        .then(() => selectEvalRunIfKnown(state))
        .finally(refresh)
      return
    }
    refresh()
  })
  return {
    ok: state.evalLaunch.status !== "failed",
    status: 0,
    message: state.evalLaunch.message ?? "readme smoke launch requested",
  }
}

function remoteActionLabel(action: LiveActionKind): string {
  switch (action) {
    case "start-readme-smoke":
      return "start README smoke SMR eval"
    case "pause-run":
      return "pause selected run"
    case "resume-run":
      return "resume selected run"
    case "stop-run":
      return "stop selected run"
    case "preview-factory-wake":
      return "preview factory wake-due"
    case "download-output":
      return "download selected output"
    case "preview-output":
      return "preview selected output"
    case "preview-download":
      return "preview saved download"
    case "upload-run-file":
      return "attach draft file to selected run"
    case "message-run":
      return "message selected live run"
    case "message-factory":
      return "message selected factory project"
  }
}

function moveSelectedHistory(state: AppState, delta: number): void {
  state.selectedHistoryIndex = Math.max(0, Math.min(state.history.length - 1, state.selectedHistoryIndex + delta))
}

async function handleOptimizerKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshOptimizers: () => Promise<void>,
): Promise<void> {
  if (key.name === "j" || key.name === "down") {
    state.selectedOptimizerRunIndex = Math.min(
      state.optimizerSnapshot.runs.length - 1,
      state.selectedOptimizerRunIndex + 1,
    )
    state.selectedOptimizerRunIndex = clampIndex(state.selectedOptimizerRunIndex, state.optimizerSnapshot.runs.length)
    refresh()
    return
  }

  if (key.name === "k" || key.name === "up") {
    state.selectedOptimizerRunIndex = Math.max(0, state.selectedOptimizerRunIndex - 1)
    refresh()
    return
  }

  if (key.name === "r") {
    await refreshOptimizers()
    refresh()
    return
  }

  if (key.name === "return" || key.name === "enter") {
    state.optimizerSnapshot = {
      ...state.optimizerSnapshot,
      status: "starting",
      message: `starting ${options.config.optimizerCommand} gepa service on ${options.config.optimizerBind}`,
      checkedAt: new Date().toISOString(),
    }
    refresh()
    state.optimizerSnapshot = await startOptimizerService(options.config)
    state.selectedOptimizerRunIndex = clampIndex(state.selectedOptimizerRunIndex, state.optimizerSnapshot.runs.length)
    refresh()
  }
}

function handleModelKey(key: { name?: string }, config: StackConfig): void {
  if (isCycleKey(key)) cycleModel(config, key.name === "k" || key.name === "left" ? -1 : 1)
}

function handleEffortKey(key: { name?: string }, config: StackConfig): void {
  if (isCycleKey(key)) cycleEffort(config, key.name === "k" || key.name === "left" ? -1 : 1)
}

async function handleEnvironmentKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refreshRemoteAccount: () => Promise<void>,
  refreshRemoteUsage: () => Promise<void>,
  refreshRemoteResearch: () => Promise<void>,
  refreshRemoteProjects: () => Promise<void>,
  refreshHostedOptimizers: () => Promise<void>,
  refresh: () => void,
): Promise<void> {
  if (key.name === "r") {
    markEnvironmentChecking(options.config, state)
    refresh()
    await Promise.all([
      refreshRemoteAccount(),
      refreshRemoteUsage(),
      refreshRemoteResearch(),
      refreshRemoteProjects(),
      refreshHostedOptimizers(),
    ])
    state.recentRemoteDownloads = await readRemoteDownloadHistory(options.config)
    refresh()
    return
  }
  if (!isCycleKey(key)) return
  const current = options.config.environmentName
  const index = STACK_ENVIRONMENT_OPTIONS.indexOf(current)
  const next =
    STACK_ENVIRONMENT_OPTIONS[(index + (key.name === "k" || key.name === "left" ? -1 : 1) + STACK_ENVIRONMENT_OPTIONS.length) % STACK_ENVIRONMENT_OPTIONS.length] ??
    current
  await applyStackEnvironment(options, state, next, refresh, async () => {
    await Promise.all([
      refreshRemoteAccount(),
      refreshRemoteUsage(),
      refreshRemoteResearch(),
      refreshRemoteProjects(),
      refreshHostedOptimizers(),
    ])
    state.recentRemoteDownloads = await readRemoteDownloadHistory(options.config)
  })
  refresh()
}

function markEnvironmentChecking(config: StackConfig, state: AppState): void {
  const auth = environmentAuthStatus(config.environment)
  const hasAuth = auth.hasAuth
  state.remoteAccountSnapshot = {
    environmentName: config.environmentName,
    environmentLabel: config.environment.label,
    apiBaseUrl: config.environment.apiBaseUrl,
    authEnv: config.environment.authEnv,
    hasAuth,
    auth,
    status: hasAuth ? "unknown" : "missing-auth",
    checkedAt: new Date().toISOString(),
    message: hasAuth ? "checking account" : auth.message,
  }
  state.remoteUsageSnapshot = emptyRemoteUsageSnapshot(
    config,
    hasAuth ? "offline" : "missing-auth",
    hasAuth ? "checking usage" : auth.message,
  )
  state.remoteResearchSnapshot = {
    status: hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: hasAuth ? "checking remote SMR" : auth.message,
    jobs: [],
    factories: [],
    runDetails: {},
  }
  state.remoteProjectsSnapshot = {
    status: hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: hasAuth ? "checking projects" : auth.message,
    projects: [],
  }
  state.opsScrollOffset = 0
  state.containersSnapshot = {
    status: hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: hasAuth ? "checking containers" : auth.message,
    containers: [],
  }
  state.hostedOptimizerSnapshot = {
    status: hasAuth ? "offline" : "missing-auth",
    environmentName: config.environmentName,
    apiBaseUrl: config.environment.apiBaseUrl,
    checkedAt: new Date().toISOString(),
    message: hasAuth ? "checking hosted optimizers" : auth.message,
    runs: [],
    runDetails: {},
  }
  state.selectedRemoteJobIndex = 0
  state.selectedRemoteFactoryIndex = 0
  state.selectedRemoteOutputIndex = 0
  state.selectedHostedOptimizerRunIndex = 0
  state.selectedHostedOptimizerArtifactIndex = 0
  state.pendingRemoteAction = undefined
  state.remoteActionMessage = undefined
  state.recentRemoteDownloads = []
  state.recentRemoteOutputPreview = undefined
  state.recentRemoteDownloadPreview = undefined
  state.recentHostedOptimizerArtifactPreview = undefined
  state.recentHostedOptimizerArtifactDownload = undefined
  state.pendingHostedOptimizerAction = undefined
  state.hostedOptimizerActionMessage = undefined
}

function isCycleKey(key: { name?: string }): boolean {
  return ["j", "k", "left", "right", "up", "down", "space", "return", "enter"].includes(key.name ?? "")
}

function cycleModel(config: StackConfig, direction: number): void {
  const options = CODEX_MODEL_OPTIONS
  const current = Math.max(0, options.findIndex((option) => option === config.codexModel))
  setCodexModel(config, options[(current + direction + options.length) % options.length] ?? config.codexModel)
}

function cycleEffort(config: StackConfig, direction: number): void {
  const options = CODEX_REASONING_EFFORT_OPTIONS
  const current = Math.max(0, options.findIndex((option) => option === config.codexReasoningEffort))
  setCodexReasoningEffort(
    config,
    options[(current + direction + options.length) % options.length] ?? config.codexReasoningEffort,
  )
}

async function loadSelectedSession(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  mode: "resume" | "fork",
): Promise<void> {
  const summary = state.history[state.selectedHistoryIndex]
  if (!summary) return
  try {
    const loaded = await readSessionLog(summary.path)
    const session = mode === "resume" ? loaded : forkSession(options.session, loaded)
    applySession(options, state, session, mode === "resume" ? summary.path : undefined)
    await refreshAgentContextFromSession(options, state, refresh)
    if (mode === "fork") {
      state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir, {
        codexModel: options.config.codexModel,
        pricingRows: options.config.codexPricing,
      })
      await refreshHistory()
    }
  } catch (error) {
    appendStackBlock(state.blocks, `failed to load session ${basename(summary.path)}: ${errorMessage(error)}`)
  } finally {
    refresh()
  }
}

function forkSession(current: StackLocalSession, loaded: StackLocalSession): StackLocalSession {
  return {
    ...current,
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    turns: loaded.turns.map((turn) => ({ ...turn, selectedPaths: [...turn.selectedPaths] })),
  }
}

function applySession(
  options: StackAppOptions,
  state: AppState,
  session: StackLocalSession,
  path: string | undefined,
): void {
  options.session.id = session.id
  options.session.workspaceRoot = session.workspaceRoot
  options.session.startedAt = session.startedAt
  options.session.codexCommand = session.codexCommand
  state.harnessCommand = session.codexCommand
  options.session.codexThreadId = session.codexThreadId ?? extractCodexThreadIdFromTurns(session.turns)
  options.session.turns = session.turns

  const rendered = renderTurns(session.turns)
  state.blocks = rendered.blocks
  state.agentScrollOffset = 0
  state.toolLogs = rendered.tools
  state.subagentLogs = rendered.subagents
  state.selectedToolIndex = clampIndex(rendered.tools.length - 1, rendered.tools.length)
  state.lastUsage = session.turns.at(-1)?.usage ?? rendered.usage
  refreshSessionThroughput(state, session.turns)
  state.lastSessionLogPath = path
  state.status = "idle"
  state.liveThinkingText = undefined
  state.liveThinkingId = undefined
  state.turnStartedAt = undefined
  state.focusMode = "agent"
}

function renderTurns(turns: StackCodexTurn[]): {
  blocks: TranscriptBlock[]
  tools: ToolLog[]
  subagents: SubagentLog[]
  usage?: StackCodexUsage
} {
  const blocks: TranscriptBlock[] = []
  const tools: ToolLog[] = []
  const subagents: SubagentLog[] = []
  let usage: StackCodexUsage | undefined
  for (const turn of turns) {
    const rendered = blocksFromTurnStdout(turn.prompt, turn.stdout)
    blocks.push(...rendered.blocks)
    for (const tool of rendered.tools) upsertToolLog(tools, tool)
    for (const subagent of rendered.subagents) upsertSubagentLog(subagents, subagent)
    for (const line of turn.stdout.split("\n")) {
      if (!line.trim()) continue
      const parsed = parseCodexJsonLine(line)
      if (parsed?.usage) usage = parsed.usage as StackCodexUsage
    }
  }
  return { blocks, tools, subagents, usage }
}

async function submitPrompt(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
): Promise<void> {
  state.status = "running"
  state.spinnerFrame = 0
  state.lastUsage = undefined
  state.currentTurnStartedAt = new Date().toISOString()
  state.liveThinkingText = "starting Codex"
  state.agentScrollOffset = 0
  appendUserBlock(state.blocks, prompt)
  options.session.codexCommand = `${options.config.codexCommand} ${options.config.codexArgs.join(" ")}`
  state.harnessCommand = options.config.codexCommand
  refresh()

  const selectedFiles = options.workspace.files.filter((file) => file.selected)
  const refreshIfScrollStable = () => {
    if (!isRecentAgentScroll(state)) refresh()
  }
  const outputSink = createCodexTranscriptSink(
    state,
    options.config.workspaceRoot,
    (usage) => {
      state.lastUsage = usage
      refreshSessionThroughput(state, options.session.turns, liveTurnThroughput(state))
      refreshIfScrollStable()
    },
    refreshIfScrollStable,
    (threadId) => {
      options.session.codexThreadId = threadId
      void refreshAgentContextFromThread(state, threadId, options.config.workspaceRoot, refreshIfScrollStable)
    },
    (rateLimits) => {
      state.codexRateLimits = rateLimits
      refreshIfScrollStable()
    },
  )

  try {
    const turn = await runCodexTurn({
      config: options.config,
      userPrompt: prompt,
      selectedFiles,
      priorTurns: options.session.turns,
      onOutput: outputSink.write,
    })
    outputSink.flush()
    if (!outputSink.hasVisibleOutput) {
      appendStackBlock(state.blocks, "no visible response")
    }
    turn.usage = state.lastUsage ?? readUsageFromStdout(turn.stdout)
    if (turn.usage) state.lastUsage = turn.usage
    options.session.turns.push(turn)
    refreshSessionThroughput(state, options.session.turns)
    state.status = turn.exitCode === 0 ? "idle" : "error"
    state.liveThinkingText = undefined
    state.liveThinkingId = undefined
    state.turnStartedAt = undefined
    state.currentTurnStartedAt = undefined
    state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir, {
      codexModel: options.config.codexModel,
      pricingRows: options.config.codexPricing,
    })
    await refreshAgentContextFromSession(options, state, refreshIfScrollStable)
    await refreshHistory()
  } catch (error) {
    outputSink.flush()
    state.status = "error"
    state.liveThinkingText = undefined
    state.liveThinkingId = undefined
    state.turnStartedAt = undefined
    state.currentTurnStartedAt = undefined
    appendStackBlock(state.blocks, errorMessage(error))
    state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir, {
      codexModel: options.config.codexModel,
      pricingRows: options.config.codexPricing,
    })
    await refreshHistory()
  } finally {
    refresh()
  }
}

function toggleLiveOpsMode(state: AppState): void {
  state.pendingHostedOptimizerAction = undefined
  state.pendingRemoteAction = undefined
  if (state.liveOpsMode === "local") {
    state.liveOpsMode = "remote"
    if (state.focusMode === "optimizers") state.focusMode = "remote"
    return
  }

  state.liveOpsMode = "local"
  if (state.focusMode === "hosted" || state.focusMode === "remote") state.focusMode = "optimizers"
}

function nextFocusMode(current: FocusMode, mode: LiveOpsMode): FocusMode {
  const order = focusOrderForLiveOpsMode(mode)
  const index = order.indexOf(current)
  return order[(index + 1) % order.length] ?? "agent"
}

function focusOrderForLiveOpsMode(mode: LiveOpsMode): FocusMode[] {
  return mode === "local" ? LOCAL_FOCUS_ORDER : REMOTE_FOCUS_ORDER
}

function isLiveOpsFocus(focusMode: FocusMode): boolean {
  return focusMode === "optimizers" || focusMode === "hosted" || focusMode === "remote"
}

function liveOpsModeLabel(mode: LiveOpsMode): string {
  return mode === "local" ? "Local" : "Remote"
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(length - 1, index))
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readRemoteOutputKind(value: unknown): RemoteOutputPreview["kind"] | undefined {
  return value === "work-product" || value === "artifact" ? value : undefined
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  return readNumber(value)
}

function oneLine(value: string, maxLength: number): string {
  return truncateDisplay(value.replace(/\s+/g, " ").trim(), maxLength)
}

function inlineText(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim()
  if (cleaned.length <= maxLength) return cleaned
  return cleaned.slice(0, Math.max(0, maxLength - 3)) + "..."
}

function truncateDisplay(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...(truncated ${value.length - maxLength} chars)`
}

function shortPath(path: string): string {
  const rel = relative(process.cwd(), path)
  return rel || "."
}

function displayCwd(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function closeRenderer(
  renderer: CliRenderer,
  spinnerInterval?: ReturnType<typeof setInterval>,
  optimizerInterval?: ReturnType<typeof setInterval>,
  projectsInterval?: ReturnType<typeof setInterval>,
  rateLimitsInterval?: ReturnType<typeof setInterval>,
): void {
  if (spinnerInterval) clearInterval(spinnerInterval)
  if (optimizerInterval) clearInterval(optimizerInterval)
  if (projectsInterval) clearInterval(projectsInterval)
  if (rateLimitsInterval) clearInterval(rateLimitsInterval)
  renderer.stop()
  renderer.destroy()
  process.exit(0)
}
