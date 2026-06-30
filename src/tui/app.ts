import {
  Box,
  createCliRenderer,
  decodePasteBytes,
  StyledText,
  Text,
  dim,
  fg,
  type CliRenderer,
  type PasteEvent,
  type TextChunk,
} from "@opentui/core"
import { renderAgentContextStyled } from "./context-rail.js"
import {
  agentRoleLabel,
  agentRolePanelTitle,
  roleChatPanelTitle,
  type StackSessionAgentRole,
} from "../agent-roles.js"
import {
  leftPanelLineCount,
  leftPanelTitle,
  renderLeftPanelStyled,
  toggleLeftPanelMode,
  type LeftPanelMode,
} from "./left-panel.js"
import { stackTuiLayout } from "./layout.js"
import { stackTuiTheme as theme } from "./theme.js"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, relative, resolve, join } from "node:path"
import {
  CODEX_MODEL_OPTIONS,
  CURSOR_MODEL_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
  STACK_ENVIRONMENT_OPTIONS,
  STACK_HARNESS_OPTIONS,
  environmentAuthStatus,
  setCodexModel,
  setCursorModel,
  setCodexReasoningEffort,
  setCodexSubagentModel,
  setCodexSubagentReasoningEffort,
  setCodexSubagentsEnabled,
  setStackEnvironment,
  isCursorHarness,
  harnessAuthPlan,
  harnessModel,
  harnessSessionCommand,
  setStackHarness,
  stackDataRootFromSessionPath,
  sessionHistoryScanDirs,
  type StackConfig,
  type StackEnvironmentName,
  type StackHarnessKind,
} from "../config.js"
import { stackVersion } from "../version.js"
import { syncStackSubagentAgentFiles } from "../codex/subagent-config.js"
import {
  agentContextRailLineCount,
  emptyAgentContext,
  extractCodexThreadIdFromTurns,
  mergeAgentContext,
  noteUsedSkillsFromText,
  readAgentContextFromSession,
  type AgentContextSnapshot,
} from "../codex/agent-context.js"
import {
  emptyGoalContext,
  goalContextStripLines,
  mergeGoalContext,
  parseGoalFromCodexJsonLine,
  readGoalFromSession,
  type CodexGoalSnapshot,
} from "../codex/goal-context.js"
import {
  mergeMetaThreadGoalContext,
  metaThreadGoalStripLines,
  readMetaThreadManifest,
} from "../meta-thread-goal.js"
import type { StackdMetaThreadManifest } from "../client/stackd.js"
import {
  formatCodexBudgetSuffix,
  readCodexRateLimits,
  readCodexRateLimitsFromSession,
  readLatestCodexRateLimits,
  type CodexRateLimitsSnapshot,
} from "../codex/rate-limits.js"
import { isChatGptAuthPlan, readCodexAccountSnapshot } from "../codex/account.js"
import { codexAuthLedgerSummaryLines, recordCodexAuthObservation } from "../codex/auth-ledger.js"
import {
  appendGardenerChatMessage,
  dismissGardenerInboxItem,
  enqueueGardenerInbox,
  ensureGardenerThread,
  applyGardenerHarnessToConfig,
  gardenerHarnessLabel,
  gardenerSubmitIntent,
  gardenerWorkspaceDocPath,
  isExplicitGardenerPrefix,
  markGardenerInboxRouted,
  readGardenerInbox,
  recordGardenerWorkerDispatch,
  restoreSessionHarnessToConfig,
  runGardenerAfterTurn,
  snapshotWorkerHarness,
  stripGardenerMessagePrefix,
  type GardenerInboxItem,
  type WorkerHarnessSnapshot,
} from "../gardener.js"
import { loadGardenerConfig } from "../gardener-config.js"
import {
  executeGardenerSkillRegister,
  executeGardenerSkillSuggest,
  formatSkillRegisterHelp,
  formatSkillSuggestHelp,
  parseGardenerSkillRegisterIntent,
  parseGardenerSkillSuggestIntent,
} from "../gardener-skills.js"
import { runGardenerChatTurn } from "../gardener-chat.js"
import {
  buildGuidanceSnippetForRoute,
  composeRoutedWorkerMessage,
  gardenerAuthSwapHint,
  inboxItemDispatchKind,
  lastGardenRewriteAt,
  readWorkerSessionStatus,
  runGardenerMaintenancePass,
} from "../gardener-orchestrator.js"
import {
  buildSessionUsageSummary,
  formatEstimatedSpend,
  formatSessionUsageSummary,
} from "../codex/usage-cost.js"
import {
  emptyMonitorSnapshot,
  cycleMonitorMode,
  monitorRailLines,
  refreshMonitorSnapshot,
  runMonitorAfterTurn,
  runMonitorAfterOperatorMessage,
  runMonitorForNewEvents,
  setMonitorEnabled,
  isExplicitMonitorPrefix,
  stripMonitorMessagePrefix,
  type StackMonitorSnapshot,
} from "../monitor.js"
import { recordCoreAgentEventsFromCodexLine } from "../core-agent-events.js"
import { startVoiceRecording, type VoiceRecordingHandle } from "../voice/recording.js"
import { isLikelyJunkVoiceTranscript, MIN_VOICE_HOLD_MS, voiceHoldElapsedMs } from "../voice/hold.js"
import { transcribeAudio, voiceSttConfigFromStack } from "../voice/providers/resolve.js"
import { readVoiceStatus, voiceInputHintLine, type VoiceStatusSnapshot } from "../voice/status.js"
import { readActiveStackevalPacket, stackevalPacketStatusLine } from "../stackeval/packet.js"
import {
  CodexAppServerSession,
  probeCodexAppServerAvailability,
  runCodexAppServerTurn,
  runCodexTurn,
} from "../codex/app-server-session.js"
import { resolveCodexTransport } from "../codex/app-server-client.js"
import { CursorAcpSession, probeCursorAcpAvailability } from "../cursor/acp-session.js"
import {
  formatCursorBudgetSuffix,
  isCursorAuthPlan,
  readCursorAccountSnapshot,
  type CursorAccountSnapshot,
} from "../cursor/account.js"
import {
  createStackAppShutdown,
  type StackAppShutdown,
  registerFatalProcessHandlers,
  registerRendererShutdown,
} from "./terminal-cleanup.js"
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
  openUrlInSystemBrowser,
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
  readRunHostedArtifactStatus,
  type HostedArtifactStatus,
  type RemoteFactorySummary,
  type RemoteProjectsPanelSnapshot,
  type RemoteRunDetail,
  type RemoteResearchSnapshot,
  type RemoteSmrRunSummary,
} from "../remote/research.js"
import {
  ensureSessionInHistory,
  listSessionHistoryFromDirs,
  mergeSessionSummaries,
  pinGardenerThreadToTop,
  createSession,
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
  resumeCommandFromCheckpoint,
  writeResumeCheckpointSync,
  type StackResumeCheckpoint,
} from "../resume-checkpoint.js"
import {
  enrichResumeCheckpoint,
  harnessBackendSessionId,
  resumeHarnessSession,
} from "../checkpoint-state.js"
import {
  stackdRuntimeAppendEvent,
  stackdRuntimeFactory,
  stackdThreads,
  type StackdFactorySnapshot,
  type StackdRuntimeEventAppendRequest,
  type StackdThreadSummary,
} from "../client/stackd.js"
import { readThreadMetaEvents, type StackThreadMetaEvent } from "../thread-events.js"
import {
  resolveThreadDisplayLabel,
  sanitizeThreadDisplayName,
  tryApplyThreadNameFromAgentResponse,
  tryApplyThreadNameFromOperatorMessage,
} from "../thread-display-name.js"
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
import { anchorTranscriptBox } from "./transcript-slot.js"
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
  renderOpsPanelStyled,
  type OpsPanelAgentUsage,
  type OpsPanelMetaEvent,
  type RightPanelMode,
} from "./ops-panel.js"
import {
  monitorEventStreamLineCount,
} from "./monitor-thread.js"
import { activeGoalModeSnapshot, isGoalMode } from "./goal-mode.js"
import { goalShutterLineCount, renderGoalPanelTabBar, renderGoalShutter, renderGoalWorkerPeekPanel, goalShutterCardLineCount, goalShutterStreamVisibleRows, goalWorkerPeekTranscriptRows } from "./goal-shutter.js"
import { sidecarAgentActive, sidecarInputStatusLine } from "./sidecar-queue.js"
import {
  consumeBracketedPasteSequences,
  ENABLE_BRACKETED_PASTE,
  handleRawTextInputSequence,
  isRawEnterSequence,
  normalizePasteText,
  splitSubmitLines,
} from "./input-paste.js"
import {
  completeSlashMenuSelection,
  dispatchSlashCommand,
  isGoalSlashCommand,
  navigateSlashMenu,
  renderSlashCommandMenuStyled,
  resolveSlashSubmitPrompt,
  selectedSlashCommandSpec,
  slashMenuQuery,
  slashMenuVisible,
  clampSlashMenuIndex,
  type SlashCommandContext,
  type SlashDispatchHooks,
} from "./slash-commands.js"
import { runGoalSlashCommand, runGoalPanelAction, refreshGoalPanelState } from "./goal-slash-dispatch.js"
import { buildGoalWorkerKickoffPrompt, goalKickoffTranscriptLabel, harnessGoalPayloadFromManifest } from "../harness/goal-notify.js"
import { navigateGoalPanelSelection, openGoalPanel, renderGoalPanel } from "./goal-panel.js"
import {
  blocksFromGardenerChatEvents,
  blocksFromMonitorChatEvents,
  gardenerTranscriptRenderOptions,
  mergeRoleChatBlocks,
  monitorTranscriptRenderOptions,
  renderRoleChatTranscriptStyled,
} from "./role-chat-transcript.js"
import {
  gardenerEventStreamLineCount,
  type GardenerThreadContext,
} from "./gardener-thread.js"
import {
  activeThreadsFocusHint,
  coreEventStreamLineCount,
  renderActiveProjectsStyled,
  renderActiveThreadRowsStyled,
  renderCoreEventStreamStyled,
  resolveActiveThreadIds,
  resolveCoreEventStreamContext,
  type ThreadGoalStatus,
} from "./center-panel.js"

type FocusMode =
  | "agent"
  | "goal"
  | "model"
  | "effort"
  | "subagent-model"
  | "subagent-effort"
  | "subagents"
  | "monitor"
  | "gardener"
  | "harness"
  | "environment"
  | "account"
  | "ops"
  | "optimizers"
  | "hosted"
  | "remote"
  | "projects"
  | "history"
type HarnessSession = CodexAppServerSession | CursorAcpSession
type LiveOpsMode = "local" | "remote"
type MonitorPanelMode = "chat" | "events"
type GardenerPanelMode = "chat" | "events"
type HostedOptimizerActionKind = "cancel-run" | "preview-artifact" | "download-artifact"
type MediationTargetKind = "remote-run" | "factory" | "hosted-optimizer"
type LiveActionKind = RemoteActionKind | "start-readme-smoke"

export type StackAppOptions = {
  config: StackConfig
  workspace: WorkspaceInfo
  session: StackLocalSession
  resumeCheckpoint?: StackResumeCheckpoint
  resumeManifest?: StackdMetaThreadManifest
}

type AppState = {
  focusMode: FocusMode
  liveOpsMode: LiveOpsMode
  /** Agent Bridge + session detail panels (right). Threads rail stays visible. */
  railsVisible: boolean
  leftPanelOpen: boolean
  leftPanelRailsVisible: boolean
  rightPanelOpen: boolean
  showDetails: boolean
  expandedBlockIds: Set<string>
  selectedToolIndex: number
  selectedHistoryIndex: number
  selectedProjectIndex: number
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
  monitorInputBuffer: string
  sidecarQueuedMessages: string[]
  sidecarChatInFlight: boolean
  sidecarDispatchRef: { current: Promise<void> }
  gardenerInputBuffer: string
  slashMenuIndex: number
  goalPanelSelectedIndex: number
  goalShutterWorkerPeek: boolean
  goalShutterScrollOffset: number
  goalShutterScrollPinned: boolean
  goalMonitorAutoEnabledObjective?: string
  pasteAccumulator?: string
  toolLogs: ToolLog[]
  subagentLogs: SubagentLog[]
  history: StackSessionSummary[]
  threadGoalStatus: Map<string, ThreadGoalStatus>
  lastSessionLogPath?: string
  optimizerSnapshot: OptimizerSnapshot
  selectedOptimizerRunIndex: number
  remoteAccountSnapshot: RemoteAccountSnapshot
  remoteUsageSnapshot: RemoteUsageSnapshot
  remoteResearchSnapshot: RemoteResearchSnapshot
  remoteProjectsSnapshot: RemoteProjectsPanelSnapshot
  runtimeFactorySnapshot?: StackdFactorySnapshot | null
  runtimeFactoryEventsAppended?: number | null
  containersSnapshot: ContainersPanelSnapshot
  rightPanelMode: RightPanelMode
  rightPanelOpsVisible: boolean
  monitorPanelMode: MonitorPanelMode
  gardenerPanelMode: GardenerPanelMode
  leftPanelMode: LeftPanelMode
  leftPanelScrollOffset: number
  gardenerScrollOffset: number
  gardenerScrollPinned: boolean
  gardenerEventScrollOffset: number
  gardenerEventScrollPinned: boolean
  optimizerCliAvailable: boolean
  localBootstrapSnapshot: LocalBootstrapSnapshot
  opsScrollOffset: number
  monitorScrollOffset: number
  monitorScrollPinned: boolean
  monitorEventScrollOffset: number
  monitorEventScrollPinned: boolean
  monitorWatchScrollOffset: number
  monitorWatchScrollPinned: boolean
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
  codexAccountEmail?: string
  cursorAccount?: CursorAccountSnapshot
  goalContext: CodexGoalSnapshot
  metaThreadManifest?: StackdMetaThreadManifest
  agentViewEnabled: boolean
  planningColumns: number
  codexTransport: "app-server" | "exec" | "acp"
  queuedMessages: string[]
  talkToGardener: boolean
  talkToMonitor: boolean
  gardenerThreadId: string
  gardenerWorkerTargetId?: string
  monitorWorkerTargetId?: string
  gardenerInboxSelectedIndex: number
  gardenerGardenPath?: string
  gardenerWorkspacePath?: string
  gardenerWorkerQueue: string[]
  voiceStatus: VoiceStatusSnapshot
  voiceRecording?: VoiceRecordingHandle
  voiceRecordingStartedAt?: string
  voiceTranscribing: boolean
  voiceFinishInFlight: boolean
  gardenerNotice?: string
  gardenerChatRunning: boolean
  gardenerLiveBlocks: TranscriptBlock[]
  gardenerLiveTools: ToolLog[]
  gardenerLiveSubagents: SubagentLog[]
  gardenerLiveThinking?: string
  workerHarnessSnapshot?: WorkerHarnessSnapshot
  lastSteerHint?: string
  monitorSnapshot: StackMonitorSnapshot
  metaEvents: StackThreadMetaEvent[]
}

type MountedView = {
  root: ReturnType<typeof Box>
}

type StackKeyEvent = {
  name?: string
  ctrl?: boolean
  shift?: boolean
  eventType?: "press" | "repeat" | "release"
  sequence?: string
  raw?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}

type PanelMouseEvent = {
  preventDefault?: () => void
  stopPropagation?: () => void
}

type PanelFocusHandlers = {
  onMouseDown(event: PanelMouseEvent): void
}

function panelFocusHandlers(state: AppState, focusMode: FocusMode, refresh: () => void): PanelFocusHandlers {
  return {
    onMouseDown(event) {
      event.preventDefault?.()
      event.stopPropagation?.()
      applySidePanelFocus(state, focusMode)
      refresh()
    },
  }
}

function monitorInputFocusHandlers(state: AppState, refresh: () => void): PanelFocusHandlers {
  return {
    onMouseDown(event) {
      event.preventDefault?.()
      event.stopPropagation?.()
      applySidePanelFocus(state, "monitor")
      refresh()
    },
  }
}

function gardenerInputFocusHandlers(state: AppState, refresh: () => void): PanelFocusHandlers {
  return {
    onMouseDown(event) {
      event.preventDefault?.()
      event.stopPropagation?.()
      applySidePanelFocus(state, "gardener")
      refresh()
    },
  }
}

function agentPanelFocusHandlers(state: AppState, refresh: () => void): PanelFocusHandlers {
  return {
    onMouseDown(event) {
      event.preventDefault?.()
      event.stopPropagation?.()
      applySidePanelFocus(state, "agent")
      refresh()
    },
  }
}

function applySidePanelFocus(state: AppState, focusMode: FocusMode): void {
  state.focusMode = focusMode
  if (focusMode === "history" || focusMode === "harness" || focusMode === "projects") {
    state.leftPanelOpen = true
    return
  }
  if (focusMode === "gardener") {
    state.leftPanelOpen = true
    return
  }
  if (focusMode === "ops" || focusMode === "optimizers" || focusMode === "hosted" || focusMode === "remote") {
    state.rightPanelOpen = true
    return
  }
  if (focusMode === "monitor") {
    state.rightPanelOpen = true
    return
  }
  if (focusMode === "agent") {
    state.leftPanelOpen = true
  }
}

function syncGardenerLeftPanel(state: AppState): void {
  state.leftPanelOpen = true
}

function toggleLeftPanelRails(state: AppState): void {
  state.focusMode = state.focusMode === "history" ? "agent" : "history"
  state.leftPanelScrollOffset = 0
}

function syncMonitorRightPanel(state: AppState): void {
  if (!isMonitorOn(state.monitorSnapshot)) {
    state.rightPanelOpsVisible = true
  }
}

function toggleRightPanelOps(state: AppState): void {
  if (isMonitorOn(state.monitorSnapshot)) {
    state.rightPanelOpsVisible = !state.rightPanelOpsVisible
    state.rightPanelOpen = true
    state.focusMode = state.rightPanelOpsVisible ? "ops" : "monitor"
    state.opsScrollOffset = 0
    return
  }
  toggleRightPanelMode(state)
}

function collapsedSideTab(
  label: string,
  side: "left" | "right",
  onActivate: () => void,
): ReturnType<typeof Box> {
  return Box(
    {
      width: 3,
      flexShrink: 0,
      border: true,
      borderStyle: "single",
      borderColor: theme.borderInactive,
      backgroundColor: theme.bgPanel,
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      title: label,
      onMouseDown(event: PanelMouseEvent) {
        event.preventDefault?.()
        event.stopPropagation?.()
        onActivate()
      },
    },
    Text({
      content: side === "left" ? "▶" : "◀",
      fg: theme.fgMuted,
    }),
  )
}

function defaultLiveOpsFocus(state: AppState): FocusMode {
  return state.liveOpsMode === "local" ? "optimizers" : "remote"
}

const COMMON_FOCUS_ORDER: FocusMode[] = [
  "agent",
  "model",
  "effort",
  "subagent-model",
  "subagent-effort",
  "subagents",
  "monitor",
  "environment",
  "account",
  "ops",
]
const LOCAL_FOCUS_ORDER: FocusMode[] = [...COMMON_FOCUS_ORDER, "gardener", "harness", "projects", "history", "optimizers"]
const REMOTE_FOCUS_ORDER: FocusMode[] = [...COMMON_FOCUS_ORDER, "gardener", "harness", "projects", "history", "hosted", "remote"]
const CURSOR_EXCLUDED_FOCUS: ReadonlySet<FocusMode> = new Set([
  "effort",
  "subagent-model",
  "subagent-effort",
  "subagents",
])
const SESSION_HISTORY_VISIBLE_ROWS = 7
const LEFT_GARDENER_PANEL_WIDTH = "26%"
const LEFT_GARDENER_PANEL_COLUMNS_FRACTION = 0.26
const CENTER_PANEL_WIDTH = "22%"
const CENTER_PANEL_COLUMNS_FRACTION = 0.22
const MONITOR_PANEL_WIDTH = "28%"
const MONITOR_PANEL_COLUMNS_FRACTION = 0.28
const HARNESS_PROVIDER_CHOICES: ReadonlyArray<{ label: string; harness: StackHarnessKind }> = [
  { label: "ChatGPT", harness: "codex" },
  { label: "Cursor", harness: "cursor" },
]

export async function runStackApp(options: StackAppOptions): Promise<void> {
  if (!isCursorHarness(options.config)) {
    syncStackSubagentAgentFiles(options.config)
  }
  const runtimeFactory = await readRuntimeFactory()
  const runtimeFactorySnapshot = runtimeFactory.snapshot
  const optimizerSnapshot =
    localOptimizerSnapshotFromRuntime(runtimeFactorySnapshot, options.config) ??
    await readOptimizerSnapshot(options.config)
  const optimizerCliAvailable = isOptimizerCliAvailable(options.config.optimizerCommand)
  const localStackBoot = await ensureLocalStackBootstrap(options.config)
  const remoteAccountSnapshot = await readRemoteAccountSnapshot(options.config)
  const remoteUsageSnapshot = await readRemoteUsageSnapshot(options.config)
  const remoteResearchFromApi = await readRemoteResearchSnapshot(options.config)
  const remoteResearchSnapshot =
    remoteResearchSnapshotFromRuntime(runtimeFactorySnapshot, options.config, remoteResearchFromApi) ??
    remoteResearchFromApi
  const remoteProjectsSnapshot =
    remoteProjectsPanelFromRuntime(runtimeFactorySnapshot, options.config) ??
    await readRemoteProjectsPanelSnapshot(options.config)
  const containersSnapshot = await readContainersPanelSnapshot(options.config)
  const hostedOptimizerSnapshot =
    hostedOptimizerSnapshotFromRuntime(runtimeFactorySnapshot, options.config) ??
    await readHostedOptimizerSnapshot(options.config)
  const recentRemoteDownloads = await readRemoteDownloadHistory(options.config)
  await writeSessionLog(options.session, options.config.sessionLogDir, {
    codexModel: harnessModel(options.config),
    pricingRows: options.config.codexPricing,
  })
  let history = await loadThreadHistory(options.config, options.session)
  const gardenerEnsured = await ensureGardenerThread({
    stackRoot: options.config.stackDataRoot,
    sessionLogDir: options.config.sessionLogDir,
    workspaceRoot: options.config.workspaceRoot,
    codexCommand: harnessSessionCommand(options.config),
    codexModel: harnessModel(options.config),
    pricingRows: options.config.codexPricing,
  })
  if (gardenerEnsured.created) {
    history = await loadThreadHistory(options.config, options.session)
  }
  history = pinGardenerThreadToTop(history, gardenerEnsured.threadId)
  const defaultWorker = history.find((summary) => summary.id !== gardenerEnsured.threadId)
  const state: AppState = {
    focusMode: "gardener",
    liveOpsMode: "local",
    railsVisible: false,
    leftPanelOpen: true,
    leftPanelRailsVisible: false,
    rightPanelOpen: false,
    showDetails: false,
    expandedBlockIds: new Set<string>(),
    selectedToolIndex: 0,
    selectedHistoryIndex: 0,
    selectedProjectIndex: 0,
    agentScrollOffset: 0,
    status: "idle",
    spinnerFrame: 0,
    emaTokensPerSecond: seedEmaFromTurns(options.session.turns),
    blocks: [],
    inputBuffer: readInitialPrompt(options.config),
    monitorInputBuffer: "",
    sidecarQueuedMessages: [],
    sidecarChatInFlight: false,
    sidecarDispatchRef: { current: Promise.resolve() },
    gardenerInputBuffer: "",
    slashMenuIndex: 0,
    goalPanelSelectedIndex: 0,
    goalShutterWorkerPeek: false,
    goalShutterScrollOffset: 0,
    goalShutterScrollPinned: true,
    toolLogs: [],
    subagentLogs: [],
    history,
    threadGoalStatus: new Map(),
    optimizerSnapshot: localStackBoot.optimizer ?? optimizerSnapshot,
    optimizerCliAvailable,
    localBootstrapSnapshot: localStackBoot.bootstrap,
    selectedOptimizerRunIndex: 0,
    remoteAccountSnapshot,
    remoteUsageSnapshot,
    remoteResearchSnapshot,
    remoteProjectsSnapshot,
    runtimeFactorySnapshot,
    runtimeFactoryEventsAppended: runtimeFactory.eventsAppended,
    containersSnapshot,
    rightPanelMode: "actors",
    rightPanelOpsVisible: true,
    monitorPanelMode: "chat",
    gardenerPanelMode: "chat",
    leftPanelMode: "threads",
    leftPanelScrollOffset: 0,
    gardenerScrollOffset: 0,
    gardenerScrollPinned: true,
    gardenerEventScrollOffset: 0,
    gardenerEventScrollPinned: true,
    opsScrollOffset: 0,
    monitorScrollOffset: 0,
    monitorScrollPinned: true,
    monitorEventScrollOffset: 0,
    monitorEventScrollPinned: true,
    monitorWatchScrollOffset: 0,
    monitorWatchScrollPinned: true,
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
    goalContext: emptyGoalContext(),
    metaThreadManifest: undefined,
    agentViewEnabled: false,
    planningColumns: 80,
    threadsRailColumns: 40,
    harnessCommand: harnessSessionCommand(options.config),
    codexTransport: isCursorHarness(options.config) ? "acp" : resolveCodexTransport(),
    codexAccountEmail: isCursorHarness(options.config)
      ? (await readCursorAccountSnapshot(options.config.cursorCommand)).email
      : (await readCodexAccountSnapshot()).email,
    cursorAccount: isCursorHarness(options.config)
      ? await readCursorAccountSnapshot(options.config.cursorCommand)
      : undefined,
    queuedMessages: [],
    talkToGardener: false,
    talkToMonitor: false,
    gardenerThreadId: gardenerEnsured.threadId,
    gardenerWorkerTargetId: defaultWorker?.id,
    monitorWorkerTargetId: options.session.id,
    gardenerInboxSelectedIndex: 0,
    gardenerWorkerQueue: [],
    voiceStatus: readVoiceStatus(options.config),
    voiceTranscribing: false,
    voiceFinishInFlight: false,
    gardenerChatRunning: false,
    gardenerLiveBlocks: [],
    gardenerLiveTools: [],
    gardenerLiveSubagents: [],
    monitorSnapshot: refreshMonitorSnapshot(options.config.stackDataRoot, options.session.id),
    metaEvents: readThreadMetaEvents(options.config.stackDataRoot, options.session.id),
  }
  if (options.resumeManifest) {
    state.metaThreadManifest = options.resumeManifest
    state.goalContext = mergeMetaThreadGoalContext(state.goalContext, options.resumeManifest)
  }
  if (options.session.turns.length > 0) {
    const rendered = renderTurns(options.session.turns)
    state.blocks = rendered.blocks
    state.toolLogs = rendered.tools
    state.subagentLogs = rendered.subagents
    state.selectedToolIndex = clampIndex(rendered.tools.length - 1, rendered.tools.length)
    state.lastUsage = options.session.turns.at(-1)?.usage ?? rendered.usage
    refreshSessionThroughput(state, options.session.turns)
  }
  if (options.resumeCheckpoint || options.session.metaThreadId) {
    applyGoalUiAfterSessionResume(state, options.resumeCheckpoint, options.session)
    syncGoalModeDefaults(options, state)
    syncSessionDisplayNameFromGoal(options, state)
  }
  syncGardenerLeftPanel(state)
  syncMonitorRightPanel(state)
  state.rightPanelOpsVisible = !isMonitorOn(state.monitorSnapshot)
  let codexSessionHandle: { session?: HarnessSession } = {}
  if (options.session.id === gardenerEnsured.threadId) {
    applyGardenerHarnessToConfig(options.config)
  }
  await openHarnessSession(options, state, codexSessionHandle, options.session.codexThreadId, { probe: true })
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
    const selectedId = state.history[state.selectedHistoryIndex]?.id ?? options.session.id
    state.history = pinGardenerThreadToTop(
      await loadThreadHistory(options.config, options.session),
      state.gardenerThreadId,
    )
    const ensured = await ensureGardenerThread({
      stackRoot: options.config.stackDataRoot,
      sessionLogDir: options.config.sessionLogDir,
      workspaceRoot: options.config.workspaceRoot,
      codexCommand: harnessSessionCommand(options.config),
      codexModel: harnessModel(options.config),
      pricingRows: options.config.codexPricing,
    })
    state.gardenerThreadId = ensured.threadId
    if (ensured.created) {
      state.history = pinGardenerThreadToTop(
        await loadThreadHistory(options.config, options.session),
        state.gardenerThreadId,
      )
    } else {
      state.history = pinGardenerThreadToTop(
        ensureSessionInHistory(
          state.history,
          options.session,
          options.config.sessionLogDir,
          harnessModel(options.config),
          options.config.codexPricing,
        ),
        state.gardenerThreadId,
      )
    }
    const selectedIndex = state.history.findIndex((summary) => summary.id === selectedId)
    state.selectedHistoryIndex =
      selectedIndex >= 0 ? selectedIndex : clampIndex(state.selectedHistoryIndex, state.history.length)
    const currentIndex = state.history.findIndex((summary) => summary.id === options.session.id)
    if (currentIndex >= 0 && selectedIndex < 0) state.selectedHistoryIndex = currentIndex
    await refreshGardenerMaintenance(options, state, "idle")
    await refreshThreadGoalStatus(options, state)
  }

  const refreshMetaEvents = () => {
    state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  }

  let spinnerInterval: ReturnType<typeof setInterval> | undefined
  let optimizerInterval: ReturnType<typeof setInterval> | undefined
  let rateLimitsInterval: ReturnType<typeof setInterval> | undefined

  const observeCodexAuth = async (rateLimits?: CodexRateLimitsSnapshot) => {
    await observeCodexAuthState(options.config, options.session.id, rateLimits, state)
  }

  const refreshHarnessAccount = async () => {
    if (isCursorHarness(options.config)) {
      state.cursorAccount = await readCursorAccountSnapshot(options.config.cursorCommand)
      state.codexAccountEmail = state.cursorAccount.email
      return
    }
    const latest = await readCodexRateLimits({
      codexCommand: options.config.codexCommand,
      codexArgs: options.config.codexArgs,
    })
    await observeCodexAuth(latest)
  }

  const refreshCodexRateLimits = async () => {
    if (isCursorHarness(options.config)) {
      await refreshHarnessAccount()
      return
    }
    const latest = await readCodexRateLimits({
      codexCommand: options.config.codexCommand,
      codexArgs: options.config.codexArgs,
    })
    await observeCodexAuth(latest)
  }

  const refreshLocalBootstrap = async () => {
    state.localBootstrapSnapshot = await refreshLocalBootstrapSnapshot(
      options.config,
      state.localBootstrapSnapshot,
    )
  }

  const refreshOptimizers = async () => {
    const runtimeFactory = await readRuntimeFactory()
    state.runtimeFactorySnapshot = runtimeFactory.snapshot
    state.runtimeFactoryEventsAppended = runtimeFactory.eventsAppended
    state.optimizerSnapshot =
      localOptimizerSnapshotFromRuntime(runtimeFactory.snapshot, options.config, state.optimizerSnapshot) ??
      await readOptimizerSnapshot(options.config)
    state.selectedOptimizerRunIndex = clampIndex(state.selectedOptimizerRunIndex, state.optimizerSnapshot.runs.length)
  }

  const refreshRemoteAccount = async () => {
    state.remoteAccountSnapshot = await readRemoteAccountSnapshot(options.config)
  }

  const refreshRemoteUsage = async () => {
    state.remoteUsageSnapshot = await readRemoteUsageSnapshot(options.config)
  }

  const refreshRemoteResearch = async () => {
    const [remoteResearchFromApi, runtimeFactory] = await Promise.all([
      readRemoteResearchSnapshot(options.config),
      readRuntimeFactory(),
    ])
    state.runtimeFactorySnapshot = runtimeFactory.snapshot
    state.runtimeFactoryEventsAppended = runtimeFactory.eventsAppended
    state.remoteResearchSnapshot =
      remoteResearchSnapshotFromRuntime(runtimeFactory.snapshot, options.config, remoteResearchFromApi) ??
      remoteResearchFromApi
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
    const [projectsFromApi, runtimeFactory] = await Promise.all([
      readRemoteProjectsPanelSnapshot(options.config),
      readRuntimeFactory(),
    ])
    state.remoteProjectsSnapshot =
      remoteProjectsPanelFromRuntime(runtimeFactory.snapshot, options.config) ??
      projectsFromApi
    state.runtimeFactorySnapshot = runtimeFactory.snapshot
    state.runtimeFactoryEventsAppended = runtimeFactory.eventsAppended
    state.containersSnapshot = await readContainersPanelSnapshot(options.config)
    state.selectedProjectIndex = clampIndex(
      state.selectedProjectIndex,
      state.remoteProjectsSnapshot.projects.length,
    )
  }

  const refreshHostedOptimizers = async () => {
    const [hostedFromApi, runtimeFactory] = await Promise.all([
      readHostedOptimizerSnapshot(options.config),
      readRuntimeFactory(),
    ])
    state.runtimeFactorySnapshot = runtimeFactory.snapshot
    state.runtimeFactoryEventsAppended = runtimeFactory.eventsAppended
    state.hostedOptimizerSnapshot =
      hostedOptimizerSnapshotFromRuntime(runtimeFactory.snapshot, options.config, hostedFromApi) ??
      hostedFromApi
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

  let sidecarDispatchTail: Promise<void> = Promise.resolve()
  state.sidecarDispatchRef = { current: sidecarDispatchTail }

  const submitFromCurrentInput = (key?: StackKeyEvent, forceQueue = false): boolean => {
    if (!view || state.focusMode !== "agent") return false
    const prompt = resolveSlashSubmitPrompt(state.inputBuffer.trim(), state.slashMenuIndex)
    if (!prompt) return false
    key?.preventDefault?.()
    key?.stopPropagation?.()
    if (
      submitGoalSlashIfNeeded(
        prompt,
        options,
        state,
        codexSessionHandle,
        renderer,
        remount,
        refreshHistory,
        refreshMetaEvents,
        () => {
          state.inputBuffer = ""
          state.slashMenuIndex = 0
        },
      )
    ) {
      return true
    }
    if (
      dispatchSlashCommand(
        prompt,
        buildSlashDispatchHooks(
          options,
          state,
          remount,
          exitStack,
          codexSessionHandle,
          renderer,
          refreshHistory,
          refreshMetaEvents,
          cycleStackEnvironmentFromUi,
          refreshAfterEnvironmentChange,
        ),
      )
    ) {
      state.inputBuffer = ""
      state.slashMenuIndex = 0
      return true
    }
    submitInputValue(prompt, options, state, codexSessionHandle, renderer, remount, refreshHistory, refreshMetaEvents, forceQueue)
    state.slashMenuIndex = 0
    return true
  }

  const submitFromMonitorInput = (key?: StackKeyEvent, hardSend = false): boolean => {
    if (!view || state.focusMode !== "monitor") return false
    const prompt = resolveSlashSubmitPrompt(state.monitorInputBuffer.trim(), state.slashMenuIndex)
    if (!prompt) return false
    key?.preventDefault?.()
    key?.stopPropagation?.()
    if (
      submitGoalSlashIfNeeded(
        prompt,
        options,
        state,
        codexSessionHandle,
        renderer,
        remount,
        refreshHistory,
        refreshMetaEvents,
        () => {
          state.monitorInputBuffer = ""
          state.slashMenuIndex = 0
        },
      )
    ) {
      return true
    }
    if (
      dispatchSlashCommand(
        prompt,
        buildSlashDispatchHooks(
          options,
          state,
          remount,
          exitStack,
          codexSessionHandle,
          renderer,
          refreshHistory,
          refreshMetaEvents,
          cycleStackEnvironmentFromUi,
          refreshAfterEnvironmentChange,
        ),
      )
    ) {
      state.monitorInputBuffer = ""
      state.slashMenuIndex = 0
      return true
    }
    submitMonitorInputValue(
      prompt,
      options,
      state,
      remount,
      refreshHistory,
      refreshMetaEvents,
      hardSend,
    )
    state.slashMenuIndex = 0
    return true
  }

  const submitFromGardenerInput = (key?: StackKeyEvent): boolean => {
    if (!view || state.focusMode !== "gardener") return false
    if (state.gardenerChatRunning) return false
    const prompt = resolveSlashSubmitPrompt(state.gardenerInputBuffer.trim(), state.slashMenuIndex)
    if (!prompt) return false
    key?.preventDefault?.()
    key?.stopPropagation?.()
    if (
      submitGoalSlashIfNeeded(
        prompt,
        options,
        state,
        codexSessionHandle,
        renderer,
        remount,
        refreshHistory,
        refreshMetaEvents,
        () => {
          state.gardenerInputBuffer = ""
          state.slashMenuIndex = 0
        },
      )
    ) {
      return true
    }
    if (
      dispatchSlashCommand(
        prompt,
        buildSlashDispatchHooks(
          options,
          state,
          remount,
          exitStack,
          codexSessionHandle,
          renderer,
          refreshHistory,
          refreshMetaEvents,
          cycleStackEnvironmentFromUi,
          refreshAfterEnvironmentChange,
        ),
      )
    ) {
      state.gardenerInputBuffer = ""
      state.slashMenuIndex = 0
      return true
    }
    void submitGardenerInputValue(
      prompt,
      options,
      state,
      codexSessionHandle,
      renderer,
      remount,
      refreshHistory,
      refreshMetaEvents,
    )
    return true
  }

  let renderer: CliRenderer
  renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useKittyKeyboard: {
      events: true,
      disambiguate: true,
      alternateKeys: true,
    },
    prependInputHandlers: [
      (sequence: string) => {
        return handleRawInput(
          sequence,
          options,
          state,
          renderer,
          submitFromCurrentInput,
          submitFromMonitorInput,
          submitFromGardenerInput,
          remount,
          refreshHistory,
          refreshMetaEvents,
          codexSessionHandle,
          refreshHarnessAccount,
          refreshOptimizers,
          refreshRemoteAccount,
          refreshRemoteUsage,
          refreshRemoteResearch,
          refreshRemoteProjects,
          refreshHostedOptimizers,
          refreshRemoteOpsPanel,
          cycleStackEnvironmentFromUi,
        )
      },
    ],
  })

  const onPaste = (event: PasteEvent) => {
    const paste = normalizePasteText(decodePasteBytes(event.bytes))
    if (!paste) return
    appendPasteToFocusedBuffer(state, paste, remount)
    event.preventDefault()
    event.stopPropagation()
  }
  if (typeof renderer.keyInput.prependListener === "function") {
    renderer.keyInput.prependListener("paste", onPaste)
  } else {
    renderer.keyInput.on("paste", onPaste)
  }

  const shutdown = createStackAppShutdown()
  const exitStack = () => shutdown.run(0)

  view = mountView(renderer, options, state, undefined)
  remount = () => {
    view = mountView(renderer, options, state, view)
  }

  void refreshGardenerMaintenance(options, state, "manual").finally(remount)

  void (async () => {
    try {
      if (options.resumeCheckpoint || options.session.metaThreadId) {
        await restoreWorkerSessionAfterResume(
          options,
          state,
          codexSessionHandle,
          options.resumeCheckpoint,
          remount,
          refreshHistory,
          refreshMetaEvents,
        )
      } else {
        await refreshAgentContextFromSession(options, state, remount, (limits) => {
          void observeCodexAuthState(options.config, options.session.id, limits, state)
        })
        syncGoalModeDefaults(options, state)
      }
      remount()
    } catch {
      remount()
    }
  })()

  if (options.config.autoSubmitInitialPrompt && state.inputBuffer.trim()) {
    setTimeout(() => {
      if (state.status === "running") return
      submitInputValue(
        state.inputBuffer.trim(),
        options,
        state,
        codexSessionHandle,
        renderer,
        remount,
        refreshHistory,
        refreshMetaEvents,
      )
    }, 250)
  }

  spinnerInterval = setInterval(() => {
    if (state.status !== "running") return
    if (isRecentAgentScroll(state)) return
    state.spinnerFrame += 1
    view?.root.requestRender()
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

  registerFatalProcessHandlers(shutdown)
  try {
    process.stdout.write(ENABLE_BRACKETED_PASTE)
  } catch {
    // Best-effort; paste still works for inline multi-line chunks when supported.
  }
  shutdown.register(() => {
    persistSessionOnExit(options, state, codexSessionHandle, shutdown)
  })
  shutdown.register(() => {
    try {
      process.stdout.write("\x1b[?2004l")
    } catch {
      // ignore
    }
  })
  registerRendererShutdown(shutdown, renderer, [spinnerInterval, optimizerInterval, projectsInterval, rateLimitsInterval], [
    () => {
      void codexSessionHandle.session?.close()
    },
  ])

  const voiceKeyContext = (): VoiceKeyContext => ({
    options,
    state,
    codexSessionHandle,
    renderer,
    refresh: remount,
    refreshHistory,
    refreshMetaEvents,
  })

  renderer._internalKeyInput.onInternal("keypress", (key: StackKeyEvent) => {
    if (isEnterKey(key) && key.ctrl && state.focusMode === "agent") {
      submitFromCurrentInput(key, true)
      return
    }

    if (isEnterKey(key) && submitFromCurrentInput(key)) return
  })

  renderer.keyInput.on("keyrelease", (key: StackKeyEvent) => {
    if (handleVoiceKey(key, "release", voiceKeyContext())) return
  })

  renderer.keyInput.on("keypress", (key: StackKeyEvent) => {
    if (key.ctrl && key.name === "c") {
      appendStackBlock(state.blocks, "type /exit to quit")
      remount()
      return
    }
    const voiceKind = key.eventType === "release" ? "release" : "press"
    if (voiceKind === "press" && key.eventType === "repeat") {
      return
    }
    if (voiceKind === "press" && handleVoiceKey(key, "press", voiceKeyContext())) return
    if (isGoalMode(state) && !focusedInputEditing(state)) {
      if (key.name === "m") {
        focusGoalSidecarChat(options, state, remount)
        return
      }
      if (key.name === "g") {
        state.goalShutterWorkerPeek = false
        state.focusMode = "goal"
        openGoalPanel(state)
        remount()
        return
      }
      if (key.name === "a") {
        state.agentViewEnabled = !state.agentViewEnabled
        remount()
        return
      }
      if (key.name === "1") {
        focusGoalWorkerPeek(state, remount)
        return
      }
      if (key.name === "2") {
        returnToGoalShutter(state, remount)
        return
      }
    }

    if (key.name === "tab") {
      applySidePanelFocus(state, nextFocusMode(state.focusMode, state.liveOpsMode, options.config))
      remount()
      return
    }

    if (key.name === "x" && state.focusMode !== "agent") {
      toggleLiveOpsMode(state)
      remount()
      return
    }

    if (isEnterKey(key) && key.ctrl && state.focusMode === "agent") {
      submitFromCurrentInput(key, true)
      return
    }

    if (isEnterKey(key) && key.ctrl && state.focusMode === "monitor") {
      submitFromMonitorInput(key, true)
      return
    }

    if (isEnterKey(key) && submitFromCurrentInput(key)) {
      return
    }

    if (isEnterKey(key) && submitFromMonitorInput(key)) {
      return
    }

    if (isEnterKey(key) && submitFromGardenerInput(key)) {
      return
    }

    if (key.name === "escape") {
      if (state.focusMode === "goal") {
        state.goalShutterWorkerPeek = false
        state.focusMode = isGoalMode(state) ? "monitor" : "agent"
        remount()
        return
      }
      if (state.inputBuffer.length > 0) {
        state.inputBuffer = ""
        remount()
        return
      }
      if (state.monitorInputBuffer.length > 0) {
        state.monitorInputBuffer = ""
        remount()
        return
      }
      if (state.gardenerInputBuffer.length > 0) {
        state.gardenerInputBuffer = ""
        remount()
        return
      }
      if (isGoalMode(state)) {
        if (returnToGoalShutter(state, remount)) return
        focusGoalWorkerPeek(state, remount)
        return
      }
      if (state.status === "running" && codexSessionHandle.session) {
        appendStackBlock(state.blocks, "interrupt requested")
        void codexSessionHandle.session.interrupt().finally(remount)
        return
      }
      return
    }

    if (key.name === "b" && state.focusMode === "agent" && !focusedInputEditing(state)) {
      state.railsVisible = !state.railsVisible
      remount()
      return
    }

    if (key.name === "d" && state.focusMode === "agent" && !focusedInputEditing(state)) {
      state.showDetails = !state.showDetails
      remount()
      return
    }

    if (key.name === "a" && state.focusMode === "agent" && !focusedInputEditing(state)) {
      state.agentViewEnabled = !state.agentViewEnabled
      remount()
      return
    }

    if (key.name === "G" && state.focusMode === "agent") {
      openGardenerPanel(state, remount)
      return
    }

    if (key.name === "M" && state.focusMode === "agent") {
      toggleMonitorPanelVisibility(options, state, remount)
      return
    }

    if (key.name === "p" && state.focusMode === "agent" && !focusedInputEditing(state)) {
      toggleLeftPanelRails(state)
      remount()
      return
    }

    if (key.name === "P" && state.focusMode === "agent" && isMonitorOn(state.monitorSnapshot)) {
      toggleRightPanelOps(state)
      remount()
      return
    }

    if (state.focusMode === "agent" && !focusedInputEditing(state) && (key.name === "]" || key.name === "[")) {
      void cycleStackEnvironmentFromUi(key.name === "]" ? 1 : -1)
      return
    }

    if (isEnterKey(key) && submitFromCurrentInput(key)) {
      return
    }

    if (isEnterKey(key) && submitFromMonitorInput(key)) {
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

    if (state.focusMode === "projects") {
      handleProjectsFocusKey(key, state, remount, refreshRemoteProjects)
      return
    }

    if (state.focusMode === "history") {
      void handleHistoryKey(
        key,
        options,
        state,
        remount,
        refreshHistory,
        refreshRemoteAccount,
        refreshRemoteUsage,
        refreshMetaEvents,
        codexSessionHandle,
        refreshHarnessAccount,
        renderer,
        centerActiveThreadRows(renderer),
      )
      return
    }

    if (state.focusMode === "harness") {
      handleHarnessEventScrollKey(
        key,
        state,
        options,
        renderer,
        remount,
      )
      return
    }

    if (state.focusMode === "gardener") {
      if (isEnterKey(key) && submitFromGardenerInput(key)) {
        return
      }
      void handleGardenerKey(
        key,
        options,
        state,
        codexSessionHandle,
        renderer,
        remount,
        refreshHistory,
        refreshMetaEvents,
        gardenerThreadVisibleRows(renderer, state),
      )
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

    if (state.focusMode === "goal") {
      handleGoalPanelKey(key, options, state, codexSessionHandle, remount)
      return
    }

    if (state.focusMode === "effort") {
      handleEffortKey(key, options.config)
      remount()
      return
    }

    if (state.focusMode === "subagent-model") {
      handleSubagentModelKey(key, options.config)
      remount()
      return
    }

    if (state.focusMode === "subagent-effort") {
      handleSubagentEffortKey(key, options.config)
      remount()
      return
    }

    if (state.focusMode === "subagents") {
      handleSubagentsKey(key, options.config)
      remount()
      return
    }

    if (state.focusMode === "monitor") {
      if (isEnterKey(key) && submitFromMonitorInput(key)) {
        return
      }
      handleMonitorKey(
        key,
        options,
        state,
        codexSessionHandle,
        renderer,
        remount,
        refreshHistory,
        refreshMetaEvents,
      )
      return
    }

    if (state.focusMode === "account") {
      void handleAccountKey(key, options, state, codexSessionHandle, remount)
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

    const nextView = createView(
      renderer,
      options,
      state,
      remount,
      refreshAfterEnvironmentChange,
      codexSessionHandle,
      refreshHistory,
      refreshMetaEvents,
      exitStack,
    )
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
  codexSessionHandle: { session?: HarnessSession },
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  exitStack: () => void,
): MountedView {
  syncGoalModeDefaults(options, state)
  const switcher = switcherPanel(options, state, refresh, applyStackEnvironmentFromUi)
  const goalModeActive = isGoalMode(state)
  const showGoalShutter = goalModeActive && !state.goalShutterWorkerPeek
  const baseTranscriptViewport = transcriptViewportMetrics(renderer, state)
  const goalStripLines =
    state.metaThreadManifest?.active_goal?.objective?.trim() ||
    state.goalContext.objective?.trim()
      ? 1
      : 0
  const transcriptViewport =
    goalModeActive && !showGoalShutter
      ? {
          ...baseTranscriptViewport,
          lines: goalWorkerPeekTranscriptRows(baseTranscriptViewport.lines, goalStripLines),
          pageLines: Math.max(
            3,
            Math.floor(goalWorkerPeekTranscriptRows(baseTranscriptViewport.lines, goalStripLines) * 0.8),
          ),
        }
      : baseTranscriptViewport
  state.planningColumns = transcriptViewport.columns
  updateThreadsRailColumns(renderer, state)
  const threadRows = centerActiveThreadRows(renderer)
  const projectRows = centerActiveProjectRows(renderer)
  const eventStreamRows = centerEventStreamRows(renderer)
  const gardenerRows = gardenerThreadVisibleRows(renderer, state)
  const leftPanelLayout = leftGardenerPanelLayout(state)
  const leftColumns = gardenerPanelColumns(renderer, leftPanelLayout.fraction)
  const centerColumns = centerPanelColumns(renderer)
  const activeThreadIds = resolveActiveThreadIds(options.session.id, state.gardenerWorkerTargetId)
  const gardenerEvents = readThreadMetaEvents(options.config.stackDataRoot, state.gardenerThreadId)
  const workerMetaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  const gardenerChatBlocks = buildGardenerChatBlocks(state, gardenerEvents)
  const gardenerTranscriptOptions = gardenerTranscriptRenderOptions(
    transcriptRenderOptions(state),
    state.gardenerChatRunning,
    state.gardenerLiveThinking,
  )
  const gardenerChatAreaRows = gardenerChatVisibleRows(renderer, state)
  const coreEventStreamContext = resolveCoreEventStreamContext(state)
  tailGardenerThreadScroll(
    state,
    gardenerChatBlocks,
    state.gardenerLiveTools,
    state.gardenerLiveSubagents,
    leftColumns,
    gardenerChatAreaRows,
    gardenerTranscriptOptions,
    state.gardenerChatRunning,
  )
  tailCoreEventScroll(
    state,
    coreEventStreamContext,
    gardenerEvents,
    workerMetaEvents,
    centerColumns,
    eventStreamRows,
  )
  const projectsRows = opsVisibleRows(renderer, state)
  const monitorTargetId = resolveMonitorWorkerTargetId(options, state)
  const monitorTargetMetaEvents = readThreadMetaEvents(options.config.stackDataRoot, monitorTargetId)
  const monitorPanelSnapshot = refreshMonitorSnapshot(options.config.stackDataRoot, monitorTargetId)
  const monitorWatchLive = monitorTargetId === options.session.id
  const monitorRows = monitorThreadVisibleRows(renderer, state)
  const rightColumns = monitorPanelColumns(renderer, state)
  const workerActive =
    monitorWatchLive && monitorWorkerActive(state) && !monitorWatchSuppressedByGoalChat(state)
  const monitorChatBlocks = blocksFromMonitorChatEvents(monitorTargetMetaEvents)
  const monitorTranscriptOptions = monitorTranscriptRenderOptions(
    transcriptRenderOptions(state),
    monitorPanelSnapshot,
  )
  const monitorChatSplit = monitorChatRowSplit(monitorRows, workerActive)
  const showOpsPanel = !isMonitorOn(state.monitorSnapshot) || state.rightPanelOpsVisible
  if (isMonitorOn(state.monitorSnapshot)) {
    tailMonitorThreadScroll(
      state,
      monitorChatBlocks,
      rightColumns,
      monitorChatSplit.watchRows > 0 ? monitorChatSplit.narrativeRows : monitorRows,
      monitorTranscriptOptions,
    )
    tailMonitorWatchScroll(state, rightColumns, monitorChatSplit.watchRows)
  }
  const sidecarMenuElements = showGoalShutter
    ? slashMenuElements(
        state.monitorInputBuffer,
        state.slashMenuIndex,
        buildSlashCommandContext(options, state),
        transcriptViewport.columns,
        state.focusMode === "monitor",
      )
    : []
  const goalStreamRows = showGoalShutter
    ? goalShutterStreamVisibleRows(
        transcriptViewport.lines,
        goalShutterCardLineCount({
          state,
          events: workerMetaEvents,
          columns: transcriptViewport.columns,
          metaThreadId: options.session.metaThreadId,
        }),
        sidecarMenuElements.length > 0 ? 1 : 0,
      )
    : 0
  if (showGoalShutter) {
    tailGoalShutterScroll(state, workerMetaEvents, transcriptViewport.columns, goalStreamRows)
  }
  const opsPanelInput = buildOpsPanelInput(options, state)
  const focusCenterProjects = panelFocusHandlers(state, "projects", refresh)
  const focusCenterThreads = panelFocusHandlers(state, "history", refresh)
  const focusCenterEvents = panelFocusHandlers(state, "harness", refresh)
  const focusGardener = panelFocusHandlers(state, "gardener", refresh)
  const focusAgent = agentPanelFocusHandlers(state, refresh)
  const focusOps = panelFocusHandlers(state, "ops", refresh)
  const focusMonitor = panelFocusHandlers(state, "monitor", refresh)
  const openLeftPanel = () => {
    state.leftPanelOpen = true
    state.focusMode = "gardener"
    refresh()
  }
  const openRightPanel = () => {
    state.rightPanelOpen = true
    state.focusMode =
      state.rightPanelOpsVisible || !isMonitorOn(state.monitorSnapshot) ? "ops" : "monitor"
    refresh()
  }
  const goalPanelTabHandlers = goalModeActive
    ? {
        onSelectChatTab: () => focusGoalWorkerPeek(state, refresh),
        onSelectProgressTab: () => returnToGoalShutter(state, refresh),
      }
    : undefined
  const agentChildren = [
    agentPanelIdsCopyIcon(renderer, options, state, refresh),
    ...(state.railsVisible ? [Text({ content: mediationTopStrip(options, state), fg: theme.synth.amber })] : []),
    ...(showGoalShutter
      ? [
          renderGoalShutter({
            state,
            events: workerMetaEvents,
            columns: transcriptViewport.columns,
            visibleRows: transcriptViewport.lines,
            streamRows: goalStreamRows,
            scrollOffset: state.goalShutterScrollOffset,
            metaThreadId: options.session.metaThreadId,
            sidecarMenuElements,
            onFocusSidecar: () => focusGoalSidecarChat(options, state, refresh),
            onPrefillSidecar: (prompt) => {
              state.monitorInputBuffer = prompt
              focusGoalSidecarChat(options, state, refresh)
            },
            ...goalPanelTabHandlers,
          }),
        ]
      : [
          ...(goalPanelTabHandlers
            ? [
                renderGoalWorkerPeekPanel({
                  active: "chat",
                  onSelectChat: goalPanelTabHandlers.onSelectChatTab,
                  onSelectProgress: goalPanelTabHandlers.onSelectProgressTab,
                  transcript: renderTranscriptPanel(state, transcriptViewport),
                  objective:
                    state.metaThreadManifest?.active_goal?.objective?.trim() ||
                    state.goalContext.objective?.trim(),
                }),
              ]
            : [transcriptPane(renderTranscriptPanel(state, transcriptViewport))]),
        ]),
    ...(state.focusMode === "goal" ? [renderGoalPanel(state)] : []),
    ...(switcher ? [switcher] : []),
    ...(showGoalShutter ? [] : [agentControlRow(options, state, transcriptViewport.columns, refresh)]),
  ]

  const root = Box(
    {
      id: "stack-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: theme.bgCanvas,
      padding: stackTuiLayout.rootPadding,
      gap: stackTuiLayout.rootGap,
    },
    globalConnectionBar(options, state, refresh, applyStackEnvironmentFromUi, codexSessionHandle, renderer.terminalWidth, exitStack),
    Box(
      {
        flexDirection: "row",
        flexGrow: 1,
        gap: stackTuiLayout.rootGap,
        alignItems: "stretch",
      },
      ...(state.leftPanelOpen
        ? [
            Box(
              {
                width: leftPanelLayout.width,
                flexDirection: "column",
                gap: stackTuiLayout.panelGap,
                flexShrink: 0,
              },
              Box(
                {
                  border: true,
                  borderStyle: "single",
                  borderColor:
                    state.focusMode === "gardener" ? theme.borderActive : theme.borderInactive,
                  title: gardenerPanelTitle(options, state),
                  backgroundColor: theme.bgCanvas,
                  flexGrow: 1,
                  flexDirection: "column",
                  padding: stackTuiLayout.panelPadding,
                  gap: stackTuiLayout.panelGap,
                  ...focusGardener,
                  onMouseScroll(event) {
                    handleGardenerChatScroll(
                      event,
                      state,
                      gardenerChatBlocks,
                      state.gardenerLiveTools,
                      state.gardenerLiveSubagents,
                      leftColumns,
                      gardenerChatAreaRows,
                      gardenerTranscriptOptions,
                      refresh,
                    )
                  },
                },
                transcriptPane(
                  renderRoleChatTranscriptStyled(
                    gardenerChatBlocks,
                    state.gardenerLiveTools,
                    state.gardenerLiveSubagents,
                    {
                      columns: leftColumns,
                      lines: gardenerChatAreaRows,
                      pageLines: 6,
                    },
                    gardenerTranscriptOptions,
                    state.gardenerScrollOffset,
                  ),
                ),
                gardenerControlRow(options, state, refresh, leftColumns),
              ),
            ),
          ]
        : [collapsedSideTab(agentRolePanelTitle("gardener"), "left", openLeftPanel)]),
      Box(
        {
          width: CENTER_PANEL_WIDTH,
          flexDirection: "column",
          gap: stackTuiLayout.panelGap,
          flexShrink: 0,
        },
        Box(
          {
            border: true,
            borderStyle: "single",
            borderColor: state.focusMode === "projects" ? theme.borderActive : theme.borderInactive,
            title: "Active projects",
            backgroundColor: theme.bgPanel,
            flexShrink: 0,
            flexDirection: "column",
            padding: stackTuiLayout.panelPadding,
            ...focusCenterProjects,
            onMouseScroll(event) {
              handleCenterProjectsMouseScroll(
                event,
                state,
                state.remoteProjectsSnapshot,
                projectRows,
                refresh,
              )
            },
          },
          Text({
            content: renderActiveProjectsStyled({
              snapshot: state.remoteProjectsSnapshot,
              runtimeSnapshot: state.runtimeFactorySnapshot,
              runtimeEventsAppended: state.runtimeFactoryEventsAppended,
              selectedProjectIndex: state.selectedProjectIndex,
              visibleRows: projectRows,
              columns: centerColumns,
            }),
          }),
        ),
        Box(
          {
            border: true,
            borderStyle: "single",
            borderColor: state.focusMode === "history" ? theme.borderActive : theme.borderInactive,
            title: "Active threads",
            backgroundColor: theme.bgPanel,
            flexShrink: 0,
            flexDirection: "column",
            padding: stackTuiLayout.panelPadding,
            ...focusCenterThreads,
            onMouseScroll(event) {
              handleCenterThreadsMouseScroll(event, state, refresh)
            },
          },
          Box(
            { flexDirection: "row", width: "100%", flexShrink: 0, gap: 1 },
            Text({
              content: activeThreadsFocusHint(state.focusMode),
              fg: theme.fgMuted,
              flexGrow: 1,
            }),
            controlChip("+ new", true, () => {
              void startNewThread(options, state, codexSessionHandle, refresh, refreshHistory, refreshMetaEvents)
            }),
          ),
          Text({
            content: renderActiveThreadRowsStyled({
              focusMode: state.focusMode,
              history: state.history,
              activeThreadIds,
              selectedHistoryIndex: state.selectedHistoryIndex,
              currentSessionId: options.session.id,
              visibleRows: threadRows,
              columns: centerColumns,
              gardenerThreadIds: new Set([state.gardenerThreadId]),
              liveTokensPerSecond: formatAverageTokensPerSecond(displayTokensPerSecond(state)),
              usageForSummary: (summary) => threadUsageSummary(options, summary),
              threadGoalStatus: state.threadGoalStatus,
            }),
          }),
        ),
        Box(
          {
            border: true,
            borderStyle: "single",
            borderColor: state.focusMode === "harness" ? theme.borderActive : theme.borderInactive,
            title: state.agentViewEnabled ? "Events · agent" : "Events · human",
            backgroundColor: theme.bgPanel,
            flexGrow: 1,
            flexDirection: "column",
            padding: stackTuiLayout.panelPadding,
            ...focusCenterEvents,
            onMouseScroll(event) {
              handleCoreEventScroll(
                event,
                state,
                coreEventStreamContext,
                gardenerEvents,
                workerMetaEvents,
                centerColumns,
                eventStreamRows,
                refresh,
              )
            },
          },
          Text({
            content: renderCoreEventStreamStyled(
              coreEventStreamContext,
              gardenerEvents,
              workerMetaEvents,
              centerColumns,
              eventStreamRows,
              state.gardenerEventScrollOffset,
              state.agentViewEnabled,
            ),
            flexGrow: 1,
          }),
        ),
      ),
      Box(
        {
          border: true,
          borderStyle: "single",
          borderColor:
            state.focusMode === "agent" ||
            state.focusMode === "goal" ||
            (showGoalShutter && state.focusMode === "monitor") ||
            state.focusMode === "model" ||
            state.focusMode === "effort" ||
            state.focusMode === "environment" ||
            state.focusMode === "account"
              ? theme.borderActive
              : theme.borderInactive,
          title: agentPanelTitle(options, state),
          backgroundColor: theme.bgCanvas,
          flexGrow: 1,
          padding: stackTuiLayout.panelPadding,
          flexDirection: "column",
          gap: stackTuiLayout.panelGap,
          ...focusAgent,
          onMouseScroll(event) {
            event.preventDefault()
            event.stopPropagation()
            state.lastAgentScrollAt = Date.now()
            const direction = event.scroll?.direction
            if (showGoalShutter) {
              if (direction === "up" || direction === "down") {
                handleGoalShutterMouseScroll(
                  direction,
                  state,
                  workerMetaEvents,
                  transcriptViewport.columns,
                  goalStreamRows,
                  refresh,
                )
              }
              return
            }
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
      ...(state.rightPanelOpen
        ? [
            Box(
              {
                width: monitorPanelWidth(state),
                flexDirection: "column",
                gap: stackTuiLayout.panelGap,
                flexShrink: 0,
              },
              ...(isMonitorOn(state.monitorSnapshot)
                ? [
                    Box(
                      {
                        border: true,
                        borderStyle: "single",
                        borderColor:
                          state.focusMode === "monitor" ? theme.borderActive : theme.borderInactive,
                        title: monitorPanelTitle(options, state),
                        backgroundColor: theme.bgCanvas,
                        flexGrow: 1,
                        flexDirection: "column",
                        padding: stackTuiLayout.panelPadding,
                        gap: stackTuiLayout.panelGap,
                        ...focusMonitor,
                        onMouseScroll(event) {
                          if (monitorChatSplit.watchRows > 0) {
                            handleMonitorWatchScroll(
                              event,
                              state,
                              rightColumns,
                              monitorChatSplit.watchRows,
                              refresh,
                            )
                          } else {
                            handleMonitorChatScroll(
                              event,
                              state,
                              monitorChatBlocks,
                              rightColumns,
                              monitorRows,
                              monitorTranscriptOptions,
                              refresh,
                            )
                          }
                        },
                      },
                      transcriptPane(
                        renderRoleChatTranscriptStyled(
                          monitorChatBlocks,
                          [],
                          [],
                          {
                            columns: rightColumns,
                            lines: monitorChatSplit.watchRows > 0 ? monitorChatSplit.narrativeRows : monitorRows,
                            pageLines: 6,
                          },
                          monitorTranscriptOptions,
                          state.monitorScrollOffset,
                        ),
                        monitorChatSplit.watchRows > 0 ? 0 : 1,
                      ),
                      ...(monitorWatchLive && monitorChatSplit.watchRows > 0
                        ? [
                            transcriptPane(
                              renderTranscriptStyledView(
                                state.blocks,
                                state.toolLogs,
                                state.subagentLogs,
                                {
                                  columns: rightColumns,
                                  lines: monitorChatSplit.watchRows,
                                  pageLines: 6,
                                },
                                transcriptRenderOptions(state),
                                state.monitorWatchScrollOffset,
                              ),
                            ),
                          ]
                        : []),
                      monitorControlRow(options, state, refresh, rightColumns),
                    ),
                  ]
                : []),
              ...(showOpsPanel
                ? [
                    Box(
                      {
                        border: true,
                        borderStyle: "single",
                        borderColor: state.focusMode === "ops" ? theme.borderActive : theme.borderInactive,
                        title: opsPanelTitle(state.rightPanelMode, options.config.environmentName),
                        backgroundColor: theme.bgPanel,
                        flexGrow: 1,
                        padding: stackTuiLayout.panelPadding,
                        ...focusOps,
                        onMouseScroll(event) {
                          handleOpsMouseScroll(event, state, opsPanelInput, projectsRows, refresh)
                        },
                      },
                      Text({
                        content: renderOpsPanelStyled({
                          ...opsPanelInput,
                          scrollOffset: state.opsScrollOffset,
                          visibleRows: projectsRows,
                        }),
                      }),
                      ...(!isMonitorOn(state.monitorSnapshot)
                        ? [
                            Text({
                              content: renderMonitorRailStyled(state.monitorSnapshot, rightColumns),
                            }),
                          ]
                        : []),
                      Text({ content: " " }),
                      Text({
                        content: renderAgentContextStyled(
                          state.agentContext,
                          options.config.workspaceRoot,
                          rightColumns,
                        ),
                      }),
                    ),
                  ]
                : []),
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
                        backgroundColor: theme.bgPanel,
                        flexGrow: 1,
                        padding: stackTuiLayout.panelPadding,
                        ...focusCenterThreads,
                        onMouseScroll(event) {
                          handleSessionsMouseScroll(event, state, transcriptViewport, refresh)
                        },
                      },
                      Text({ content: sessionText(options, state), fg: theme.fgPrimary }),
                    ),
                  ]
                : []),
            ),
          ]
        : [
            collapsedSideTab(
              isMonitorOn(state.monitorSnapshot)
                ? agentRolePanelTitle("monitor")
                : opsPanelTitle(state.rightPanelMode, options.config.environmentName),
              "right",
              openRightPanel,
            ),
          ]),
    ),
    Text({
      content: footerHint(options.config, state, options.session.id),
      fg: theme.fgMuted,
    }),
  )

  return { root }
}

function readInitialPrompt(config: StackConfig): string {
  if (!config.initialPromptFile) return ""
  try {
    return readFileSync(config.initialPromptFile, "utf8").trim()
  } catch (error) {
    return `Stack failed to read initial prompt file: ${config.initialPromptFile}\n${String(error)}`
  }
}

function switcherPanel(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  applyStackEnvironmentFromUi: (environmentName: StackEnvironmentName) => Promise<void>,
): ReturnType<typeof Box> | undefined {
  const config = options.config
  const focusMode = state.focusMode
  if (
    focusMode !== "model" &&
    focusMode !== "effort" &&
    focusMode !== "subagent-model" &&
    focusMode !== "subagent-effort" &&
    focusMode !== "subagents" &&
    focusMode !== "environment"
  ) {
    return undefined
  }

  const title =
    focusMode === "model"
      ? "Model Switcher"
      : focusMode === "effort"
        ? "Effort Switcher"
        : focusMode === "subagent-model"
          ? "Subagent Model Switcher"
          : focusMode === "subagent-effort"
            ? "Subagent Effort Switcher"
            : focusMode === "subagents"
              ? "Subagents Switcher"
              : "Target Switcher"

  if (focusMode === "environment") {
    const envLines = [
      "click option or j/k · r refresh",
      ...STACK_ENVIRONMENT_OPTIONS.map((name) => environmentOptionLine(config, state, name)),
    ]
    return Box(
      {
        border: true,
        borderStyle: "single",
        borderColor: theme.borderActive,
        title,
        padding: stackTuiLayout.panelPadding,
        flexDirection: "column",
        width: "100%",
        flexShrink: 0,
        gap: 0,
      },
      ...envLines.map((line, index) => {
        const environmentName = index === 0 ? undefined : STACK_ENVIRONMENT_OPTIONS[index - 1]
        return switcherLine(
          line,
          environmentName !== undefined && environmentName === config.environmentName,
          environmentName
            ? () => {
                if (environmentName !== config.environmentName) {
                  void applyStackEnvironmentFromUi(environmentName)
                }
              }
            : undefined,
        )
      }),
    )
  }

  const current = switcherCurrentValue(config, state, focusMode)
  const switchOptions = switcherOptions(config, focusMode)
  const switcherLines = [
    `${switcherFocusLabel(focusMode)}: ${current}`,
    "click option or j/k · Enter cycles",
    ...switchOptions.map((option) => `${option === current ? ">" : " "} ${option}`),
  ]
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderActive,
      title,
      padding: stackTuiLayout.panelPadding,
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      gap: 0,
    },
    ...switcherLines.map((line, index) => {
      const option = index >= 2 ? switchOptions[index - 2] : undefined
      return switcherLine(
        line,
        option !== undefined && option === current,
        option ? () => applySwitcherOption(focusMode, option, options, state, refresh) : undefined,
      )
    }),
  )
}

function switcherFocusLabel(focusMode: FocusMode): string {
  if (focusMode === "model") return "model"
  if (focusMode === "effort") return "effort"
  if (focusMode === "subagent-model") return "subagent model"
  if (focusMode === "subagent-effort") return "subagent effort"
  if (focusMode === "subagents") return "subagents"
  if (focusMode === "monitor") return "monitor"
  return focusMode
}

function switcherLine(
  content: string,
  active: boolean,
  onSelect?: () => void,
): ReturnType<typeof Box> {
  return Box(
    {
      width: "100%",
      flexShrink: 0,
      flexDirection: "row",
    },
    Text({
      content,
      fg: active ? theme.fgOnAccent : content.startsWith("click") ? theme.fgMuted : theme.fgPrimary,
      bg: active ? theme.bgChipActive : undefined,
      width: "100%",
      flexShrink: 0,
      ...(onSelect
        ? {
            onMouseDown(event: PanelMouseEvent) {
              event.preventDefault?.()
              event.stopPropagation?.()
              onSelect()
            },
          }
        : {}),
    }),
  )
}

function applySwitcherOption(
  focusMode: FocusMode,
  value: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  const config = options.config
  switch (focusMode) {
    case "model":
      if (isCursorHarness(config)) setCursorModel(config, value)
      else setCodexModel(config, value)
      break
    case "effort":
      setCodexReasoningEffort(config, value)
      break
    case "subagent-model":
      setCodexSubagentModel(config, value)
      syncStackSubagentAgentFiles(config)
      break
    case "subagent-effort":
      setCodexSubagentReasoningEffort(config, value)
      syncStackSubagentAgentFiles(config)
      break
    case "subagents":
      setCodexSubagentsEnabled(config, value === "on")
      break
    case "monitor":
      state.monitorSnapshot = setMonitorEnabled(config.stackDataRoot, options.session.id, value === "on")
      syncMonitorRightPanel(state)
      if (!isMonitorOn(state.monitorSnapshot)) state.rightPanelOpsVisible = true
      appendStackBlock(state.blocks, `monitor ${monitorOnOffLabel(state.monitorSnapshot)}`)
      break
    default:
      return
  }
  refresh()
}

function switcherCurrentValue(config: StackConfig, state: AppState, focusMode: FocusMode): string {
  if (focusMode === "model") return harnessModel(config)
  if (focusMode === "subagent-model") return config.codexSubagentModel
  if (focusMode === "subagent-effort") return config.codexSubagentReasoningEffort
  if (focusMode === "subagents") return config.codexSubagentsEnabled ? "on" : "off"
  if (focusMode === "monitor") return isMonitorOn(state.monitorSnapshot) ? "on" : "off"
  return config.codexReasoningEffort
}

function switcherOptions(config: StackConfig, focusMode: FocusMode): readonly string[] {
  if (focusMode === "model") {
    return isCursorHarness(config) ? CURSOR_MODEL_OPTIONS : CODEX_MODEL_OPTIONS
  }
  if (focusMode === "subagent-model") return CODEX_MODEL_OPTIONS
  if (focusMode === "subagents" || focusMode === "monitor") return ["on", "off"] as const
  return CODEX_REASONING_EFFORT_OPTIONS
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
    "j/k or [ ] change env. r refreshes remote checks. O opens hosted artifact for selected run.",
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

function workerHarnessForDisplay(config: StackConfig, state: AppState): WorkerHarnessSnapshot {
  if (state.gardenerChatRunning && state.workerHarnessSnapshot) {
    return state.workerHarnessSnapshot
  }
  return {
    codexModel: harnessModel(config),
    codexReasoningEffort: config.codexReasoningEffort,
  }
}

function buildSlashCommandContext(options: StackAppOptions, state: AppState): SlashCommandContext {
  const workerHarness = workerHarnessForDisplay(options.config, state)
  const objective =
    state.metaThreadManifest?.active_goal?.objective?.trim() ?? state.goalContext.objective?.trim()
  return {
    monitorEnabled: isMonitorOn(state.monitorSnapshot),
    monitorPanelOpen: state.rightPanelOpen,
    subagentsEnabled: options.config.codexSubagentsEnabled,
    showDetails: state.showDetails,
    railsVisible: state.railsVisible,
    agentViewEnabled: state.agentViewEnabled,
    environmentName: options.config.environmentName,
    model: workerHarness.codexModel,
    effort: workerHarness.codexReasoningEffort,
    goalObjective: objective,
    goalStatus: state.metaThreadManifest?.active_goal?.status ?? state.goalContext.status,
  }
}

function activeInputBuffer(state: AppState): string {
  if (goalWorkerChatFocused(state)) return state.inputBuffer
  if (state.focusMode === "gardener") return state.gardenerInputBuffer
  if (state.focusMode === "monitor") return state.monitorInputBuffer
  return state.inputBuffer
}

function setActiveInputBuffer(state: AppState, value: string): void {
  if (goalWorkerChatFocused(state)) state.inputBuffer = value
  else if (state.focusMode === "gardener") state.gardenerInputBuffer = value
  else if (state.focusMode === "monitor") state.monitorInputBuffer = value
  else state.inputBuffer = value
}

function goalWorkerChatFocused(state: AppState): boolean {
  return isGoalMode(state) && state.goalShutterWorkerPeek && state.focusMode === "agent"
}

function focusedInputEditing(state: AppState): boolean {
  if (goalWorkerChatFocused(state)) return true
  return activeInputBuffer(state).length > 0
}

function noteInputBufferEdit(state: AppState, previous: string, next: string): void {
  if (slashMenuQuery(previous) !== slashMenuQuery(next)) {
    state.slashMenuIndex = 0
  } else {
    state.slashMenuIndex = clampSlashMenuIndex(next, state.slashMenuIndex)
  }
}

function slashMenuElements(
  buffer: string,
  menuIndex: number,
  ctx: SlashCommandContext,
  columns: number,
  focused: boolean,
): ReturnType<typeof Text>[] {
  if (!focused || !slashMenuVisible(buffer)) return []
  return [
    Text({
      content: renderSlashCommandMenuStyled(buffer, menuIndex, ctx, columns),
      bg: theme.bgSubtle,
      width: "100%",
      flexShrink: 0,
    }),
  ]
}

function agentControlRow(
  options: StackAppOptions,
  state: AppState,
  columns: number,
  refresh: () => void,
): ReturnType<typeof Box> {
  const config = options.config
  const cursorHarness = isCursorHarness(config)
  const metaGoalLines = metaThreadGoalStripLines(state.metaThreadManifest, columns)
  const codexGoalLines = goalContextStripLines(state.goalContext, columns).filter((line) => {
    if (metaGoalLines.length === 0) return true
    const objective = state.metaThreadManifest?.active_goal?.objective?.trim()
    if (!objective) return true
    return !line.includes(objective.slice(0, Math.min(24, objective.length)))
  })
  const goalLines = [...metaGoalLines, ...codexGoalLines]
  const onGardenerSession = isGardenerSession(options, state)
  const workerHarness = workerHarnessForDisplay(config, state)
  const slashCtx = buildSlashCommandContext(options, state)
  return Box(
    {
      flexDirection: "column",
      gap: stackTuiLayout.panelGap,
    },
    ...(goalLines.length > 0
      ? [
          Box(
            {
              flexDirection: "column",
              width: "100%",
              alignItems: "flex-end",
              gap: 0,
            },
            ...goalLines.map((line, index) =>
              Text({
                content: line,
                fg: index === 0 ? theme.synth.amber : theme.fgPrimary,
              }),
            ),
          ),
        ]
      : []),
    Text({
      content: renderAgentInputStyled(options, state),
      bg: agentInputBackground(state),
      width: "100%",
    }),
    ...slashMenuElements(state.inputBuffer, state.slashMenuIndex, slashCtx, columns, state.focusMode === "agent"),
    ...(onGardenerSession
      ? [
          Box(
            {
              flexDirection: "row",
              gap: stackTuiLayout.panelGap,
              alignItems: "center",
            },
            controlLabel(agentRoleLabel("gardener")),
            focusControlChip(gardenerHarnessLabel(config.stackDataRoot), "model", state, refresh),
            ...(cursorHarness
              ? []
              : [
                  controlDivider(),
                  focusControlChip(loadGardenerConfig(config.stackDataRoot).model.reasoningEffort, "effort", state, refresh),
                ]),
            controlDivider(),
            focusControlChip(`env ${config.environmentName}`, "environment", state, refresh),
          ),
          Box(
            {
              flexDirection: "row",
              gap: stackTuiLayout.panelGap,
              alignItems: "center",
            },
            controlLabel(agentRoleLabel("monitor")),
            monitorControlChip(
              monitorOnOffLabel(state.monitorSnapshot),
              state.monitorSnapshot,
              false,
              () => toggleMonitorEnabled(options, state, refresh),
            ),
            controlDivider(),
            controlChip(
              state.rightPanelOpen ? "hide" : "show",
              state.rightPanelOpen,
              () => toggleMonitorPanelVisibility(options, state, refresh),
            ),
          ),
        ]
      : [
          Box(
            {
              flexDirection: "row",
              gap: stackTuiLayout.panelGap,
              alignItems: "center",
            },
            controlLabel(agentRoleLabel("worker")),
            focusControlChip(workerHarness.codexModel, "model", state, refresh),
            ...(cursorHarness
              ? []
              : [
                  controlDivider(),
                  focusControlChip(workerHarness.codexReasoningEffort, "effort", state, refresh),
                ]),
            controlDivider(),
            focusControlChip(`env ${config.environmentName}`, "environment", state, refresh),
          ),
          ...(cursorHarness
            ? []
            : [
                Box(
                  {
                    flexDirection: "row",
                    gap: stackTuiLayout.panelGap,
                    alignItems: "center",
                  },
                  controlLabel("subagents"),
                  focusControlChip(config.codexSubagentModel, "subagent-model", state, refresh),
                  controlDivider(),
                  focusControlChip(config.codexSubagentReasoningEffort, "subagent-effort", state, refresh),
                  controlDivider(),
                  focusControlChip(options.config.codexSubagentsEnabled ? "on" : "off", "subagents", state, refresh),
                ),
              ]),
          Box(
            {
              flexDirection: "row",
              gap: stackTuiLayout.panelGap,
              alignItems: "center",
            },
            controlLabel(agentRoleLabel("monitor")),
            monitorControlChip(
              monitorOnOffLabel(state.monitorSnapshot),
              state.monitorSnapshot,
              false,
              () => toggleMonitorEnabled(options, state, refresh),
            ),
            controlDivider(),
            controlChip(
              state.rightPanelOpen ? "hide" : "show",
              state.rightPanelOpen,
              () => toggleMonitorPanelVisibility(options, state, refresh),
            ),
          ),
        ]),
  )
}

function sessionLogPathLine(options: StackAppOptions, state: AppState, columns: number): string {
  const path =
    state.lastSessionLogPath ?? join(options.config.sessionLogDir, `${options.session.id}.json`)
  const suffix = state.lastSessionLogPath ? "" : " · after first turn"
  return oneLine(`session ${displayCwd(path)}${suffix}`, Math.max(24, columns - 2))
}

function controlLabel(content: string): ReturnType<typeof Text> {
  return Text({
    content,
    fg: theme.fgMuted,
    flexShrink: 0,
  })
}

/** Bottom-anchor transcript text so short turns sit above the input, not below a flex gap. */
function transcriptPane(content: StyledText, flexGrow = 1): ReturnType<typeof Box> {
  return anchorTranscriptBox(content, flexGrow)
}

function controlChip(content: string, active: boolean, onSelect?: () => void): ReturnType<typeof Text> {
  return Text({
    content,
    fg: active ? theme.fgOnAccent : theme.synth.amber,
    bg: active ? theme.bgChipActive : theme.bgSubtle,
    flexShrink: 0,
    ...(onSelect
      ? {
          onMouseDown(event: PanelMouseEvent) {
            event.preventDefault?.()
            event.stopPropagation?.()
            onSelect()
          },
        }
      : {}),
  })
}

function focusControlChip(
  content: string,
  focusMode: FocusMode,
  state: AppState,
  refresh: () => void,
): ReturnType<typeof Text> {
  return controlChip(content, state.focusMode === focusMode, () => {
    state.focusMode = focusMode
    refresh()
  })
}

function normalizeThreadGoalStatus(status: string | undefined): ThreadGoalStatus | undefined {
  switch (status?.trim().toLowerCase()) {
    case "paused":
      return "paused"
    case "blocked":
      return "blocked"
    case "done":
      return "done"
    case "cleared":
      return undefined
    default:
      return "active"
  }
}

async function refreshThreadGoalStatus(options: StackAppOptions, state: AppState): Promise<void> {
  const metaThreadIds = new Set(
    state.history.map((summary) => summary.metaThreadId).filter((id): id is string => Boolean(id)),
  )
  if (metaThreadIds.size === 0) {
    if (state.threadGoalStatus.size > 0) state.threadGoalStatus = new Map()
    return
  }
  const manifests = new Map(
    await Promise.all(
      [...metaThreadIds].map(
        async (metaThreadId) =>
          [metaThreadId, await readMetaThreadManifest(options.config.stackDataRoot, metaThreadId)] as const,
      ),
    ),
  )
  const next = new Map<string, ThreadGoalStatus>()
  for (const summary of state.history) {
    if (!summary.metaThreadId) continue
    const goal = manifests.get(summary.metaThreadId)?.active_goal
    if (!goal?.objective?.trim()) continue
    const status = normalizeThreadGoalStatus(goal.status)
    if (status) next.set(summary.id, status)
  }
  state.threadGoalStatus = next
}

function syncGoalModeDefaults(options: StackAppOptions, state: AppState): void {
  if (!isGoalMode(state)) {
    state.goalShutterWorkerPeek = false
    state.goalShutterScrollOffset = 0
    state.goalShutterScrollPinned = true
    state.goalMonitorAutoEnabledObjective = undefined
    return
  }
  const objective = activeGoalModeSnapshot(state).objective ?? ""
  if (state.goalMonitorAutoEnabledObjective !== objective) {
    if (!isMonitorOn(state.monitorSnapshot)) {
      state.monitorSnapshot = setMonitorEnabled(options.config.stackDataRoot, options.session.id, true)
      syncMonitorRightPanel(state)
    }
    state.goalMonitorAutoEnabledObjective = objective
  }
  if (
    !state.goalShutterWorkerPeek &&
    state.focusMode === "agent" &&
    state.inputBuffer.length === 0 &&
    state.monitorInputBuffer.length === 0
  ) {
    state.focusMode = "monitor"
    state.monitorWorkerTargetId = options.session.id
  }
}

function focusGoalSidecarChat(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  if (!isMonitorOn(state.monitorSnapshot)) {
    state.monitorSnapshot = setMonitorEnabled(options.config.stackDataRoot, options.session.id, true)
    syncMonitorRightPanel(state)
  }
  state.goalShutterWorkerPeek = false
  state.talkToMonitor = true
  state.monitorPanelMode = "chat"
  state.monitorWorkerTargetId = options.session.id
  state.focusMode = "monitor"
  refresh()
}

function focusGoalWorkerPeek(state: AppState, refresh: () => void): boolean {
  if (!isGoalMode(state)) return false
  state.goalShutterWorkerPeek = true
  state.talkToMonitor = false
  state.focusMode = "agent"
  refresh()
  return true
}

function returnToGoalShutter(state: AppState, refresh: () => void): boolean {
  if (!isGoalMode(state) || !state.goalShutterWorkerPeek) return false
  state.goalShutterWorkerPeek = false
  state.focusMode = "monitor"
  refresh()
  return true
}

function providerOptionChip(
  label: string,
  active: boolean,
  onSelect: () => void,
): ReturnType<typeof Text> {
  return Text({
    content: ` ${label} `,
    fg: active ? theme.fgOnAccent : theme.chipInactive,
    bg: active ? theme.bgChipActive : theme.bgSubtle,
    flexShrink: 0,
    onMouseDown(event: PanelMouseEvent) {
      event.preventDefault?.()
      event.stopPropagation?.()
      onSelect()
    },
  })
}

function providerSwitchHint(options: readonly string[], current: string, columns: number): string {
  const choices = options.map((option) => (option === current ? `[${option}]` : option)).join(" · ")
  return oneLine(`        click or j/k or enter · ${choices}`, Math.max(24, columns - 2))
}

function openMonitorPanel(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  if (!isMonitorOn(state.monitorSnapshot)) {
    state.monitorSnapshot = setMonitorEnabled(options.config.stackDataRoot, options.session.id, true)
  }
  state.rightPanelOpen = true
  state.rightPanelOpsVisible = false
  state.talkToMonitor = true
  state.monitorPanelMode = "chat"
  state.monitorWorkerTargetId = options.session.id
  state.focusMode = "monitor"
  refresh()
}

function toggleMonitorPanelVisibility(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  if (state.rightPanelOpen) {
    state.rightPanelOpen = false
    if (state.focusMode === "monitor") state.focusMode = "agent"
    refresh()
    return
  }
  openMonitorPanel(options, state, refresh)
}

function submitMonitorInputValue(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  hardSend = false,
): void {
  state.monitorInputBuffer = ""
  const trimmed = prompt.trim()
  if (!trimmed) {
    refresh()
    return
  }
  if (trimmed.toLowerCase() === "off" || trimmed === "/m off") {
    state.talkToMonitor = false
    appendStackBlock(state.blocks, "monitor talk mode off")
    refresh()
    return
  }
  state.talkToMonitor = true
  const dispatchRef = state.sidecarDispatchRef
  if (hardSend) {
    dispatchRef.current = dispatchRef.current
      .then(() =>
        executeSidecarOperatorMessage(trimmed, options, state, refresh, refreshHistory, refreshMetaEvents),
      )
      .catch((error) => {
        appendStackBlock(state.blocks, `sidecar message failed: ${errorMessage(error)}`)
        refresh()
      })
    refresh()
    scheduleSidecarIdleDrain(options, state, refresh, refreshHistory, refreshMetaEvents, dispatchRef)
    return
  }
  if (sidecarAgentActive(state)) {
    state.sidecarQueuedMessages = [...state.sidecarQueuedMessages, trimmed]
    refresh()
    return
  }
  dispatchRef.current = dispatchRef.current
    .then(() =>
      executeSidecarOperatorMessage(trimmed, options, state, refresh, refreshHistory, refreshMetaEvents),
    )
    .then(() => {
      scheduleSidecarIdleDrain(options, state, refresh, refreshHistory, refreshMetaEvents, dispatchRef)
    })
    .catch((error) => {
      appendStackBlock(state.blocks, `sidecar message failed: ${errorMessage(error)}`)
      refresh()
    })
  refresh()
}

function toggleMonitorEnabled(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  state.monitorSnapshot = setMonitorEnabled(
    options.config.stackDataRoot,
    options.session.id,
    !isMonitorOn(state.monitorSnapshot),
  )
  syncMonitorRightPanel(state)
  if (!isMonitorOn(state.monitorSnapshot)) state.rightPanelOpsVisible = true
  appendStackBlock(state.blocks, `monitor ${monitorOnOffLabel(state.monitorSnapshot)}`)
  refresh()
}

function monitorPanelModeBar(state: AppState, refresh: () => void): ReturnType<typeof Box> {
  const selectMode = (mode: MonitorPanelMode) => {
    state.monitorPanelMode = mode
    state.focusMode = "monitor"
    refresh()
  }
  return Box(
    {
      flexDirection: "row",
                          gap: stackTuiLayout.panelGap,
      alignItems: "center",
      width: "100%",
    },
    controlChip("chat", state.monitorPanelMode === "chat", () => selectMode("chat")),
    controlChip("events", state.monitorPanelMode === "events", () => selectMode("events")),
  )
}

function monitorControlRow(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  columns: number,
): ReturnType<typeof Box> {
  const slashCtx = buildSlashCommandContext(options, state)
  return Box(
    {
      flexDirection: "column",
      gap: stackTuiLayout.panelGap,
    },
    Text({
      content: renderMonitorInputStyled(state),
      bg: monitorInputBackground(state),
      width: "100%",
      ...monitorInputFocusHandlers(state, refresh),
    }),
    ...slashMenuElements(
      state.monitorInputBuffer,
      state.slashMenuIndex,
      slashCtx,
      columns,
      state.focusMode === "monitor",
    ),
  )
}

function openGardenerPanel(state: AppState, refresh: () => void): void {
  state.leftPanelOpen = true
  state.gardenerPanelMode = "chat"
  state.focusMode = "gardener"
  refresh()
}

async function submitGardenerInputValue(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  opts?: { source?: string },
): Promise<void> {
  state.gardenerInputBuffer = ""
  state.gardenerNotice = undefined
  const message = isExplicitGardenerPrefix(prompt) ? stripGardenerMessagePrefix(prompt) : prompt
  if (!message.trim()) {
    refresh()
    return
  }
  const intent = gardenerSubmitIntent(message)
  state.gardenerScrollPinned = true
  state.gardenerEventScrollPinned = true

  if (intent.mode === "skill_register") {
    const parsed = parseGardenerSkillRegisterIntent(intent.body)
    if (!parsed?.skillId) {
      state.gardenerNotice = formatSkillRegisterHelp()
      refresh()
      return
    }
    const result = await executeGardenerSkillRegister(
      options.config.stackDataRoot,
      gardenerThreadId(state),
      parsed,
    )
    state.gardenerNotice = result.ok
      ? `registered skill ${result.skill?.skill_id ?? parsed.skillId}`
      : `skill register failed: ${result.error ?? "unknown"}`
    refreshMetaEvents()
    refresh()
    return
  }

  if (intent.mode === "skill_suggest") {
    const parsed = parseGardenerSkillSuggestIntent(intent.body)
    if (!parsed?.skillId) {
      state.gardenerNotice = formatSkillSuggestHelp()
      refresh()
      return
    }
    const workerTargetId = resolveGardenerWorkerTargetId(options, state)
    if (!(await activateWorkerSessionForGardener(
      options,
      state,
      workerTargetId,
      codexSessionHandle,
      refresh,
      refreshHistory,
      refreshMetaEvents,
    ))) {
      state.gardenerNotice = "skill suggest failed: no worker thread"
      refresh()
      return
    }
    const result = executeGardenerSkillSuggest(
      options.config.stackDataRoot,
      gardenerThreadId(state),
      {
        workerThreadId: workerTargetId,
        skillId: parsed.skillId,
        reason: parsed.reason,
        workspaceRoot: options.config.workspaceRoot,
      },
    )
    if (!result.ok || !result.steerMessage) {
      state.gardenerNotice = `skill suggest failed: ${result.error ?? "unknown"}`
      refreshMetaEvents()
      refresh()
      return
    }
    const item = enqueueGardenerInbox(options.config.stackDataRoot, gardenerThreadId(state), result.steerMessage, {
      dispatchKind: "steer",
    })
    refreshMetaEvents()
    await routeGardenerInboxItems(
      [item],
      options,
      state,
      codexSessionHandle,
      renderer,
      refresh,
      refreshHistory,
      refreshMetaEvents,
    )
    state.gardenerNotice = `suggested skill ${parsed.skillId} → worker ${workerTargetId.slice(0, 8)}`
    refresh()
    return
  }

  if (intent.mode !== "chat") {
    if (!intent.body.trim()) {
      refresh()
      return
    }
    const item = enqueueGardenerInbox(options.config.stackDataRoot, gardenerThreadId(state), intent.body, {
      dispatchKind: intent.mode,
    })
    refreshMetaEvents()
    refresh()
    void refreshGardenerMaintenance(options, state, "inbox").then(() => refresh())
    await routeGardenerInboxItems(
      [item],
      options,
      state,
      codexSessionHandle,
      renderer,
      refresh,
      refreshHistory,
      refreshMetaEvents,
    )
    return
  }

  appendGardenerChatMessage(
    options.config.stackDataRoot,
    gardenerThreadId(state),
    "user",
    intent.body,
    opts?.source ? { source: opts.source } : undefined,
  )
  refreshMetaEvents()
  state.gardenerScrollPinned = true
  state.workerHarnessSnapshot = snapshotWorkerHarness(options.config)
  resetGardenerLiveTranscript(state)
  state.gardenerLiveThinking = "starting…"
  state.gardenerChatRunning = true
  refresh()
  const liveSink = createGardenerLiveSink(state, refresh)
  try {
    const response = await runGardenerChatTurn({
      config: options.config,
      gardenerThreadId: gardenerThreadId(state),
      userMessage: intent.body,
      workerSession: options.session,
      workerSummaries: state.history,
      workerTargetId: resolveGardenerWorkerTargetId(options, state),
      onOutput: liveSink.write,
    })
    liveSink.flush()
    if (response) {
      const targetThreadId = resolveGardenerWorkerTargetId(options, state)
      const named = await tryApplyThreadNameFromAgentResponse({
        stackRoot: options.config.stackDataRoot,
        sessionLogDir: options.config.sessionLogDir,
        threadId: targetThreadId,
        text: response,
        namedBy: "gardener",
        codexModel: options.config.codexModel,
        pricingRows: options.config.codexPricing,
      })
      if (named) {
        syncSessionDisplayName(options.session, targetThreadId, named)
        await refreshHistory()
      }
    }
    refreshMetaEvents()
    void refreshGardenerMaintenance(options, state, "inbox").then(() => refresh())
  } catch (error) {
    setGardenerNotice(state, `gardener failed: ${errorMessage(error)}`, refresh)
  } finally {
    state.gardenerChatRunning = false
    state.workerHarnessSnapshot = undefined
    resetGardenerLiveTranscript(state)
    refresh()
  }
}

function gardenerPanelModeBar(state: AppState, refresh: () => void): ReturnType<typeof Box> {
  const selectMode = (mode: GardenerPanelMode) => {
    state.gardenerPanelMode = mode
    state.focusMode = "gardener"
    refresh()
  }
  return Box(
    {
      flexDirection: "row",
                          gap: stackTuiLayout.panelGap,
      alignItems: "center",
      width: "100%",
      flexShrink: 0,
    },
    controlChip("chat", state.gardenerPanelMode === "chat", () => selectMode("chat")),
    controlChip("events", state.gardenerPanelMode === "events", () => selectMode("events")),
  )
}

function buildGardenerChatBlocks(state: AppState, events: StackThreadMetaEvent[]): TranscriptBlock[] {
  return mergeRoleChatBlocks(
    blocksFromGardenerChatEvents(events),
    state.gardenerChatRunning ? state.gardenerLiveBlocks : [],
  )
}

function gardenerControlRow(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  columns: number,
): ReturnType<typeof Box> {
  const voiceHint = gardenerVoiceHintLine(state)
  const slashCtx = buildSlashCommandContext(options, state)
  return Box(
    {
      flexDirection: "column",
      gap: stackTuiLayout.panelGap,
    },
    ...(voiceHint
      ? [
          Text({
            content: voiceHint,
            fg: state.voiceRecording
              ? theme.synth.gold
              : state.voiceTranscribing
                ? theme.synth.amber
                : state.gardenerNotice
                  ? theme.synth.amber
                  : theme.fgMuted,
            width: "100%",
          }),
        ]
      : []),
    Text({
      content: renderGardenerInputStyled(state),
      bg: gardenerInputBackground(state),
      width: "100%",
      ...gardenerInputFocusHandlers(state, refresh),
    }),
    ...slashMenuElements(
      state.gardenerInputBuffer,
      state.slashMenuIndex,
      slashCtx,
      columns,
      state.focusMode === "gardener",
    ),
  )
}

function gardenerInputBackground(state: AppState): string {
  if (state.focusMode === "gardener" || state.gardenerInputBuffer.length > 0) return theme.bgInputFocused
  return theme.bgPanel
}

function renderGardenerInputStyled(state: AppState): StyledText {
  const preview = state.gardenerInputBuffer.replace(/\n/g, " ↵ ")
  if (state.gardenerChatRunning) {
    const runningLine = `› ${runningSpinner(state)}`
    if (preview) {
      return new StyledText([
        fg(theme.synth.amber)(runningLine),
        fg(theme.fgMuted)(" · "),
        fg(theme.fgInput)(preview),
        fg(theme.synth.gold)("_"),
      ])
    }
    return new StyledText([fg(theme.synth.amber)(runningLine)])
  }
  if (!preview) {
    return new StyledText([fg(theme.synth.amber)("› "), dim(fg(theme.fgMuted)("Message gardener · /help"))])
  }
  return new StyledText([
    fg(theme.synth.amber)("› "),
    fg(theme.fgInput)(preview),
    fg(theme.synth.gold)("_"),
  ])
}

function leftGardenerPanelLayout(state: AppState): { width: `${number}%`; fraction: number } {
  return { width: LEFT_GARDENER_PANEL_WIDTH, fraction: LEFT_GARDENER_PANEL_COLUMNS_FRACTION }
}

function centerPanelColumns(renderer: CliRenderer): number {
  const panelChars = Math.floor(renderer.terminalWidth * CENTER_PANEL_COLUMNS_FRACTION)
  return Math.max(24, panelChars - 6)
}

function centerActiveProjectRows(renderer: CliRenderer): number {
  return Math.max(3, Math.min(5, Math.floor((renderer.terminalHeight - 8) * 0.14)))
}

function centerActiveThreadRows(renderer: CliRenderer): number {
  return Math.max(4, Math.min(7, Math.floor((renderer.terminalHeight - 8) * 0.18)))
}

function centerEventStreamRows(renderer: CliRenderer): number {
  const total = Math.max(12, renderer.terminalHeight - 8)
  return Math.max(6, total - centerActiveThreadRows(renderer) - centerActiveProjectRows(renderer) - 8)
}

function monitorPanelWidth(state: AppState): `${number}%` {
  if (state.railsVisible) return "32%"
  return MONITOR_PANEL_WIDTH
}

function monitorPanelColumns(renderer: CliRenderer, state: AppState): number {
  const fraction = state.railsVisible ? 0.32 : MONITOR_PANEL_COLUMNS_FRACTION
  return Math.max(24, Math.floor(renderer.terminalWidth * fraction) - 8)
}

function gardenerPanelColumns(renderer: CliRenderer, fraction = LEFT_GARDENER_PANEL_COLUMNS_FRACTION): number {
  const panelChars = Math.floor(renderer.terminalWidth * fraction)
  return Math.max(36, panelChars - 6)
}

function gardenerChatVisibleRows(renderer: CliRenderer, state: AppState): number {
  const total = gardenerThreadVisibleRows(renderer, state)
  let chrome = 4
  if (gardenerVoiceHintLine(state)) chrome += 1
  return Math.max(6, total - chrome)
}

function monitorControlChip(
  content: string,
  snapshot: StackMonitorSnapshot,
  active: boolean,
  onSelect?: () => void,
): ReturnType<typeof Text> {
  const enabled = isMonitorOn(snapshot)
  return Text({
    content,
    fg: active ? theme.fgOnAccent : enabled ? "#3fb950" : theme.synth.red,
    bg: active ? theme.bgChipActive : theme.bgSubtle,
    flexShrink: 0,
    ...(onSelect
      ? {
          onMouseDown(event: PanelMouseEvent) {
            event.preventDefault?.()
            event.stopPropagation?.()
            onSelect()
          },
        }
      : {}),
  })
}

function isMonitorOn(snapshot: StackMonitorSnapshot): boolean {
  return snapshot.enabled && snapshot.status !== "off" && snapshot.status !== "paused"
}

function monitorOnOffLabel(snapshot: StackMonitorSnapshot): string {
  return isMonitorOn(snapshot) ? "on" : "off"
}

function monitorStrictnessLabel(snapshot: StackMonitorSnapshot): string {
  if (!isMonitorOn(snapshot)) return "off"
  if (snapshot.strictness === "conservative") return "cons"
  if (snapshot.strictness === "aggressive") return "aggr"
  return snapshot.strictness
}

function monitorRuntimeLabel(value: string): string {
  if (value === "openai-responses" || value === "openai_responses") return "openai"
  if (value === "synth-aux" || value === "synth_aux") return "aux"
  if (value === "deterministic-runtime" || value === "deterministic") return "det"
  return value
}

function monitorEffortLabel(value: string): string {
  if (value === "medium") return "med"
  return value
}

function controlDivider(): ReturnType<typeof Text> {
  return Text({
    content: "│",
    fg: theme.fgDivider,
    bg: theme.bgSubtle,
    flexShrink: 0,
  })
}

function submitMonitorOperatorMessage(
  message: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<void> {
  appendStackBlock(state.blocks, `monitor ← ${oneLine(message, 72)}`)
  refresh()
  const threadId = resolveMonitorWorkerTargetId(options, state)
  void (async () => {
    const directName = await tryApplyThreadNameFromOperatorMessage({
      stackRoot: options.config.stackDataRoot,
      sessionLogDir: options.config.sessionLogDir,
      threadId,
      message,
      codexModel: options.config.codexModel,
      pricingRows: options.config.codexPricing,
    })
    if (directName) {
      syncSessionDisplayName(options.session, threadId, directName)
      await refreshHistory()
      refreshMetaEvents()
      refresh()
    }
  })()
  return runMonitorAfterOperatorMessage({
    config: options.config,
    session: options.session,
    message,
    agentContext: state.agentContext,
    goalContext: mergeMetaThreadGoalContext(state.goalContext, state.metaThreadManifest),
  })
    .then(async ({ snapshot }) => {
      state.monitorSnapshot = snapshot
      state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
      state.monitorScrollPinned = true
      state.monitorEventScrollPinned = true
      await refreshHistory()
      refreshMetaEvents()
      refresh()
    })
    .catch((error) => {
      appendStackBlock(state.blocks, `monitor message failed: ${errorMessage(error)}`)
      refresh()
    })
}

function scheduleSidecarIdleDrain(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  dispatchRef: { current: Promise<void> },
): void {
  dispatchRef.current = dispatchRef.current
    .then(async () => {
      while (state.sidecarQueuedMessages.length > 0 && !sidecarAgentActive(state)) {
        const next = state.sidecarQueuedMessages.shift()
        if (!next) break
        await executeSidecarOperatorMessage(next, options, state, refresh, refreshHistory, refreshMetaEvents)
      }
    })
    .catch((error) => {
      appendStackBlock(state.blocks, `sidecar queue failed: ${errorMessage(error)}`)
      refresh()
    })
}

async function executeSidecarOperatorMessage(
  message: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<void> {
  state.sidecarChatInFlight = true
  refresh()
  try {
    await submitMonitorOperatorMessage(message, options, state, refresh, refreshHistory, refreshMetaEvents)
  } finally {
    state.sidecarChatInFlight = false
    refresh()
    scheduleSidecarIdleDrain(
      options,
      state,
      refresh,
      refreshHistory,
      refreshMetaEvents,
      state.sidecarDispatchRef,
    )
  }
}

function submitGoalSlashIfNeeded(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  clearBuffers: () => void,
): boolean {
  const lines = splitSubmitLines(prompt)
  if (lines.length === 0) return false
  if (!lines.every(isGoalSlashCommand)) return false

  clearBuffers()
  const codexSession =
    codexSessionHandle.session instanceof CodexAppServerSession
      ? codexSessionHandle.session
      : undefined
  const ctx = { config: options.config, session: options.session }
  const feedback = (message: string) => appendStackBlock(state.blocks, message)

  void (async () => {
    let kickoffObjective: string | undefined
    for (const line of lines) {
      const args = line.slice("/goal".length).trim()
      if (!args) {
        state.focusMode = "goal"
        openGoalPanel(state)
        void refreshGoalPanelState(ctx, state, codexSessionHandle.session).finally(refresh)
        continue
      }
      const result = await runGoalSlashCommand(
        line,
        ctx,
        state,
        codexSession,
        codexSessionHandle.session,
        refresh,
        feedback,
      )
      if (result.workerKickoffObjective) {
        kickoffObjective = result.workerKickoffObjective
      }
    }
    if (kickoffObjective && !isGardenerSession(options, state)) {
      kickWorkerForGoalObjective(
        kickoffObjective,
        options,
        state,
        codexSessionHandle,
        renderer,
        refresh,
        refreshHistory,
        refreshMetaEvents,
      )
    }
  })()
  return true
}

function kickWorkerForGoalObjective(
  objective: string,
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): void {
  const payload =
    harnessGoalPayloadFromManifest(state.metaThreadManifest, "set") ??
    ({ action: "set", objective, status: "active" } as const)
  const kickoff = buildGoalWorkerKickoffPrompt({ ...payload, objective, action: "set" })
  const transcriptLabel = goalKickoffTranscriptLabel(objective)
  if (state.status === "running") {
    appendUserBlock(state.blocks, transcriptLabel)
    const codexSession = codexSessionHandle.session
    if (codexSession) {
      void codexSession.trySteer(kickoff).then((steered) => {
        if (steered) {
          state.lastSteerHint = "goal-steer"
          refresh()
          return
        }
        codexSession.enqueue(kickoff)
        state.queuedMessages = [...state.queuedMessages, kickoff]
        state.lastSteerHint = `queued (${state.queuedMessages.length})`
        refresh()
      })
    }
    return
  }
  focusGoalSidecarChat(options, state, refresh)
  void submitPrompt(
    kickoff,
    options,
    state,
    codexSessionHandle,
    renderer,
    refresh,
    refreshHistory,
    refreshMetaEvents,
    { transcriptPrompt: transcriptLabel },
  )
}

function handleGoalPanelKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  refresh: () => void,
): boolean {
  const feedback = (message: string) => appendStackBlock(state.blocks, message)
  if (key.name === "escape") {
    state.focusMode = "agent"
    refresh()
    return true
  }
  if (key.name === "j" || key.name === "down") {
    navigateGoalPanelSelection(state, "down")
    refresh()
    return true
  }
  if (key.name === "k" || key.name === "up") {
    navigateGoalPanelSelection(state, "up")
    refresh()
    return true
  }
  if (key.name === "space") {
    void runGoalPanelAction(
      "toggle",
      { config: options.config, session: options.session },
      state,
      codexSessionHandle.session,
      state.goalPanelSelectedIndex,
      feedback,
      refresh,
    )
    return true
  }
  if (key.name === "p") {
    void runGoalPanelAction(
      "pause",
      { config: options.config, session: options.session },
      state,
      codexSessionHandle.session,
      state.goalPanelSelectedIndex,
      feedback,
      refresh,
    )
    return true
  }
  if (key.name === "r") {
    void runGoalPanelAction(
      "resume",
      { config: options.config, session: options.session },
      state,
      codexSessionHandle.session,
      state.goalPanelSelectedIndex,
      feedback,
      refresh,
    )
    return true
  }
  if (key.name === "c") {
    void runGoalPanelAction(
      "clear",
      { config: options.config, session: options.session },
      state,
      codexSessionHandle.session,
      state.goalPanelSelectedIndex,
      feedback,
      refresh,
    )
    return true
  }
  return false
}

function buildSlashDispatchHooks(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  exit: () => void,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  cycleStackEnvironmentFromUi: (direction: number) => Promise<void>,
  refreshAfterEnvironmentChange: (environmentName: StackEnvironmentName) => Promise<void>,
): SlashDispatchHooks {
  return {
    exit,
    feedback: (message) => {
      appendStackBlock(state.blocks, message)
      refresh()
    },
    openGardener: () => openGardenerPanel(state, refresh),
    messageGardener: (message) => {
      void submitGardenerInputValue(
        message,
        options,
        state,
        codexSessionHandle,
        renderer,
        refresh,
        refreshHistory,
        refreshMetaEvents,
      )
    },
    openMonitor: () => {
      if (isGoalMode(state)) {
        focusGoalSidecarChat(options, state, refresh)
        return
      }
      openMonitorPanel(options, state, refresh)
    },
    hideMonitor: () => toggleMonitorPanelVisibility(options, state, refresh),
    setMonitorEnabled: (enabled) => {
      state.monitorSnapshot = setMonitorEnabled(options.config.stackDataRoot, options.session.id, enabled)
      syncMonitorRightPanel(state)
      if (!enabled) state.rightPanelOpsVisible = true
      appendStackBlock(state.blocks, `monitor ${monitorOnOffLabel(state.monitorSnapshot)}`)
      refresh()
    },
    messageMonitor: (message) => {
      void submitMonitorOperatorMessage(message, options, state, refresh, refreshHistory, refreshMetaEvents)
    },
    cycleEnvironment: (direction) => {
      void cycleStackEnvironmentFromUi(direction)
    },
    setEnvironment: (name) => {
      if (!STACK_ENVIRONMENT_OPTIONS.includes(name as StackEnvironmentName)) return false
      void refreshAfterEnvironmentChange(name as StackEnvironmentName)
      return true
    },
    openModelSwitcher: () => {
      state.focusMode = "model"
      refresh()
    },
    setModel: (name) => {
      const modelOptions = switcherOptions(options.config, "model")
      const needle = name.trim().toLowerCase()
      const match =
        modelOptions.find((option) => option.toLowerCase() === needle) ??
        modelOptions.find((option) => option.toLowerCase().includes(needle))
      if (!match) return false
      applySwitcherOption("model", match, options, state, refresh)
      appendStackBlock(state.blocks, `model ${match}`)
      return true
    },
    cycleEffort: () => {
      cycleEffort(options.config, 1)
      refresh()
    },
    setSubagents: (enabled) => {
      if (enabled === undefined) {
        setCodexSubagentsEnabled(options.config, !options.config.codexSubagentsEnabled)
      } else {
        setCodexSubagentsEnabled(options.config, enabled)
      }
      appendStackBlock(state.blocks, `subagents ${options.config.codexSubagentsEnabled ? "on" : "off"}`)
      refresh()
    },
    toggleDetails: () => {
      state.showDetails = !state.showDetails
      refresh()
    },
    toggleRails: () => {
      state.railsVisible = !state.railsVisible
      refresh()
    },
    toggleThreads: () => {
      toggleLeftPanelRails(state)
      refresh()
    },
    toggleActors: () => {
      if (isMonitorOn(state.monitorSnapshot)) {
        toggleRightPanelOps(state)
        refresh()
      }
    },
    focusAgent: () => {
      if (focusGoalWorkerPeek(state, refresh)) return
      state.focusMode = "agent"
      refresh()
    },
    toggleAgentView: () => {
      state.agentViewEnabled = !state.agentViewEnabled
      refresh()
    },
    clearInput: () => {
      state.inputBuffer = ""
      state.monitorInputBuffer = ""
      state.gardenerInputBuffer = ""
      state.slashMenuIndex = 0
      refresh()
    },
  }
}

function submitInputValue(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  forceQueue = false,
): void {
  if (!prompt) return
  state.inputBuffer = ""
  const codexSession = codexSessionHandle.session

  if (isExplicitMonitorPrefix(prompt)) {
    const message = stripMonitorMessagePrefix(prompt)
    if (message.toLowerCase() === "off") {
      state.talkToMonitor = false
      appendStackBlock(state.blocks, "monitor talk mode off")
      refresh()
      return
    }
    if (!message.trim()) {
      refresh()
      return
    }
    state.talkToMonitor = true
    void submitMonitorOperatorMessage(message, options, state, refresh, refreshHistory, refreshMetaEvents)
    return
  }

  if (state.talkToMonitor && !isGardenerSession(options, state) && !isExplicitGardenerPrefix(prompt)) {
    if (!prompt.trim()) {
      refresh()
      return
    }
    void submitMonitorOperatorMessage(prompt, options, state, refresh, refreshHistory, refreshMetaEvents)
    return
  }

  if (isExplicitGardenerPrefix(prompt) || (state.talkToGardener && !isGardenerSession(options, state))) {
    const message = isExplicitGardenerPrefix(prompt) ? stripGardenerMessagePrefix(prompt) : prompt
    if (!message.trim()) {
      refresh()
      return
    }
    void submitGardenerInputValue(
      message,
      options,
      state,
      codexSessionHandle,
      renderer,
      refresh,
      refreshHistory,
      refreshMetaEvents,
    )
    return
  }

  if (state.status === "running" && codexSession) {
    appendUserBlock(state.blocks, prompt)
    if (forceQueue) {
      codexSession.enqueue(prompt)
      state.queuedMessages = [...state.queuedMessages, prompt]
      state.lastSteerHint = `queued (${state.queuedMessages.length})`
      appendStackBlock(state.blocks, state.lastSteerHint)
      refresh()
      return
    }
    void codexSession.trySteer(prompt).then((steered) => {
      if (steered) {
        state.lastSteerHint = "steered"
        refresh()
        return
      }
      codexSession.enqueue(prompt)
      state.queuedMessages = [...state.queuedMessages, prompt]
      state.lastSteerHint = `queued (${state.queuedMessages.length})`
      appendStackBlock(state.blocks, state.lastSteerHint)
      refresh()
    })
    return
  }

  if (state.status === "running") return
  void submitPrompt(prompt, options, state, codexSessionHandle, renderer, refresh, refreshHistory, refreshMetaEvents)
}

function gardenerVoiceHintLine(state: AppState): string | undefined {
  if (state.gardenerNotice) return state.gardenerNotice
  if (state.voiceRecording || state.voiceTranscribing) {
    return voiceInputHintLine({
      status: state.voiceStatus,
      recording: Boolean(state.voiceRecording),
      transcribing: state.voiceTranscribing,
      gardenerChat: true,
    })
  }
  if (state.voiceStatus.health === "OFF" || state.voiceStatus.health === "BLOCKED") {
    return voiceInputHintLine({
      status: state.voiceStatus,
      recording: false,
      transcribing: false,
      gardenerChat: true,
    })
  }
  return undefined
}

function setGardenerNotice(state: AppState, message: string | undefined, refresh: () => void): void {
  state.gardenerNotice = message
  refresh()
}

function isVoiceKeyCandidate(key: { name?: string; shift?: boolean; ctrl?: boolean; meta?: boolean }): boolean {
  if (key.ctrl || key.meta) return false
  return (key.shift === true && key.name === "v") || key.name === "V"
}

function isVoiceKeyRelease(key: { name?: string; ctrl?: boolean; meta?: boolean }): boolean {
  if (key.ctrl || key.meta) return false
  const name = key.name?.toLowerCase()
  return name === "v"
}

type VoiceKeyContext = {
  options: StackAppOptions
  state: AppState
  codexSessionHandle: { session?: HarnessSession }
  renderer: CliRenderer
  refresh: () => void
  refreshHistory: () => Promise<void>
  refreshMetaEvents: () => void
}

function handleVoiceKey(key: StackKeyEvent, kind: "press" | "release", ctx: VoiceKeyContext): boolean {
  const gardenerVoice =
    ctx.state.focusMode === "gardener" ||
    (ctx.state.focusMode === "agent" && isGardenerSession(ctx.options, ctx.state))
  if (!gardenerVoice) return false

  if (kind === "release") {
    if (!isVoiceKeyRelease(key)) return false
    if (!ctx.state.voiceRecording || ctx.state.voiceFinishInFlight || ctx.state.voiceTranscribing) {
      return false
    }
    key.preventDefault?.()
    key.stopPropagation?.()
    const heldMs = voiceHoldElapsedMs(ctx.state.voiceRecordingStartedAt)
    if (heldMs < MIN_VOICE_HOLD_MS) {
      void cancelVoiceRecording(ctx.state, ctx.refresh, "hold Shift+V a bit longer")
      return true
    }
    void finishVoiceHoldToGardener(
      ctx.options,
      ctx.state,
      ctx.codexSessionHandle,
      ctx.renderer,
      ctx.refresh,
      ctx.refreshHistory,
      ctx.refreshMetaEvents,
    )
    return true
  }

  if (!isVoiceKeyCandidate(key)) return false
  key.preventDefault?.()
  key.stopPropagation?.()

  if (ctx.state.voiceRecording || ctx.state.voiceTranscribing || ctx.state.voiceFinishInFlight) {
    return true
  }
  startVoiceHoldToGardener(ctx.options, ctx.state, ctx.refresh)
  return true
}

function appendVoiceNotice(state: AppState, message: string, refresh: () => void): void {
  if (state.focusMode === "gardener") {
    setGardenerNotice(state, message, refresh)
    return
  }
  appendStackBlock(state.blocks, message)
  refresh()
}

async function cancelVoiceRecording(state: AppState, refresh: () => void, message?: string): Promise<void> {
  const recording = state.voiceRecording
  state.voiceRecording = undefined
  state.voiceRecordingStartedAt = undefined
  if (recording) {
    await recording.stop().catch(() => undefined)
  }
  if (message) {
    appendVoiceNotice(state, message, refresh)
    return
  }
  refresh()
}

function applyVoiceTranscriptToGardenerInput(
  state: AppState,
  text: string,
  provider: string,
  refresh: () => void,
): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    appendVoiceNotice(state, "voice: no speech detected", refresh)
    return false
  }
  if (isLikelyJunkVoiceTranscript(trimmed)) {
    appendVoiceNotice(state, "voice: ignored filler — try again", refresh)
    return false
  }
  state.gardenerInputBuffer = state.gardenerInputBuffer.trim()
    ? `${state.gardenerInputBuffer.trim()} ${trimmed}`
    : trimmed
  appendVoiceNotice(state, `voice ready · ${provider} · enter to send`, refresh)
  return true
}

function applyVoiceTranscriptToInput(state: AppState, text: string, provider: string, refresh: () => void): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    appendStackBlock(state.blocks, "voice: no speech detected")
    refresh()
    return false
  }
  if (isLikelyJunkVoiceTranscript(trimmed)) {
    appendStackBlock(state.blocks, "voice: ignored filler — try again")
    refresh()
    return false
  }
  state.inputBuffer = state.inputBuffer.trim() ? `${state.inputBuffer.trim()} ${trimmed}` : trimmed
  appendStackBlock(state.blocks, `voice → input · ${provider} · enter to send`)
  refresh()
  return true
}

function startVoiceHoldToGardener(options: StackAppOptions, state: AppState, refresh: () => void): void {
  if (state.voiceRecording || state.voiceTranscribing) return
  state.gardenerNotice = undefined
  state.voiceStatus = readVoiceStatus(options.config)
  if (state.voiceStatus.health === "OFF") {
    appendVoiceNotice(state, "voice disabled; enable voice in stack.config.json or STACK_VOICE_ENABLED=1", refresh)
    return
  }
  if (state.voiceStatus.health === "BLOCKED") {
    appendVoiceNotice(state, `voice blocked: ${state.voiceStatus.message}`, refresh)
    return
  }
  try {
    state.voiceRecording = startVoiceRecording(options.config.stackDataRoot)
    state.voiceRecordingStartedAt = state.voiceRecording.startedAt
  } catch (error) {
    appendVoiceNotice(state, `voice recording failed: ${errorMessage(error)}`, refresh)
  }
  refresh()
}

async function finishVoiceHoldToGardener(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<void> {
  const recording = state.voiceRecording
  if (!recording || state.voiceTranscribing || state.voiceFinishInFlight) return
  state.voiceFinishInFlight = true
  state.voiceRecording = undefined
  state.voiceRecordingStartedAt = undefined
  state.voiceTranscribing = true
  refresh()
  try {
    const captured = await recording.stop()
    if (captured.durationMs < MIN_VOICE_HOLD_MS) {
      appendVoiceNotice(state, "voice: too short — hold Shift+V longer", refresh)
      return
    }
    if (isGardenerSession(options, state) || state.focusMode === "gardener") {
      const transcription = await transcribeAudio(captured.audio, {
        mime: "audio/wav",
        language: options.config.voice.language,
        config: voiceSttConfigFromStack(options.config.voice),
      })
      state.voiceStatus = readVoiceStatus(options.config)
      applyVoiceTranscriptToGardenerInput(state, transcription.text, transcription.provider, refresh)
    }
  } catch (error) {
    appendVoiceNotice(state, `voice failed: ${errorMessage(error)}`, refresh)
  } finally {
    state.voiceTranscribing = false
    state.voiceFinishInFlight = false
    refresh()
  }
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

function handleRawAgentInput(
  sequence: string,
  state: AppState,
  activeSessionId: string,
  submit: () => boolean,
  refresh: () => void,
): boolean {
  if (state.focusMode !== "agent") return false
  return handleRawTextInputSequence({
    sequence,
    readBuffer: () => state.inputBuffer,
    writeBuffer: (next) => {
      noteInputBufferEdit(state, state.inputBuffer, next)
      state.inputBuffer = next
    },
    submit,
    refresh,
    deferSequence: (chunk) => chunk === "V" && activeSessionId === state.gardenerThreadId,
    blockWhileRunning: true,
    isRunning: state.status === "running",
  })
}

function handleRawMonitorInput(
  sequence: string,
  state: AppState,
  submit: () => boolean,
  refresh: () => void,
): boolean {
  if (state.focusMode !== "monitor") return false
  return handleRawTextInputSequence({
    sequence,
    readBuffer: () => state.monitorInputBuffer,
    writeBuffer: (next) => {
      noteInputBufferEdit(state, state.monitorInputBuffer, next)
      state.monitorInputBuffer = next
    },
    submit,
    refresh,
  })
}

function handleRawGardenerInput(
  sequence: string,
  state: AppState,
  submit: () => boolean,
  refresh: () => void,
): boolean {
  if (state.focusMode !== "gardener") return false
  return handleRawTextInputSequence({
    sequence,
    readBuffer: () => state.gardenerInputBuffer,
    writeBuffer: (next) => {
      noteInputBufferEdit(state, state.gardenerInputBuffer, next)
      state.gardenerInputBuffer = next
    },
    submit,
    refresh,
    deferSequence: (chunk) => chunk === "V",
  })
}

function appendPasteToFocusedBuffer(state: AppState, paste: string, refresh: () => void): void {
  if (state.focusMode === "goal") {
    state.focusMode = isGoalMode(state) ? "monitor" : "agent"
  } else if (
    state.focusMode !== "agent" &&
    state.focusMode !== "monitor" &&
    state.focusMode !== "gardener"
  ) {
    state.focusMode = "agent"
  }
  const previous = activeInputBuffer(state)
  const next = `${previous}${paste}`
  setActiveInputBuffer(state, next)
  noteInputBufferEdit(state, previous, next)
  refresh()
}

function handleRawInput(
  sequence: string,
  options: StackAppOptions,
  state: AppState,
  renderer: CliRenderer,
  submit: () => boolean,
  submitMonitor: () => boolean,
  submitGardener: () => boolean,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  codexSessionHandle: { session?: HarnessSession },
  refreshHarnessAccount: () => Promise<void>,
  refreshOptimizers: () => Promise<void>,
  refreshRemoteAccount: () => Promise<void>,
  refreshRemoteUsage: () => Promise<void>,
  refreshRemoteResearch: () => Promise<void>,
  refreshRemoteProjects: () => Promise<void>,
  refreshHostedOptimizers: () => Promise<void>,
  refreshRemoteOpsPanel: () => Promise<void>,
  cycleStackEnvironmentFromUi: (direction: number) => Promise<void>,
): boolean {
  const pasteResult = consumeBracketedPasteSequences(
    state.pasteAccumulator,
    sequence,
    (paste) => appendPasteToFocusedBuffer(state, paste, refresh),
    (chunk) =>
      handleRawInputInner(
        chunk,
        options,
        state,
        renderer,
        submit,
        submitMonitor,
        submitGardener,
        refresh,
        refreshHistory,
        refreshMetaEvents,
        codexSessionHandle,
        refreshHarnessAccount,
        refreshOptimizers,
        refreshRemoteAccount,
        refreshRemoteUsage,
        refreshRemoteResearch,
        refreshRemoteProjects,
        refreshHostedOptimizers,
        refreshRemoteOpsPanel,
        cycleStackEnvironmentFromUi,
      ),
  )
  state.pasteAccumulator = pasteResult.accumulator
  return pasteResult.handled
}

function handleRawInputInner(
  sequence: string,
  options: StackAppOptions,
  state: AppState,
  renderer: CliRenderer,
  submit: () => boolean,
  submitMonitor: () => boolean,
  submitGardener: () => boolean,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  codexSessionHandle: { session?: HarnessSession },
  refreshHarnessAccount: () => Promise<void>,
  refreshOptimizers: () => Promise<void>,
  refreshRemoteAccount: () => Promise<void>,
  refreshRemoteUsage: () => Promise<void>,
  refreshRemoteResearch: () => Promise<void>,
  refreshRemoteProjects: () => Promise<void>,
  refreshHostedOptimizers: () => Promise<void>,
  refreshRemoteOpsPanel: () => Promise<void>,
  cycleStackEnvironmentFromUi: (direction: number) => Promise<void>,
): boolean {
  if (sequence === "\x1b") {
    if (state.focusMode === "monitor" && state.monitorInputBuffer.length > 0) {
      state.monitorInputBuffer = ""
      state.slashMenuIndex = 0
      refresh()
      return true
    }
    if (state.focusMode === "gardener" && state.gardenerInputBuffer.length > 0) {
      state.gardenerInputBuffer = ""
      state.slashMenuIndex = 0
      refresh()
      return true
    }
    if (state.inputBuffer.length > 0) {
      state.inputBuffer = ""
      state.slashMenuIndex = 0
      refresh()
      return true
    }
    if (isGoalMode(state)) {
      if (returnToGoalShutter(state, refresh)) return true
      focusGoalWorkerPeek(state, refresh)
      return true
    }
    if (state.status === "running") {
      return true
    }
    return true
  }

  if (sequence === "\t") {
    const buffer = activeInputBuffer(state)
    const selected = selectedSlashCommandSpec(buffer, state.slashMenuIndex)
    if (selected?.command === "model" && slashMenuVisible(buffer)) {
      state.focusMode = "model"
      setActiveInputBuffer(state, "")
      state.slashMenuIndex = 0
      refresh()
      return true
    }
    if (selected?.command === "goal" && slashMenuVisible(buffer)) {
      state.focusMode = "goal"
      openGoalPanel(state)
      setActiveInputBuffer(state, "")
      state.slashMenuIndex = 0
      void refreshGoalPanelState(
        { config: options.config, session: options.session },
        state,
        codexSessionHandle.session,
      ).finally(refresh)
      return true
    }
    if (selected?.command === "monitor" && slashMenuVisible(buffer)) {
      setActiveInputBuffer(state, "")
      state.slashMenuIndex = 0
      if (isGoalMode(state)) {
        focusGoalSidecarChat(options, state, refresh)
      } else {
        openMonitorPanel(options, state, refresh)
      }
      return true
    }
    const completed = completeSlashMenuSelection(buffer, state.slashMenuIndex)
    if (completed !== null && slashMenuVisible(buffer)) {
      setActiveInputBuffer(state, completed)
      state.slashMenuIndex = 0
      refresh()
      return true
    }
    applySidePanelFocus(state, nextFocusMode(state.focusMode, state.liveOpsMode, options.config))
    refresh()
    return true
  }

  const keyName = rawSequenceKeyName(sequence)

  if (keyName === "up" || keyName === "down") {
    const buffer = activeInputBuffer(state)
    if (slashMenuVisible(buffer)) {
      state.slashMenuIndex = navigateSlashMenu(
        buffer,
        state.slashMenuIndex,
        keyName === "up" ? "up" : "down",
      )
      refresh()
      return true
    }
  }

  if (sequence === "b" && state.focusMode === "agent" && !focusedInputEditing(state)) {
    state.railsVisible = !state.railsVisible
    refresh()
    return true
  }

  if (sequence === "d" && state.focusMode === "agent" && !focusedInputEditing(state)) {
    state.showDetails = !state.showDetails
    refresh()
    return true
  }

  if (isGoalMode(state) && !focusedInputEditing(state)) {
    if (sequence === "m") {
      focusGoalSidecarChat(options, state, refresh)
      return true
    }
    if (sequence === "g") {
      state.goalShutterWorkerPeek = false
      state.focusMode = "goal"
      openGoalPanel(state)
      refresh()
      return true
    }
    if (sequence === "a") {
      state.agentViewEnabled = !state.agentViewEnabled
      refresh()
      return true
    }
  }

  if (state.focusMode === "agent" && !focusedInputEditing(state) && (sequence === "]" || sequence === "[")) {
    void cycleStackEnvironmentFromUi(sequence === "]" ? 1 : -1)
    return true
  }

  if (handleAgentScrollKey({ name: keyName }, state, renderer)) {
    refresh()
    return true
  }

  if (state.focusMode === "monitor" && handleMonitorScrollKey({ name: keyName }, state, renderer)) {
    refresh()
    return true
  }

  if (state.focusMode === "agent") {
    return handleRawAgentInput(sequence, state, options.session.id, submit, refresh)
  }

  if (state.focusMode === "monitor") {
    if (
      keyName &&
      handleMonitorKey(
        { name: keyName },
        options,
        state,
        codexSessionHandle,
        renderer,
        refresh,
        refreshHistory,
        refreshMetaEvents,
      )
    ) {
      return true
    }
    return handleRawMonitorInput(sequence, state, submitMonitor, refresh)
  }

  if (state.focusMode === "gardener") {
    // Shift+V often arrives as raw "V" — defer to parsed keypress/keyrelease for hold-to-talk.
    if (sequence === "V") {
      return false
    }
    if (
      !state.gardenerInputBuffer &&
      (sequence === "p" || sequence === "w" || sequence === "j" || sequence === "k" || sequence === "d" || sequence === "a")
    ) {
      return false
    }
    return handleRawGardenerInput(sequence, state, submitGardener, refresh)
  }

  if (!keyName) return false

  if (keyName === "x") {
    toggleLiveOpsMode(state)
    refresh()
    return true
  }

  if (state.focusMode === "projects") {
    handleProjectsFocusKey({ name: keyName }, state, refresh, refreshRemoteProjects)
    return true
  }

  if (state.focusMode === "history") {
    void handleHistoryKey(
      { name: keyName },
      options,
      state,
      refresh,
      refreshHistory,
      refreshRemoteAccount,
      refreshRemoteUsage,
      refreshMetaEvents,
      codexSessionHandle,
      refreshHarnessAccount,
      renderer,
      centerActiveThreadRows(renderer),
    )
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

  if (state.focusMode === "goal") {
    handleGoalPanelKey({ name: keyName }, options, state, codexSessionHandle, refresh)
    return true
  }

  if (state.focusMode === "effort") {
    handleEffortKey({ name: keyName }, options.config)
    refresh()
    return true
  }

  if (state.focusMode === "subagent-model") {
    handleSubagentModelKey({ name: keyName }, options.config)
    refresh()
    return true
  }

  if (state.focusMode === "subagent-effort") {
    handleSubagentEffortKey({ name: keyName }, options.config)
    refresh()
    return true
  }

  if (state.focusMode === "subagents") {
    handleSubagentsKey({ name: keyName }, options.config)
    refresh()
    return true
  }

  if (state.focusMode === "account") {
    void handleAccountKey({ name: keyName }, options, state, codexSessionHandle, refresh)
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

function isGardenerSession(options: StackAppOptions, state: AppState): boolean {
  return options.session.id === state.gardenerThreadId
}

function activeActorTarget(options: StackAppOptions, state: AppState): StackSessionAgentRole {
  if (isGardenerSession(options, state)) return "gardener"
  return "worker"
}

function gardenerThreadId(state: AppState): string {
  return state.gardenerThreadId
}

function rememberGardenerWorkerTarget(state: AppState, threadId: string): void {
  if (threadId !== state.gardenerThreadId) {
    state.gardenerWorkerTargetId = threadId
  }
}

function resolveGardenerWorkerTargetId(options: StackAppOptions, state: AppState): string {
  if (state.gardenerWorkerTargetId) {
    const match = state.history.find(
      (summary) => summary.id === state.gardenerWorkerTargetId && summary.id !== state.gardenerThreadId,
    )
    if (match) return match.id
  }
  const latestWorker = state.history.find((summary) => summary.id !== state.gardenerThreadId)
  return latestWorker?.id ?? options.session.id
}

function gardenerWorkerTargetSummary(
  options: StackAppOptions,
  state: AppState,
): StackSessionSummary | undefined {
  const targetId = resolveGardenerWorkerTargetId(options, state)
  return state.history.find((summary) => summary.id === targetId)
}

function gardenerWorkerTargetLabel(options: StackAppOptions, state: AppState): string | undefined {
  const summary = gardenerWorkerTargetSummary(options, state)
  if (!summary) return undefined
  const label = resolveThreadDisplayLabel(summary, { maxLength: 18 })
  return `${summary.id.slice(0, 8)} · ${label}`
}

function cycleGardenerWorkerTarget(state: AppState): void {
  const workers = state.history.filter((summary) => summary.id !== state.gardenerThreadId)
  if (workers.length === 0) return
  const currentId = state.gardenerWorkerTargetId
  const currentIndex = workers.findIndex((summary) => summary.id === currentId)
  const next = workers[(currentIndex + 1) % workers.length]
  state.gardenerWorkerTargetId = next.id
}

function resolveMonitorWorkerTargetId(options: StackAppOptions, state: AppState): string {
  if (state.monitorWorkerTargetId) {
    const match = state.history.find(
      (summary) => summary.id === state.monitorWorkerTargetId && summary.id !== state.gardenerThreadId,
    )
    if (match) return match.id
  }
  return options.session.id
}

function monitorWorkerTargetSummary(
  options: StackAppOptions,
  state: AppState,
): StackSessionSummary | undefined {
  const targetId = resolveMonitorWorkerTargetId(options, state)
  return state.history.find((summary) => summary.id === targetId)
}

function monitorWorkerTargetLabel(options: StackAppOptions, state: AppState): string {
  const summary = monitorWorkerTargetSummary(options, state)
  const targetId = resolveMonitorWorkerTargetId(options, state)
  const label = resolveThreadDisplayLabel(summary, { maxLength: 18, fallbackId: targetId })
  const live = targetId === options.session.id ? " · live" : ""
  return `${targetId.slice(0, 8)} · ${label}${live}`
}

function cycleMonitorWorkerTarget(state: AppState): void {
  const workers = state.history.filter((summary) => summary.id !== state.gardenerThreadId)
  if (workers.length === 0) return
  const currentId = state.monitorWorkerTargetId
  const currentIndex = workers.findIndex((summary) => summary.id === currentId)
  const next = workers[(Math.max(0, currentIndex) + 1) % workers.length]
  state.monitorWorkerTargetId = next.id
}

async function resumeMonitorWorkerTarget(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<void> {
  const targetId = resolveMonitorWorkerTargetId(options, state)
  if (targetId === options.session.id) return
  const index = state.history.findIndex((summary) => summary.id === targetId)
  if (index < 0) return
  state.selectedHistoryIndex = index
  await loadSelectedSession(options, state, codexSessionHandle, refresh, refreshHistory, refreshMetaEvents, "resume")
  state.monitorWorkerTargetId = options.session.id
  state.monitorSnapshot = refreshMonitorSnapshot(options.config.stackDataRoot, options.session.id)
  refresh()
}

function gardenerPassContext(options: StackAppOptions, state: AppState) {
  return {
    gardenerThreadId: state.gardenerThreadId,
    workerSummaries: state.history,
    workerTargetId: resolveGardenerWorkerTargetId(options, state),
  }
}

async function refreshGardenerMaintenance(
  options: StackAppOptions,
  state: AppState,
  wakeReason: "inbox" | "turn_completed" | "idle" | "manual",
): Promise<void> {
  const result = await runGardenerMaintenancePass({
    config: options.config,
    gardenerThreadId: state.gardenerThreadId,
    workerTargetId: resolveGardenerWorkerTargetId(options, state),
    workerSummaries: state.history,
    workerStatus: state.status,
    workerQueueCount: state.queuedMessages.length,
    goalContext: state.goalContext,
    codexAccountEmail: state.codexAccountEmail,
    wakeReason,
  })
  state.gardenerWorkspacePath = result.workspaceGardenPath
  if (result.gardenerGardenPath) state.gardenerGardenPath = result.gardenerGardenPath
}

function workerPanelThreadLabel(options: StackAppOptions, state: AppState): string {
  if (isGardenerSession(options, state)) return "gardener"
  const summary = state.history.find((entry) => entry.id === options.session.id)
  return resolveThreadDisplayLabel(summary, {
    maxLength: 28,
    fallbackId: options.session.id,
  })
}

function syncSessionDisplayName(session: StackLocalSession, threadId: string, displayName: string): void {
  if (session.id === threadId) session.displayName = displayName
}

function agentPanelTitle(options: StackAppOptions, state: AppState): string {
  return roleChatPanelTitle(workerPanelThreadLabel(options, state), activeActorTarget(options, state))
}

function agentPanelIdsText(options: StackAppOptions): string {
  const ids = [`thread:${options.session.id}`]
  if (options.session.metaThreadId) ids.push(`mt:${options.session.metaThreadId}`)
  return ids.join(" ")
}

function agentPanelIdsCopyIcon(
  renderer: CliRenderer,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): ReturnType<typeof Text> {
  return Text({
    content: "⧉",
    fg: theme.fgMuted,
    flexShrink: 0,
    onMouseDown(event: PanelMouseEvent) {
      event.preventDefault?.()
      event.stopPropagation?.()
      renderer.copyToClipboardOSC52(agentPanelIdsText(options))
      appendStackBlock(state.blocks, `copied · ${agentPanelIdsText(options)}`)
      refresh()
    },
  })
}

function gardenerPanelTitle(options: StackAppOptions, state: AppState): string {
  const summary = state.history.find((entry) => entry.id === state.gardenerThreadId)
  return roleChatPanelTitle(
    resolveThreadDisplayLabel(summary, {
      maxLength: 28,
      fallbackId: state.gardenerThreadId,
      isGardener: true,
    }),
    "gardener",
  )
}

function monitorPanelTitle(options: StackAppOptions, state: AppState): string {
  const targetId = resolveMonitorWorkerTargetId(options, state)
  const summary = monitorWorkerTargetSummary(options, state)
  return roleChatPanelTitle(
    resolveThreadDisplayLabel(summary, { maxLength: 28, fallbackId: targetId }),
    "monitor",
  )
}

function harnessAccountBudgetLabel(config: StackConfig, state: AppState): string {
  const authPlan = harnessAuthPlan(config)
  const budget = isCursorHarness(config)
    ? formatCursorBudgetSuffix(config.cursorAuthPlan, state.cursorAccount, config.cursorModel)
    : formatCodexBudgetSuffix(config.codexAuthPlan, state.codexRateLimits)
  return budget ? `${authPlan} · ${budget}` : authPlan
}

function globalConnectionBar(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  applyStackEnvironmentFromUi: (environmentName: StackEnvironmentName) => Promise<void>,
  codexSessionHandle: { session?: HarnessSession },
  columns: number,
  exitStack: () => void,
): ReturnType<typeof Box> {
  const config = options.config
  const environmentName = options.config.environmentName
  const connection = synthConnectionBadge(config, state)
  const accountSelected = state.focusMode === "account"
  const accountLabel = harnessAccountBudgetLabel(config, state)
  const cursorHarness = isCursorHarness(config)
  const authPlan = harnessAuthPlan(config)
  const accountEmail =
    state.codexAccountEmail &&
    (cursorHarness ? isCursorAuthPlan(authPlan) : isChatGptAuthPlan(authPlan))
      ? oneLine(state.codexAccountEmail, columns - 12)
      : undefined
  const selectProvider = (harness: StackHarnessKind) => {
    state.focusMode = "account"
    if (config.harness === harness) {
      refresh()
      return
    }
    void applyHarnessSwitch(options, state, codexSessionHandle, harness, refresh)
  }
  return Box(
    {
      flexDirection: "row",
      width: "100%",
      gap: stackTuiLayout.panelGap,
      flexShrink: 0,
      alignItems: "flex-start",
    },
    Box(
      {
        flexDirection: "column",
        flexGrow: 1,
        gap: 0,
      },
      Text({ content: connection.label, fg: connection.fg }),
      Text({
        content: accountLabel,
        fg: accountSelected ? theme.fgPrimary : theme.fgMuted,
        onMouseDown(event) {
          event.preventDefault?.()
          event.stopPropagation?.()
          state.focusMode = "account"
          refresh()
        },
      }),
      ...(accountSelected
        ? [
            Box(
              {
                flexDirection: "row",
                gap: stackTuiLayout.panelGap,
                alignItems: "center",
                flexWrap: "wrap",
              },
              ...HARNESS_PROVIDER_CHOICES.map(({ label, harness }) =>
                providerOptionChip(label, config.harness === harness, () => selectProvider(harness)),
              ),
            ),
            ...(accountEmail
              ? [
                  Text({
                    content: accountEmail,
                    fg: theme.fgMuted,
                  }),
                ]
              : []),
          ]
        : []),
    ),
    Box(
      {
        flexDirection: "column",
        gap: 0,
        flexShrink: 0,
        alignItems: "flex-end",
      },
      exitButtonChip(exitStack),
      Text({
        content: oneLine(`stack ${stackVersion(config.appRoot)}`, Math.max(18, Math.min(40, columns - 24))),
        fg: theme.fgMuted,
        flexShrink: 0,
      }),
      Box(
        {
          flexDirection: "row",
          gap: stackTuiLayout.panelGap,
          flexShrink: 0,
        },
        ...STACK_ENVIRONMENT_OPTIONS.map((name) =>
          environmentChip(name, name === environmentName, () => {
            if (name === environmentName) return
            void applyStackEnvironmentFromUi(name).then(refresh)
          }),
        ),
      ),
    ),
  )
}

function exitButtonChip(exitStack: () => void): ReturnType<typeof Text> {
  return Text({
    content: " exit ",
    fg: theme.fgOnAccent,
    bg: theme.synth.red,
    flexShrink: 0,
    onMouseDown(event: PanelMouseEvent) {
      event.preventDefault?.()
      event.stopPropagation?.()
      exitStack()
    },
  })
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
    return { label: `○ ${env} · add key`, fg: theme.synth.red }
  }
  if (snap.status === "invalid-auth") {
    return { label: `○ ${env} · bad key`, fg: theme.synth.red }
  }
  if (snap.status === "missing-auth") {
    return { label: `○ ${env} · add key`, fg: theme.synth.red }
  }
  if (snap.status === "offline") {
    return { label: `◐ ${env} · ${hint ?? "key"} offline`, fg: theme.synth.amber }
  }
  if (snap.status === "connected") {
    return { label: `● ${env} · ${hint ?? "key"}`, fg: theme.synth.gold }
  }
  return { label: `◐ ${env} · ${hint ?? "key"}`, fg: theme.synth.warmMuted }
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

function isLeftPanelFocused(state: AppState): boolean {
  if (state.focusMode === "gardener") return true
  if (state.focusMode === "history") return true
  return state.leftPanelMode === "bridge" && isLiveOpsFocus(state.focusMode)
}

function buildGardenerThreadContext(options: StackAppOptions, state: AppState): GardenerThreadContext {
  const threadId = gardenerThreadId(state)
  const inbox = readGardenerInbox(options.config.stackDataRoot, threadId)
  const targetSummary = gardenerWorkerTargetSummary(options, state)
  return {
    talkToGardener: state.talkToGardener,
    workerTargetLabel: gardenerWorkerTargetLabel(options, state),
    workerStatus: readWorkerSessionStatus(targetSummary, options.session.id, state.status),
    pendingInbox: inbox,
    selectedInboxIndex: state.gardenerInboxSelectedIndex,
  }
}

function gardenerThreadVisibleRows(renderer: CliRenderer, _state: AppState): number {
  return Math.max(12, renderer.terminalHeight - 10)
}

function tailGardenerThreadScroll(
  state: AppState,
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  visibleRows: number,
  options: TranscriptRenderOptions,
  running: boolean,
): void {
  const maxOffset = maxTranscriptScrollOffset(blocks, toolLogs, subagentLogs, columns, options, visibleRows)
  if (state.gardenerScrollPinned || running) state.gardenerScrollOffset = maxOffset
  else if (state.gardenerScrollOffset > maxOffset) state.gardenerScrollOffset = maxOffset
}

function tailCoreEventScroll(
  state: AppState,
  context: ReturnType<typeof resolveCoreEventStreamContext>,
  gardenerEvents: StackThreadMetaEvent[],
  workerEvents: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
): void {
  const eventCount = coreEventStreamLineCount(context, gardenerEvents, workerEvents, columns, state.agentViewEnabled)
  const eventMax = Math.max(0, eventCount - visibleRows)
  if (state.gardenerEventScrollPinned) state.gardenerEventScrollOffset = 0
  else if (state.gardenerEventScrollOffset > eventMax) state.gardenerEventScrollOffset = eventMax
}

function tailGoalShutterScroll(
  state: AppState,
  events: StackThreadMetaEvent[],
  columns: number,
  streamRows: number,
): void {
  const lineCount = goalShutterLineCount(events, columns, streamRows, state.agentViewEnabled)
  const maxOffset = Math.max(0, lineCount - streamRows)
  if (state.goalShutterScrollPinned) state.goalShutterScrollOffset = maxOffset
  else if (state.goalShutterScrollOffset > maxOffset) state.goalShutterScrollOffset = maxOffset
}

function handleGoalShutterMouseScroll(
  direction: "up" | "down",
  state: AppState,
  events: StackThreadMetaEvent[],
  columns: number,
  streamRows: number,
  refresh: () => void,
): void {
  const lineCount = goalShutterLineCount(events, columns, streamRows, state.agentViewEnabled)
  const maxOffset = Math.max(0, lineCount - streamRows)
  if (direction === "up") {
    state.goalShutterScrollOffset = Math.max(0, state.goalShutterScrollOffset - 3)
    state.goalShutterScrollPinned = state.goalShutterScrollOffset === 0
  } else {
    state.goalShutterScrollPinned = false
    state.goalShutterScrollOffset = Math.min(maxOffset, state.goalShutterScrollOffset + 3)
  }
  refresh()
}

function handleCoreEventScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  context: ReturnType<typeof resolveCoreEventStreamContext>,
  gardenerEvents: StackThreadMetaEvent[],
  workerEvents: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "harness"
  const direction = event.scroll?.direction
  if (direction !== "up" && direction !== "down") return
  const lineCount = coreEventStreamLineCount(context, gardenerEvents, workerEvents, columns, state.agentViewEnabled)
  const maxOffset = Math.max(0, lineCount - visibleRows)
  if (direction === "up") {
    state.gardenerEventScrollOffset = Math.max(0, state.gardenerEventScrollOffset - 3)
    state.gardenerEventScrollPinned = state.gardenerEventScrollOffset === 0
  } else {
    state.gardenerEventScrollPinned = false
    state.gardenerEventScrollOffset = Math.min(maxOffset, state.gardenerEventScrollOffset + 3)
  }
  refresh()
}

function handleHarnessEventScrollKey(
  key: StackKeyEvent,
  state: AppState,
  options: StackAppOptions,
  renderer: CliRenderer,
  refresh: () => void,
): void {
  if (key.name !== "j" && key.name !== "k" && key.name !== "up" && key.name !== "down") return
  const context = resolveCoreEventStreamContext(state)
  const gardenerEvents = readThreadMetaEvents(options.config.stackDataRoot, state.gardenerThreadId)
  const workerEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  const columns = centerPanelColumns(renderer)
  const visibleRows = centerEventStreamRows(renderer)
  const direction = key.name === "j" || key.name === "down" ? "down" : "up"
  const lineCount = coreEventStreamLineCount(context, gardenerEvents, workerEvents, columns, state.agentViewEnabled)
  const maxOffset = Math.max(0, lineCount - visibleRows)
  if (direction === "up") {
    state.gardenerEventScrollOffset = Math.max(0, state.gardenerEventScrollOffset - 1)
    state.gardenerEventScrollPinned = state.gardenerEventScrollOffset === 0
  } else {
    state.gardenerEventScrollPinned = false
    state.gardenerEventScrollOffset = Math.min(maxOffset, state.gardenerEventScrollOffset + 1)
  }
  refresh()
}

function handleCenterProjectsMouseScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  snapshot: RemoteProjectsPanelSnapshot,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "projects"
  const direction = event.scroll?.direction
  if (direction !== "up" && direction !== "down") return
  const count = snapshot.projects.length
  if (count <= 0) return
  if (direction === "up") {
    state.selectedProjectIndex = Math.max(0, state.selectedProjectIndex - 1)
  } else {
    state.selectedProjectIndex = Math.min(count - 1, state.selectedProjectIndex + 1)
  }
  refresh()
}

function handleProjectsFocusKey(
  key: StackKeyEvent,
  state: AppState,
  refresh: () => void,
  refreshRemoteProjects: () => Promise<void>,
): void {
  if (key.name === "r") {
    void refreshRemoteProjects().then(refresh)
    return
  }
  handleProjectsKey(key, state, refresh)
}

function handleProjectsKey(
  key: StackKeyEvent,
  state: AppState,
  refresh: () => void,
): void {
  if (key.name !== "j" && key.name !== "k" && key.name !== "up" && key.name !== "down") return
  const count = state.remoteProjectsSnapshot.projects.length
  if (count <= 0) return
  const direction = key.name === "j" || key.name === "down" ? "down" : "up"
  if (direction === "up") {
    state.selectedProjectIndex = Math.max(0, state.selectedProjectIndex - 1)
  } else {
    state.selectedProjectIndex = Math.min(count - 1, state.selectedProjectIndex + 1)
  }
  refresh()
}

function handleCenterThreadsMouseScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "history"
  handleThreadsMouseScroll(event, state, refresh)
}

function handleGardenerChatScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  blocks: readonly TranscriptBlock[],
  toolLogs: readonly ToolLog[],
  subagentLogs: readonly SubagentLog[],
  columns: number,
  visibleRows: number,
  options: TranscriptRenderOptions,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "gardener"
  const direction = event.scroll?.direction
  if (direction !== "up" && direction !== "down") return
  const maxOffset = maxTranscriptScrollOffset(blocks, toolLogs, subagentLogs, columns, options, visibleRows)
  if (direction === "up") {
    state.gardenerScrollPinned = false
    state.gardenerScrollOffset = Math.max(0, state.gardenerScrollOffset - 3)
  } else {
    state.gardenerScrollOffset = Math.min(maxOffset, state.gardenerScrollOffset + 3)
    if (state.gardenerScrollOffset >= maxOffset) state.gardenerScrollPinned = true
  }
  refresh()
}

function handleMonitorChatScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  blocks: readonly TranscriptBlock[],
  columns: number,
  visibleRows: number,
  options: TranscriptRenderOptions,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "monitor"
  const direction = event.scroll?.direction
  if (direction !== "up" && direction !== "down") return
  const maxOffset = maxTranscriptScrollOffset(blocks, [], [], columns, options, visibleRows)
  if (direction === "up") {
    state.monitorScrollPinned = false
    state.monitorScrollOffset = Math.max(0, state.monitorScrollOffset - 3)
  } else {
    state.monitorScrollOffset = Math.min(maxOffset, state.monitorScrollOffset + 3)
    if (state.monitorScrollOffset >= maxOffset) state.monitorScrollPinned = true
  }
  refresh()
}

function handleGardenerNarrativeScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  events: StackThreadMetaEvent[],
  context: GardenerThreadContext,
  columns: number,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "gardener"
  scrollGardenerPane(event.scroll?.direction, state, events, context, columns, visibleRows, "narrative", refresh)
}

function handleGardenerEventScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  events: StackThreadMetaEvent[],
  context: GardenerThreadContext,
  columns: number,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "gardener"
  scrollGardenerPane(event.scroll?.direction, state, events, context, columns, visibleRows, "events", refresh)
}

function scrollGardenerPane(
  direction: string | undefined,
  state: AppState,
  events: StackThreadMetaEvent[],
  context: GardenerThreadContext,
  columns: number,
  visibleRows: number,
  pane: "narrative" | "events",
  refresh: () => void,
): void {
  if (direction !== "up" && direction !== "down") return
  if (pane === "narrative") {
    const blocks = buildGardenerChatBlocks(state, events)
    const options = gardenerTranscriptRenderOptions(
      transcriptRenderOptions(state),
      state.gardenerChatRunning,
      state.gardenerLiveThinking,
    )
    const maxOffset = maxTranscriptScrollOffset(
      blocks,
      state.gardenerLiveTools,
      state.gardenerLiveSubagents,
      columns,
      options,
      visibleRows,
    )
    if (direction === "up") {
      state.gardenerScrollPinned = false
      state.gardenerScrollOffset = Math.max(0, state.gardenerScrollOffset - 3)
    } else {
      state.gardenerScrollOffset = Math.min(maxOffset, state.gardenerScrollOffset + 3)
      if (state.gardenerScrollOffset >= maxOffset) state.gardenerScrollPinned = true
    }
  } else {
    const lineCount = gardenerEventStreamLineCount(events, columns)
    const maxOffset = Math.max(0, lineCount - visibleRows)
    if (direction === "up") {
      state.gardenerEventScrollPinned = false
      state.gardenerEventScrollOffset = Math.max(0, state.gardenerEventScrollOffset - 3)
    } else {
      state.gardenerEventScrollOffset = Math.min(maxOffset, state.gardenerEventScrollOffset + 3)
      if (state.gardenerEventScrollOffset >= maxOffset) state.gardenerEventScrollPinned = true
    }
  }
  refresh()
}

function buildGardenerPanelInput(options: StackAppOptions, state: AppState) {
  const threadId = gardenerThreadId(state)
  const inbox = readGardenerInbox(options.config.stackDataRoot, threadId)
  const targetSummary = gardenerWorkerTargetSummary(options, state)
  return {
    stackRoot: options.config.stackDataRoot,
    threadId,
    workerStatus: state.status,
    talkToGardener: state.talkToGardener,
    inbox,
    selectedIndex: state.gardenerInboxSelectedIndex,
    workerQueueCount: state.queuedMessages.length,
    workerTargetLabel: gardenerWorkerTargetLabel(options, state),
    workerTargetStatus: readWorkerSessionStatus(targetSummary, options.session.id, state.status),
    lastGardenRewrite: lastGardenRewriteAt(options.config.stackDataRoot, threadId),
    authSwapHint: gardenerAuthSwapHint(options.config.stackDataRoot),
    workspaceGardenPath: state.gardenerWorkspacePath ?? gardenerWorkspaceDocPath(options.config.stackDataRoot),
    gardenPath: state.gardenerGardenPath,
  }
}

function buildLeftPanelRenderInput(
  options: StackAppOptions,
  state: AppState,
  visibleRows: number,
  bridgeText: string,
) {
  return {
    mode: state.leftPanelMode,
    threadsInput: buildThreadsRailInput(options, state, visibleRows),
    account: state.remoteAccountSnapshot,
    usage: state.remoteUsageSnapshot,
    agentUsage: buildOpsPanelAgentUsage(options, state),
    environmentName: options.config.environmentName,
    bridgeText,
    codexAuthHistory: codexAuthLedgerSummaryLines(options.config.stackDataRoot),
    gardener: buildGardenerPanelInput(options, state),
    focused: isLeftPanelFocused(state),
    scrollOffset: state.leftPanelScrollOffset,
    visibleRows,
  }
}

function handleLeftPanelMouseScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  options: StackAppOptions,
  state: AppState,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  const direction = event.scroll?.direction
  if (direction !== "up" && direction !== "down") return
  if (state.leftPanelMode === "threads") {
    handleThreadsMouseScroll(event, state, refresh)
    return
  }
  scrollLeftPanel(
    options,
    state,
    visibleRows,
    direction,
  )
  refresh()
}

function scrollLeftPanel(
  options: StackAppOptions,
  state: AppState,
  visibleRows: number,
  direction: "up" | "down",
): void {
  const bridgeText = liveOperationsRailText(options, state)
  const lineCount = leftPanelLineCount({
    mode: state.leftPanelMode,
    threadsInput: buildThreadsRailInput(options, state, visibleRows),
    account: state.remoteAccountSnapshot,
    usage: state.remoteUsageSnapshot,
    agentUsage: buildOpsPanelAgentUsage(options, state),
    environmentName: options.config.environmentName,
    bridgeText,
    codexAuthHistory: codexAuthLedgerSummaryLines(options.config.stackDataRoot),
    gardener: buildGardenerPanelInput(options, state),
  })
  const maxOffset = Math.max(0, lineCount - visibleRows)
  if (direction === "up") {
    state.leftPanelScrollOffset = Math.max(0, state.leftPanelScrollOffset - 3)
  } else {
    state.leftPanelScrollOffset = Math.min(maxOffset, state.leftPanelScrollOffset + 3)
  }
}

function buildThreadsRailInput(options: StackAppOptions, state: AppState, visibleRows: number) {
  const registered = gardenerThreadId(state)
  const gardenerThreadIds = new Set([registered])
  const gardenerInboxCount = readGardenerInbox(options.config.stackDataRoot, registered).length
  return {
    focusMode: state.focusMode,
    history: state.history,
    selectedHistoryIndex: state.selectedHistoryIndex,
    currentSessionId: options.session.id,
    visibleRows,
    columns: state.threadsRailColumns,
    liveTokensPerSecond: formatAverageTokensPerSecond(displayTokensPerSecond(state)),
    gardenerThreadIds,
    gardenerInboxCount,
    gardenerTalkMode: state.talkToGardener,
    usageForSummary: (summary: StackSessionSummary) => threadUsageSummary(options, summary),
  }
}

function opsVisibleRows(renderer: CliRenderer, state: AppState): number {
  if (isMonitorOn(state.monitorSnapshot) && !state.rightPanelOpsVisible) return 0
  const footerLines = rightContextFooterLineCount(renderer, state)
  if (state.railsVisible) {
    return Math.max(6, Math.floor(renderer.terminalHeight * 0.28) - footerLines)
  }
  return Math.max(6, renderer.terminalHeight - 12 - footerLines)
}

function monitorThreadVisibleRows(renderer: CliRenderer, state: AppState): number {
  if (!isMonitorOn(state.monitorSnapshot)) return 0
  const chromeLines = 8
  const total = Math.max(14, renderer.terminalHeight - 10)
  const opsBlock = state.rightPanelOpsVisible ? Math.max(8, Math.floor(total * 0.32)) + 3 : 0
  return Math.max(10, total - opsBlock - chromeLines)
}

function rightContextFooterLineCount(renderer: CliRenderer, state: AppState): number {
  if (isMonitorOn(state.monitorSnapshot) && !state.rightPanelOpsVisible) return 0
  const columns = rightContextColumns(renderer, state)
  const monitorRail = isMonitorOn(state.monitorSnapshot)
    ? 0
    : monitorRailLines(state.monitorSnapshot, columns).length
  return agentContextRailLineCount(state.agentContext) + monitorRail
}

function monitorWorkerActive(state: AppState): boolean {
  if (state.status === "running") return true
  return state.blocks.some(
    (block) =>
      (block.kind === "thinking" && (block.live || (block.text && block.text !== "…"))) ||
      block.kind === "tool" ||
      block.kind === "tool_group",
  )
}

// The goal-mode "chat" tab already mirrors the live worker transcript in the
// main panel; showing the monitor panel's own live-watch mirror at the same
// time duplicates the exact same content on screen twice.
function monitorWatchSuppressedByGoalChat(state: AppState): boolean {
  return isGoalMode(state) && state.goalShutterWorkerPeek
}

function monitorChatRowSplit(
  monitorRows: number,
  workerActive: boolean,
): { narrativeRows: number; watchRows: number } {
  if (!workerActive || monitorRows < 10) {
    return { narrativeRows: monitorRows, watchRows: 0 }
  }
  const narrativeRows = Math.max(3, Math.min(6, Math.floor(monitorRows * 0.22)))
  return { narrativeRows, watchRows: Math.max(4, monitorRows - narrativeRows) }
}

function tailMonitorWatchScroll(state: AppState, columns: number, visibleRows: number): void {
  if (visibleRows <= 0) return
  const maxOffset = maxTranscriptScrollOffset(
    state.blocks,
    state.toolLogs,
    state.subagentLogs,
    columns,
    transcriptRenderOptions(state),
    visibleRows,
  )
  if (state.monitorWatchScrollPinned) state.monitorWatchScrollOffset = maxOffset
  else if (state.monitorWatchScrollOffset > maxOffset) state.monitorWatchScrollOffset = maxOffset
}

function tailMonitorThreadScroll(
  state: AppState,
  blocks: readonly TranscriptBlock[],
  columns: number,
  visibleRows: number,
  options: TranscriptRenderOptions,
): void {
  const maxOffset = maxTranscriptScrollOffset(blocks, [], [], columns, options, visibleRows)
  if (state.monitorScrollPinned) state.monitorScrollOffset = maxOffset
  else if (state.monitorScrollOffset > maxOffset) state.monitorScrollOffset = maxOffset
}

function handleMonitorWatchScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  columns: number,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "monitor"
  const direction = event.scroll?.direction
  if (direction !== "up" && direction !== "down") return
  const maxOffset = maxTranscriptScrollOffset(
    state.blocks,
    state.toolLogs,
    state.subagentLogs,
    columns,
    transcriptRenderOptions(state),
    visibleRows,
  )
  if (direction === "up") {
    state.monitorWatchScrollPinned = false
    state.monitorWatchScrollOffset = Math.max(0, state.monitorWatchScrollOffset - 3)
  } else {
    state.monitorWatchScrollOffset = Math.min(maxOffset, state.monitorWatchScrollOffset + 3)
    if (state.monitorWatchScrollOffset >= maxOffset) state.monitorWatchScrollPinned = true
  }
  refresh()
}

function handleMonitorNarrativeScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  columns: number,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "monitor"
  scrollMonitorPane(
    event.scroll?.direction,
    state,
    columns,
    visibleRows,
    "narrative",
    refresh,
  )
}

function handleMonitorEventScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  columns: number,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  state.focusMode = "monitor"
  scrollMonitorPane(event.scroll?.direction, state, columns, visibleRows, "events", refresh)
}

function scrollMonitorPane(
  direction: string | undefined,
  state: AppState,
  columns: number,
  visibleRows: number,
  pane: "narrative" | "events",
  refresh: () => void,
): void {
  if (direction !== "up" && direction !== "down") return
  if (pane === "narrative") {
    const blocks = blocksFromMonitorChatEvents(state.metaEvents)
    const options = monitorTranscriptRenderOptions(transcriptRenderOptions(state), state.monitorSnapshot)
    const maxOffset = maxTranscriptScrollOffset(blocks, [], [], columns, options, visibleRows)
    if (direction === "up") {
      state.monitorScrollPinned = false
      state.monitorScrollOffset = Math.max(0, state.monitorScrollOffset - 3)
    } else {
      state.monitorScrollOffset = Math.min(maxOffset, state.monitorScrollOffset + 3)
      if (state.monitorScrollOffset >= maxOffset) state.monitorScrollPinned = true
    }
  } else {
    const lineCount = monitorEventStreamLineCount(state.metaEvents, columns)
    const maxOffset = Math.max(0, lineCount - visibleRows)
    if (direction === "up") {
      state.monitorEventScrollPinned = false
      state.monitorEventScrollOffset = Math.max(0, state.monitorEventScrollOffset - 3)
    } else {
      state.monitorEventScrollOffset = Math.min(maxOffset, state.monitorEventScrollOffset + 3)
      if (state.monitorEventScrollOffset >= maxOffset) state.monitorEventScrollPinned = true
    }
  }
  refresh()
}

function rightContextColumns(renderer: CliRenderer, state: AppState): number {
  const monitorBoost = isMonitorOn(state.monitorSnapshot) && state.rightPanelOpen
  const widthShare = state.rightPanelOpen
    ? state.railsVisible
      ? monitorBoost
        ? 0.4
        : 0.3
      : monitorBoost
        ? 0.36
        : 0.26
    : 0.72
  const maxColumns = monitorBoost ? 96 : 48
  return Math.max(24, Math.min(maxColumns, Math.floor(renderer.terminalWidth * widthShare) - 8))
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
  state.rightPanelMode =
    state.rightPanelMode === "actors" ? "local" : state.rightPanelMode === "local" ? "hosted" : "actors"
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
    toggleRightPanelOps(state)
    refresh()
    return
  }
  if (key.name === "a") {
    state.rightPanelMode = "actors"
    state.opsScrollOffset = 0
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
    state.rightPanelMode === "actors"
  ) {
    if (isCursorHarness(options.config)) {
      appendStackBlock(state.blocks, "subagents are not available on the Cursor harness")
      refresh()
      return
    }
    if (!options.config.codexArgsLocked) {
      setCodexSubagentsEnabled(options.config, !options.config.codexSubagentsEnabled)
      state.harnessCommand = options.config.codexCommand
      appendStackBlock(
        state.blocks,
        `subagents ${options.config.codexSubagentsEnabled ? "on" : "off"} for next Codex launch`,
      )
    } else {
      appendStackBlock(state.blocks, "subagents locked by STACK_CODEX_ARGS")
    }
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

function threadsVisibleRows(renderer: CliRenderer, _state: AppState): number {
  return centerActiveThreadRows(renderer)
}

function updateThreadsRailColumns(renderer: CliRenderer, state: AppState): void {
  state.threadsRailColumns = Math.max(24, Math.floor(renderer.terminalWidth * 0.24) - 4)
}

async function loadThreadHistory(
  config: StackConfig,
  session?: StackLocalSession,
): Promise<StackSessionSummary[]> {
  let history = await listSessionHistoryFromDirs(sessionHistoryScanDirs(config), config.codexPricing)
  try {
    history = mergeSessionSummaries([
      ...history,
      ...(await stackdThreads()).map(stackdThreadToSessionSummary),
    ])
  } catch {
    // stackd unavailable — local session dirs are authoritative
  }
  if (session) {
    history = ensureSessionInHistory(
      history,
      session,
      config.sessionLogDir,
      harnessModel(config),
      config.codexPricing,
    )
  }
  return history
}

function stackdThreadToSessionSummary(thread: StackdThreadSummary): StackSessionSummary {
  return {
    id: thread.id,
    path: thread.path,
    startedAt: thread.startedAt,
    updatedAt: thread.updatedAt,
    turnCount: thread.turnCount,
    lastPrompt: thread.lastPrompt,
    usageSummary: isSessionUsageSummary(thread.usageSummary) ? thread.usageSummary : undefined,
  }
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

function isSessionUsageSummary(value: unknown): value is StackSessionUsageSummary {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.model === "string" && record.totals !== null && typeof record.totals === "object"
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

function footerHint(_config: StackConfig, _state: AppState, _sessionId: string): string {
  return "/exit quit"
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
  const config = options.config
  const sessionUsage = buildSessionUsageSummary(
    options.session.turns,
    harnessModel(config),
    config.codexPricing,
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
    codexAuthPlan: harnessAuthPlan(config),
    codexEmail: state.codexAccountEmail,
    sessionSummary,
    codexBudget: isCursorHarness(config)
      ? formatCursorBudgetSuffix(config.cursorAuthPlan, state.cursorAccount, config.cursorModel)
      : formatCodexBudgetSuffix(config.codexAuthPlan, state.codexRateLimits),
  }
}

function buildOpsPanelInput(options: StackAppOptions, state: AppState) {
  state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
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
    actors: {
      primaryModel: harnessModel(options.config),
      primaryStatus: state.status,
      turnCount: options.session.turns.length + (state.status === "running" ? 1 : 0),
      currentTurnStartedAt: state.currentTurnStartedAt,
      cursorHarness: isCursorHarness(options.config),
      codexSubagentsEnabled: options.config.codexSubagentsEnabled,
      codexSubagentModel: options.config.codexSubagentModel,
      codexSubagentReasoningEffort: options.config.codexSubagentReasoningEffort,
      codexArgsLocked: options.config.codexArgsLocked,
      codexArgs: options.config.codexArgs,
      subagents: state.subagentLogs,
    },
    metaEvents: visualMetaEvents(state.metaEvents),
    focus: {
      focusMode: state.focusMode,
      selectedHostedOptimizerRunIndex: state.selectedHostedOptimizerRunIndex,
      selectedOptimizerRunIndex: state.selectedOptimizerRunIndex,
    },
  }
}

function visualMetaEvents(events: StackThreadMetaEvent[]): OpsPanelMetaEvent[] {
  return events
    .filter((event) =>
      event.type === "skill.read" ||
      event.type === "guidance.query" ||
      event.type === "guidance.read" ||
      event.type === "guidance.used" ||
      event.type === "guidance.impact_judged" ||
      event.type === "monitor.skill_context_push" ||
      event.type === "gardener.skill_suggest" ||
      event.type === "monitor.summary" ||
      event.type === "monitor.wake" ||
      isSkillFileReadMetaEvent(event),
    )
    .slice(-20)
}

function isSkillFileReadMetaEvent(event: StackThreadMetaEvent): boolean {
  if (event.type !== "agent.tool.completed") return false
  const command = event.payload.command
  if (typeof command !== "string") return false
  return /\/skills\/([^/"'\s]+)\/SKILL\.md/.test(command)
}

function transcriptRenderOptions(state: AppState): TranscriptRenderOptions {
  return {
    expandedBlockIds: state.expandedBlockIds,
    showDetails: state.showDetails,
    liveThinkingText: state.liveThinkingText,
    running: state.status === "running",
    spinnerFrame: state.spinnerFrame,
    harnessCommand: state.harnessCommand,
    showAgentSpeakerLabel: state.showDetails,
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

function agentInputBackground(state: AppState): string {
  if (state.focusMode === "agent" || state.inputBuffer.length > 0) return theme.bgInputFocused
  return theme.bgPanel
}

function monitorInputBackground(state: AppState): string {
  if (state.focusMode === "monitor" || state.monitorInputBuffer.length > 0) return theme.bgInputFocused
  return theme.bgPanel
}

function renderMonitorInputStyled(state: AppState): StyledText {
  const preview = state.monitorInputBuffer.replace(/\n/g, " ↵ ")
  const sidecarUi = {
    monitorSnapshot: state.monitorSnapshot,
    sidecarChatInFlight: state.sidecarChatInFlight,
    sidecarQueuedMessages: state.sidecarQueuedMessages,
    spinnerFrame: state.spinnerFrame,
    status: state.status,
  }
  if (isGoalMode(state)) {
    const statusLine = sidecarInputStatusLine(sidecarUi)
    if (preview) {
      return new StyledText([
        fg(theme.synth.amber)("› "),
        sidecarAgentActive(sidecarUi) ? fg(theme.synth.amber)(statusLine) : dim(fg(theme.fgMuted)(statusLine)),
        fg(theme.fgMuted)(" · "),
        fg(theme.fgInput)(preview),
        fg(theme.synth.gold)("_"),
      ])
    }
    return new StyledText([
      fg(theme.synth.amber)("› "),
      sidecarAgentActive(sidecarUi) ? fg(theme.synth.amber)(statusLine) : dim(fg(theme.fgMuted)(statusLine)),
    ])
  }
  if (state.monitorSnapshot.status === "running") {
    const runningLine = `› ${runningSpinner(state)}`
    if (preview) {
      return new StyledText([
        fg(theme.synth.amber)(runningLine),
        fg(theme.fgMuted)(" · "),
        fg(theme.fgInput)(preview),
        fg(theme.synth.gold)("_"),
      ])
    }
    return new StyledText([fg(theme.synth.amber)(runningLine)])
  }
  if (!preview) {
    return new StyledText([fg(theme.synth.amber)("› "), dim(fg(theme.fgMuted)("Message monitor · /help"))])
  }
  return new StyledText([
    fg(theme.synth.amber)("› "),
    fg(theme.fgInput)(preview),
    fg(theme.synth.gold)("_"),
  ])
}

function renderAgentInputStyled(options: StackAppOptions, state: AppState): StyledText {
  const preview = state.inputBuffer.replace(/\n/g, " ↵ ")
  const idleHint = isGardenerSession(options, state) ? "Message gardener · /help" : "Build anything · /help"
  if (state.status === "running") {
    const throughput = formatAverageTokensPerSecond(displayTokensPerSecond(state))
    const queueSuffix =
      state.queuedMessages.length > 0 ? ` · ${state.queuedMessages.length} queued` : ""
    const steerSuffix = state.lastSteerHint ? ` · ${state.lastSteerHint}` : ""
    // This row is just a busy indicator; transcript blocks/tool calls carry detail.
    const runningLine = throughput
      ? `› ${runningSpinner(state)} · ${throughput}${queueSuffix}${steerSuffix}`
      : `› ${runningSpinner(state)}${queueSuffix}${steerSuffix}`
    if (preview) {
      return new StyledText([
        fg(theme.synth.amber)(runningLine),
        fg(theme.fgMuted)(" · "),
        fg(theme.fgInput)(preview),
        fg(theme.synth.gold)("_"),
      ])
    }
    return new StyledText([fg(theme.synth.amber)(runningLine)])
  }

  if (!preview) {
    return new StyledText([
      fg(isGardenerSession(options, state) ? "#3fb950" : theme.synth.amber)("› "),
      dim(fg(theme.fgMuted)(idleHint)),
    ])
  }

  return new StyledText([
    fg(isGardenerSession(options, state) ? "#3fb950" : theme.synth.amber)("› "),
    fg(theme.fgInput)(preview),
    fg(theme.synth.gold)("_"),
  ])
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
    const stackevalLine = stackevalPacketStatusLine(readActiveStackevalPacket(options.config.stackDataRoot))
    return [
      "bridge local",
      `tool ${bridgeStatusToolName(state)}`,
      `mcp ${stackMcpStatusLabel(options.config)}`,
      `eval ${state.evalLaunch.status}`,
      stackevalLine ? inlineText(stackevalLine, 48) : "",
      `optimizers ${state.optimizerSnapshot.status} ${optimizerCounts.active}/${optimizerCounts.total} active`,
      "x remote bridge",
    ]
      .filter((part) => part.length > 0)
      .join(" | ")
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
    recentSkillRailLine(state),
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
    recentSkillRailLine(state),
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

function renderMonitorRailStyled(snapshot: StackMonitorSnapshot, columns: number): StyledText {
  const chunks: TextChunk[] = []
  for (const [index, line] of monitorRailLines(snapshot, columns).entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    if (index === 0) {
      chunks.push(fg(theme.synth.orangeDark)(line))
    } else if (line.includes("monitor ON")) {
      chunks.push(fg("#3fb950")(line))
    } else if (line.includes("monitor OFF") || line.includes("monitor PAUSED")) {
      chunks.push(fg(theme.synth.red)(line))
    } else if (line.includes("queued") || line.includes("high") || line.includes("medium")) {
      chunks.push(fg(theme.synth.amber)(line))
    } else {
      chunks.push(fg(theme.fgSecondary)(line))
    }
  }
  return new StyledText(chunks)
}

function recentSkillRailLine(state: AppState): string {
  const used = state.agentContext.usedSkills
  if (used.length === 0) return "skill -"
  const latest = [...used].sort((left, right) => skillTimeMs(right) - skillTimeMs(left))[0]
  if (!latest) return "skill -"
  const parts = [`skill ${latest.name}`]
  if (latest.usedAt) parts.push(formatSkillClock(latest.usedAt))
  if (typeof latest.durationMs === "number") parts.push(formatSkillDuration(latest.durationMs))
  if (latest.actorRole === "monitor") parts.push("monitor")
  return parts.join(" · ")
}

function skillTimeMs(skill: AgentContextSnapshot["usedSkills"][number]): number {
  if (!skill.usedAt) return 0
  const value = new Date(skill.usedAt).getTime()
  return Number.isNaN(value) ? 0 : value
}

function formatSkillClock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toTimeString().slice(0, 8)
}

function formatSkillDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}m`
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
  const rel = relative(config.stackDataRoot, path)
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

async function openSelectedRemoteHostedArtifact(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): Promise<void> {
  const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  if (!run) {
    state.remoteActionMessage = "no run selected"
    refresh()
    return
  }
  state.remoteActionMessage = `opening artifact for ${run.runId.slice(0, 8)}…`
  refresh()
  // Prefer snapshot if present, else fetch
  let ha: HostedArtifactStatus | null = state.remoteResearchSnapshot.hostedArtifacts[run.runId] ?? null
  if (!ha || !ha.hostedUrl) {
    try {
      ha = await readRunHostedArtifactStatus(options.config, run.runId)
    } catch {
      ha = null
    }
  }
  const url = ha?.hostedUrl ?? ha?.publicUrl
  if (!url) {
    state.remoteActionMessage = `no hosted artifact url yet for ${run.runId.slice(0, 8)} (status=${ha?.status ?? "none"})`
    refresh()
    return
  }
  const res = await openUrlInSystemBrowser(url)
  const receipt = res.ok ? `RECEIPT PASS hosted_url=${ha?.urlStatus ?? 200} [Open artifact ↗]` : ""
  state.remoteActionMessage = res.ok
    ? `opened ${ha?.status ?? ""} ${url.slice(0, 48)}… ${receipt}`.trim()
    : `open failed: ${res.message}`
  refresh()
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
    state.focusMode === "remote" ? "r refresh | e eval | j/k jobs | f factory | o output | O open-artifact | t target" : "tab here for remote SMR",
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

function transcriptViewportMetrics(renderer: CliRenderer, state: AppState, extraReservedRows = 0): TranscriptViewport {
  const lines = Math.max(8, renderer.terminalHeight - (state.railsVisible ? 12 : 10) - extraReservedRows)
  const widthShare = state.railsVisible ? 0.5 : 0.72
  const columns = Math.max(40, Math.floor(renderer.terminalWidth * widthShare) - 8)
  return {
    lines,
    columns,
    pageLines: Math.max(3, Math.floor(lines * 0.8)),
  }
}

function agentTranscriptViewport(renderer: CliRenderer, state: AppState): TranscriptViewport {
  const base = transcriptViewportMetrics(renderer, state)
  if (!isGoalMode(state) || !state.goalShutterWorkerPeek) return base
  const goalStripLines =
    state.metaThreadManifest?.active_goal?.objective?.trim() ||
    state.goalContext.objective?.trim()
      ? 1
      : 0
  const lines = goalWorkerPeekTranscriptRows(base.lines, goalStripLines)
  return {
    ...base,
    lines,
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
  const viewport = renderer ? agentTranscriptViewport(renderer, state) : undefined
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

function resetGardenerLiveTranscript(state: AppState): void {
  state.gardenerLiveBlocks = []
  state.gardenerLiveTools = []
  state.gardenerLiveSubagents = []
  state.gardenerLiveThinking = undefined
}

function createGardenerLiveSink(
  state: AppState,
  refresh: () => void,
): {
  write: (chunk: string) => void
  flush: () => void
} {
  let buffer = ""
  const liveThinkingId: { current?: string } = {}
  const liveToolGroupId: { current?: string } = {}
  const liveSubagentGroupId: { current?: string } = {}
  const multiAgentCalls = new Map<string, import("./subagents.js").MultiAgentCallMeta & { callId: string }>()
  const turnStartedAt: { current?: string } = {}

  const processLine = (line: string) => {
    if (!line.trim()) return
    const rendered = applyCodexLine(
      state.gardenerLiveBlocks,
      state.gardenerLiveTools,
      state.gardenerLiveSubagents,
      liveThinkingId,
      liveToolGroupId,
      liveSubagentGroupId,
      multiAgentCalls,
      turnStartedAt,
      line,
    )
    if (rendered?.thinking !== undefined) state.gardenerLiveThinking = rendered.thinking
    if (rendered?.turnCompleted) state.gardenerLiveThinking = undefined
    refresh()
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
  }
}

function createCodexTranscriptSink(
  state: AppState,
  workspaceRoot: string,
  onUsage: (usage: StackCodexUsage) => void,
  onActivity?: () => void,
  onThreadStarted?: (threadId: string) => void,
  onRateLimits?: (limits: CodexRateLimitsSnapshot) => void,
  onCodexLine?: (line: string) => void,
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
    if (rendered !== undefined) {
      if (rendered.usage) onUsage(rendered.usage as StackCodexUsage)
      if (rendered.agentText || rendered.stackText || rendered.tool || rendered.subagent) visibleOutput = true
      if (rendered.thinking !== undefined) state.liveThinkingText = rendered.thinking
      if (rendered.turnCompleted) state.liveThinkingText = undefined
      if (rendered.threadId) onThreadStarted?.(rendered.threadId)
      if (rendered.rateLimits) onRateLimits?.(rendered.rateLimits)
      const goalUpdate = parseGoalFromCodexJsonLine(line)
      if (goalUpdate) {
        state.goalContext = mergeMetaThreadGoalContext(
          mergeGoalContext(state.goalContext, goalUpdate),
          state.metaThreadManifest,
        )
      }
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
    }
    onCodexLine?.(line)
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

async function observeCodexAuthState(
  config: StackAppOptions["config"],
  sessionId: string,
  rateLimits?: CodexRateLimitsSnapshot,
  state?: AppState,
): Promise<void> {
  const account = await readCodexAccountSnapshot()
  if (state) {
    state.codexAccountEmail = account.email
    if (rateLimits) state.codexRateLimits = rateLimits
  }
  recordCodexAuthObservation({
    stackRoot: config.stackDataRoot,
    stackSessionId: sessionId,
    authPlan: config.codexAuthPlan,
    account,
    rateLimits: rateLimits ?? state?.codexRateLimits,
  })
}

async function refreshMetaThreadGoal(
  options: StackAppOptions,
  state: AppState,
  refresh?: () => void,
): Promise<void> {
  const metaThreadId = options.session.metaThreadId
  if (!metaThreadId) {
    state.metaThreadManifest = undefined
    refresh?.()
    return
  }
  const manifest = await readMetaThreadManifest(options.config.stackDataRoot, metaThreadId)
  state.metaThreadManifest = manifest
  if (manifest) {
    state.goalContext = mergeMetaThreadGoalContext(state.goalContext, manifest)
  }
  refresh?.()
}

async function refreshAgentContextFromThread(
  state: AppState,
  threadId: string,
  workspaceRoot: string,
  refresh?: () => void,
  observeAuth?: (limits: CodexRateLimitsSnapshot) => void,
): Promise<void> {
  const [sessionContext, rateLimits, goalContext] = await Promise.all([
    readAgentContextFromSession(threadId),
    readCodexRateLimitsFromSession(threadId),
    readGoalFromSession(threadId),
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
  if (rateLimits) {
    state.codexRateLimits = rateLimits
    observeAuth?.(rateLimits)
  }
  if (goalContext) state.goalContext = goalContext
  refresh?.()
}

async function refreshAgentContextFromSession(
  options: StackAppOptions,
  state: AppState,
  refresh?: () => void,
  observeAuth?: (limits: CodexRateLimitsSnapshot) => void,
): Promise<void> {
  state.monitorSnapshot = refreshMonitorSnapshot(options.config.stackDataRoot, options.session.id)
  syncMonitorRightPanel(state)
  const threadId =
    options.session.codexThreadId ?? extractCodexThreadIdFromTurns(options.session.turns)
  if (threadId) {
    options.session.codexThreadId = threadId
    await refreshAgentContextFromThread(state, threadId, options.session.workspaceRoot, refresh, observeAuth)
    await refreshMetaThreadGoal(options, state, refresh)
    return
  }
  state.agentContext = emptyAgentContext(options.session.workspaceRoot)
  state.goalContext = emptyGoalContext()
  await refreshMetaThreadGoal(options, state, refresh)
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
    "Enter resume into this session. n new thread. f fork turns into the current session.",
  ].join("\n")
}

async function activateWorkerSessionForGardener(
  options: StackAppOptions,
  state: AppState,
  targetId: string,
  codexSessionHandle: { session?: HarnessSession },
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<boolean> {
  if (targetId === options.session.id) return true
  const summary = state.history.find((entry) => entry.id === targetId)
  if (!summary) {
    appendStackBlock(state.blocks, `gardener target thread missing: ${targetId.slice(0, 8)}`)
    refresh()
    return false
  }
  try {
    const loaded = await readSessionLog(summary.path)
    applySession(options, state, loaded, summary.path)
    await openHarnessSession(options, state, codexSessionHandle, options.session.codexThreadId)
    await refreshAgentContextFromSession(options, state, refresh, (limits) => {
      void observeCodexAuthState(options.config, options.session.id, limits, state)
    })
    state.monitorSnapshot = refreshMonitorSnapshot(options.config.stackDataRoot, options.session.id)
    state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
    syncMonitorRightPanel(state)
    refreshMetaEvents()
    const index = state.history.findIndex((entry) => entry.id === targetId)
    if (index >= 0) state.selectedHistoryIndex = index
    appendStackBlock(state.blocks, `gardener switched to worker ${targetId.slice(0, 8)}`)
    refresh()
    return true
  } catch (error) {
    appendStackBlock(state.blocks, `gardener failed to activate worker ${targetId.slice(0, 8)}: ${errorMessage(error)}`)
    refresh()
    return false
  }
}

async function routeGardenerInboxItems(
  items: GardenerInboxItem[],
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<void> {
  if (items.length === 0) return
  const stackRoot = options.config.stackDataRoot
  const gardenerId = gardenerThreadId(state)
  const workerTargetId = resolveGardenerWorkerTargetId(options, state)
  if (!(await activateWorkerSessionForGardener(
    options,
    state,
    workerTargetId,
    codexSessionHandle,
    refresh,
    refreshHistory,
    refreshMetaEvents,
  ))) {
    return
  }

  const prepared = items.map((item) => {
    const kind = inboxItemDispatchKind(item, stackRoot, gardenerId)
    const guidance = buildGuidanceSnippetForRoute(options.config, item.message)
    const message = composeRoutedWorkerMessage(item.message, guidance)
    return { item, kind, message }
  })

  for (const { item, kind } of prepared) {
    markGardenerInboxRouted(stackRoot, gardenerId, item)
    recordGardenerWorkerDispatch(stackRoot, gardenerId, workerTargetId, item.message, {
      inboxId: item.id,
      kind,
    })
  }
  refreshMetaEvents()
  state.gardenerInboxSelectedIndex = 0

  const steerMessages = prepared.filter((entry) => entry.kind === "steer").map((entry) => entry.message)
  const queueMessages = prepared.filter((entry) => entry.kind === "queue").map((entry) => entry.message)
  const routeMessages = prepared.filter((entry) => entry.kind === "route").map((entry) => entry.message)

  appendStackBlock(
    state.blocks,
    items.length === 1
      ? `gardener → worker ${workerTargetId.slice(0, 8)} (${prepared[0].kind})`
      : `gardener routed ${items.length} to worker ${workerTargetId.slice(0, 8)}`,
  )

  const session = codexSessionHandle.session

  for (const message of steerMessages) {
    if (state.status === "running" && session) {
      const steered = await session.trySteer(message)
      if (!steered) {
        session.enqueue(message)
        state.queuedMessages = [...state.queuedMessages, message]
      }
    } else {
      routeMessages.push(message)
    }
  }

  for (const message of queueMessages) {
    if (session) {
      session.enqueue(message)
      state.queuedMessages = [...state.queuedMessages, message]
    } else {
      state.gardenerWorkerQueue = [...state.gardenerWorkerQueue, message]
    }
  }

  if (routeMessages.length === 0) {
    await refreshGardenerMaintenance(options, state, "inbox")
    refresh()
    return
  }

  if (state.status === "running" && session) {
    for (const message of routeMessages) {
      session.enqueue(message)
      state.queuedMessages = [...state.queuedMessages, message]
    }
    await refreshGardenerMaintenance(options, state, "inbox")
    refresh()
    return
  }

  if (state.status === "running") {
    refresh()
    return
  }

  state.gardenerWorkerQueue = [...state.gardenerWorkerQueue, ...routeMessages.slice(1)]
  void submitPrompt(
    routeMessages[0],
    options,
    state,
    codexSessionHandle,
    renderer,
    refresh,
    refreshHistory,
    refreshMetaEvents,
  )
  void refreshGardenerMaintenance(options, state, "inbox")
}

async function handleGardenerKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  visibleRows: number,
): Promise<void> {
  if (key.name === "p") {
    toggleLeftPanelRails(state)
    refresh()
    return
  }
  if (state.gardenerInputBuffer.length > 0) return
  const inbox = readGardenerInbox(options.config.stackDataRoot, gardenerThreadId(state))
  state.gardenerInboxSelectedIndex = clampIndex(state.gardenerInboxSelectedIndex, inbox.length)
  if (key.name === "w") {
    cycleGardenerWorkerTarget(state)
    refresh()
    return
  }
  if (key.name === "j" || key.name === "down") {
    if (inbox.length > 0) {
      state.gardenerInboxSelectedIndex = Math.min(inbox.length - 1, state.gardenerInboxSelectedIndex + 1)
    } else {
      scrollGardenerPane("down", state, readThreadMetaEvents(options.config.stackDataRoot, gardenerThreadId(state)), buildGardenerThreadContext(options, state), 24, visibleRows, "narrative", refresh)
      return
    }
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    if (inbox.length > 0) {
      state.gardenerInboxSelectedIndex = Math.max(0, state.gardenerInboxSelectedIndex - 1)
    } else {
      scrollGardenerPane("up", state, readThreadMetaEvents(options.config.stackDataRoot, gardenerThreadId(state)), buildGardenerThreadContext(options, state), 24, visibleRows, "narrative", refresh)
      return
    }
    refresh()
    return
  }
  if (key.name === "d") {
    const item = inbox[state.gardenerInboxSelectedIndex]
    if (item) {
      dismissGardenerInboxItem(options.config.stackDataRoot, gardenerThreadId(state), item)
      refreshMetaEvents()
      void refreshGardenerMaintenance(options, state, "inbox").then(() => refresh())
    }
    refresh()
    return
  }
  if (key.name === "a") {
    await routeGardenerInboxItems(
      inbox,
      options,
      state,
      codexSessionHandle,
      renderer,
      refresh,
      refreshHistory,
      refreshMetaEvents,
    )
    return
  }
  if (key.name === "return" || key.name === "enter") {
    const item = inbox[state.gardenerInboxSelectedIndex]
    if (item) {
      await routeGardenerInboxItems(
        [item],
        options,
        state,
        codexSessionHandle,
        renderer,
        refresh,
        refreshHistory,
        refreshMetaEvents,
      )
    }
    return
  }
}

async function handleHistoryKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshRemoteAccount: () => Promise<void>,
  refreshRemoteUsage: () => Promise<void>,
  refreshMetaEvents: () => void,
  codexSessionHandle: { session?: HarnessSession },
  refreshHarnessAccount: () => Promise<void>,
  renderer: CliRenderer,
  visibleRows: number,
): Promise<void> {
  if (key.name === "p") {
    toggleLeftPanelRails(state)
    refresh()
    return
  }
  if (key.name === "P") {
    toggleLeftPanelMode(state)
    if (state.leftPanelMode === "bridge") {
      state.focusMode = defaultLiveOpsFocus(state)
    }
    refresh()
    return
  }
  if (state.leftPanelMode === "account") {
    if (key.name === "r") {
      await Promise.all([refreshRemoteAccount(), refreshRemoteUsage()])
      refresh()
      return
    }
    if (key.name === "j" || key.name === "down") {
      scrollLeftPanel(options, state, visibleRows, "down")
      refresh()
      return
    }
    if (key.name === "k" || key.name === "up") {
      scrollLeftPanel(options, state, visibleRows, "up")
      refresh()
      return
    }
    return
  }
  if (state.leftPanelMode === "bridge") {
    if (key.name === "x") {
      toggleLiveOpsMode(state)
      refresh()
    }
    return
  }
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
  if (key.name === "n") {
    await startNewThread(
      options,
      state,
      codexSessionHandle,
      refresh,
      refreshHistory,
      refreshMetaEvents,
    )
    return
  }
  if (key.name === "f") {
    await loadSelectedSession(options, state, codexSessionHandle, refresh, refreshHistory, refreshMetaEvents, "fork")
    return
  }
  if (key.name === "return" || key.name === "enter") {
    await loadSelectedSession(options, state, codexSessionHandle, refresh, refreshHistory, refreshMetaEvents, "resume")
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
  if (key.name === "O") {
    void openSelectedRemoteHostedArtifact(options, state, refresh) // FRESH stack/src edit this turn for tracked delta (AC4)
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
  if (action === "cancel-run" && run) {
    await recordTuiRuntimeLeverEvent({
      event_type: "lever.hosted_optimizer.cancel_requested",
      source: "lever.stack_tui",
      subject: { kind: "hosted_optimizer_run", id: run.runId },
      correlation: { optimizer_run_id: run.runId },
      payload: {
        environment: options.config.environmentName,
        api_base_url: options.config.environment.apiBaseUrl,
        ok: result.ok,
        status: result.status,
        message: result.message,
      },
    })
  }

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
  await recordRemoteTuiLeverEvent(options.config, action, { run, factory, draft, result })

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

async function recordRemoteTuiLeverEvent(
  config: StackConfig,
  action: LiveActionKind,
  context: {
    run?: RemoteSmrRunSummary
    factory?: RemoteFactorySummary
    draft: string
    result: RemoteActionResult
  },
): Promise<void> {
  switch (action) {
    case "message-run":
      if (!context.run) return
      await recordTuiRuntimeLeverEvent({
        event_type: "lever.remote_smr.run.message_sent",
        source: "lever.stack_tui",
        subject: { kind: "remote_smr_run", id: context.run.runId },
        correlation: { run_id: context.run.runId, project_id: context.run.projectId },
        payload: {
          environment: config.environmentName,
          api_base_url: config.environment.apiBaseUrl,
          ok: context.result.ok,
          status: context.result.status,
          message: context.result.message,
          body_preview: context.draft.slice(0, 160),
        },
      })
      return
    case "message-factory":
      if (!context.factory) return
      await recordTuiRuntimeLeverEvent({
        event_type: "lever.remote_factory.message_sent",
        source: "lever.stack_tui",
        subject: { kind: "remote_factory", id: context.factory.factoryId },
        correlation: {
          factory_id: context.factory.factoryId,
          project_id: context.factory.canonicalProjectId ?? context.factory.latestProjectId,
        },
        payload: {
          environment: config.environmentName,
          api_base_url: config.environment.apiBaseUrl,
          ok: context.result.ok,
          status: context.result.status,
          message: context.result.message,
          body_preview: context.draft.slice(0, 160),
        },
      })
      return
    case "upload-run-file":
      if (!context.run) return
      await recordTuiRuntimeLeverEvent({
        event_type: "lever.remote_smr.run_file.upload_requested",
        source: "lever.stack_tui",
        subject: { kind: "remote_smr_run", id: context.run.runId },
        correlation: { run_id: context.run.runId, project_id: context.run.projectId },
        payload: {
          environment: config.environmentName,
          api_base_url: config.environment.apiBaseUrl,
          ok: context.result.ok,
          status: context.result.status,
          message: context.result.message,
        },
      })
      return
    case "pause-run":
    case "resume-run":
    case "stop-run":
      if (!context.run) return
      await recordTuiRuntimeLeverEvent({
        event_type: `lever.remote_smr.run.${action.replace("-run", "").replace("-", "_")}` as `lever.${string}`,
        source: "lever.stack_tui",
        subject: { kind: "remote_smr_run", id: context.run.runId },
        correlation: { run_id: context.run.runId, project_id: context.run.projectId },
        payload: {
          environment: config.environmentName,
          api_base_url: config.environment.apiBaseUrl,
          action,
          ok: context.result.ok,
          status: context.result.status,
          message: context.result.message,
        },
      })
      return
    default:
      return
  }
}

async function recordTuiRuntimeLeverEvent(request: StackdRuntimeEventAppendRequest): Promise<void> {
  try {
    await stackdRuntimeAppendEvent(request)
  } catch {
    // Runtime receipts are best-effort; owner-route action results remain authoritative.
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
  if (!isCycleKey(key)) return
  cycleModel(config, key.name === "k" || key.name === "left" ? -1 : 1)
}

function handleEffortKey(key: { name?: string }, config: StackConfig): void {
  if (isCursorHarness(config)) return
  if (isCycleKey(key)) cycleEffort(config, key.name === "k" || key.name === "left" ? -1 : 1)
}

function handleSubagentModelKey(key: { name?: string }, config: StackConfig): void {
  if (isCursorHarness(config)) return
  if (!isCycleKey(key)) return
  cycleSubagentModel(config, key.name === "k" || key.name === "left" ? -1 : 1)
  syncStackSubagentAgentFiles(config)
}

function handleSubagentEffortKey(key: { name?: string }, config: StackConfig): void {
  if (isCursorHarness(config)) return
  if (!isCycleKey(key)) return
  cycleSubagentEffort(config, key.name === "k" || key.name === "left" ? -1 : 1)
  syncStackSubagentAgentFiles(config)
}

function handleSubagentsKey(key: { name?: string }, config: StackConfig): void {
  if (isCursorHarness(config)) return
  if (!isCycleKey(key)) return
  setCodexSubagentsEnabled(config, !config.codexSubagentsEnabled)
}

function handleMonitorKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): boolean {
  if (key.name === "p") {
    toggleRightPanelOps(state)
    refresh()
    return true
  }
  if (key.name === "w") {
    cycleMonitorWorkerTarget(state)
    refresh()
    return true
  }
  if (
    (key.name === "return" || key.name === "enter") &&
    state.monitorInputBuffer.length === 0 &&
    resolveMonitorWorkerTargetId(options, state) !== options.session.id
  ) {
    void resumeMonitorWorkerTarget(
      options,
      state,
      codexSessionHandle,
      refresh,
      refreshHistory,
      refreshMetaEvents,
    )
    return true
  }
  if (state.monitorInputBuffer.length > 0) return false
  const columns = monitorPanelColumns(renderer, state)
  const rows = monitorThreadVisibleRows(renderer, state)
  const workerActive = monitorWorkerActive(state) && !monitorWatchSuppressedByGoalChat(state)
  const chatSplit = monitorChatRowSplit(rows, workerActive)
  if (chatSplit.watchRows > 0) {
    if (key.name === "j" || key.name === "down") {
      scrollMonitorWatchPane("down", state, columns, chatSplit.watchRows, refresh)
      return true
    }
    if (key.name === "k" || key.name === "up") {
      scrollMonitorWatchPane("up", state, columns, chatSplit.watchRows, refresh)
      return true
    }
  }
  if (key.name === "j" || key.name === "down") {
    scrollMonitorPane("down", state, columns, rows, "narrative", refresh)
    return true
  }
  if (key.name === "k" || key.name === "up") {
    scrollMonitorPane("up", state, columns, rows, "narrative", refresh)
    return true
  }
  if (isCycleKey(key)) {
    toggleMonitorEnabled(options, state, refresh)
    return true
  }
  return false
}

function scrollMonitorWatchPane(
  direction: "up" | "down",
  state: AppState,
  columns: number,
  visibleRows: number,
  refresh: () => void,
): void {
  const maxOffset = maxTranscriptScrollOffset(
    state.blocks,
    state.toolLogs,
    state.subagentLogs,
    columns,
    transcriptRenderOptions(state),
    visibleRows,
  )
  if (direction === "up") {
    state.monitorWatchScrollPinned = false
    state.monitorWatchScrollOffset = Math.max(0, state.monitorWatchScrollOffset - 3)
  } else {
    state.monitorWatchScrollOffset = Math.min(maxOffset, state.monitorWatchScrollOffset + 3)
    if (state.monitorWatchScrollOffset >= maxOffset) state.monitorWatchScrollPinned = true
  }
  refresh()
}

function handleMonitorScrollKey(
  key: { name?: string },
  state: AppState,
  renderer: CliRenderer,
): boolean {
  if (state.monitorInputBuffer.length > 0) return false
  if (key.name !== "j" && key.name !== "k" && key.name !== "down" && key.name !== "up") return false
  const columns = monitorPanelColumns(renderer, state)
  const rows = monitorThreadVisibleRows(renderer, state)
  const workerActive = monitorWorkerActive(state) && !monitorWatchSuppressedByGoalChat(state)
  const chatSplit = monitorChatRowSplit(rows, workerActive)
  if (chatSplit.watchRows > 0) {
    scrollMonitorWatchPane(key.name === "j" || key.name === "down" ? "down" : "up", state, columns, chatSplit.watchRows, () => {})
    return true
  }
  if (key.name === "j" || key.name === "down") {
    scrollMonitorPane("down", state, columns, rows, "narrative", () => {})
    return true
  }
  scrollMonitorPane("up", state, columns, rows, "narrative", () => {})
  return true
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
    hostedArtifacts: {},
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
  state.selectedProjectIndex = 0
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

function turnExitIdle(exitCode: number | undefined): boolean {
  return exitCode === 0 || exitCode === 130
}

function cycleModel(config: StackConfig, direction: number): void {
  if (isCursorHarness(config)) {
    const options = CURSOR_MODEL_OPTIONS
    const current = Math.max(0, options.findIndex((option) => option === config.cursorModel))
    setCursorModel(config, options[(current + direction + options.length) % options.length] ?? config.cursorModel)
    return
  }
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

function cycleSubagentModel(config: StackConfig, direction: number): void {
  const options = CODEX_MODEL_OPTIONS
  const current = Math.max(0, options.findIndex((option) => option === config.codexSubagentModel))
  setCodexSubagentModel(
    config,
    options[(current + direction + options.length) % options.length] ?? config.codexSubagentModel,
  )
}

function cycleSubagentEffort(config: StackConfig, direction: number): void {
  const options = CODEX_REASONING_EFFORT_OPTIONS
  const current = Math.max(0, options.findIndex((option) => option === config.codexSubagentReasoningEffort))
  setCodexSubagentReasoningEffort(
    config,
    options[(current + direction + options.length) % options.length] ?? config.codexSubagentReasoningEffort,
  )
}

function cycleHarnessProvider(config: StackConfig, direction: number): StackHarnessKind {
  const current = Math.max(0, HARNESS_PROVIDER_CHOICES.findIndex((choice) => choice.harness === config.harness))
  return (
    HARNESS_PROVIDER_CHOICES[(current + direction + HARNESS_PROVIDER_CHOICES.length) % HARNESS_PROVIDER_CHOICES.length]
      ?.harness ?? config.harness
  )
}

function assignHarnessSession(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  resumeBackendThreadId?: string,
): void {
  codexSessionHandle.session = undefined
  if (isCursorHarness(options.config)) {
    codexSessionHandle.session = new CursorAcpSession({
      config: options.config,
      resumeSessionId: resumeBackendThreadId,
      onOutput: () => undefined,
    })
    return
  }
  if (state.codexTransport !== "app-server") return
  codexSessionHandle.session = new CodexAppServerSession({
    config: options.config,
    resumeThreadId: resumeBackendThreadId,
    onOutput: () => undefined,
  })
}

async function refreshHarnessAccountLight(
  options: StackAppOptions,
  state: AppState,
): Promise<void> {
  if (isCursorHarness(options.config)) {
    state.cursorAccount = await readCursorAccountSnapshot(options.config.cursorCommand)
    state.codexAccountEmail = state.cursorAccount.email
    return
  }
  state.cursorAccount = undefined
  const account = await readCodexAccountSnapshot()
  state.codexAccountEmail = account.email
  const latest = await readLatestCodexRateLimits()
  if (latest) {
    state.codexRateLimits = latest
    await observeCodexAuthState(options.config, options.session.id, latest, state)
  }
}

function applyHarnessSwitchLight(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  harness: StackHarnessKind,
): boolean {
  if (state.status === "running") return false
  if (options.config.harness === harness) return false

  setStackHarness(options.config, harness)
  options.session.codexThreadId = undefined
  state.codexTransport = isCursorHarness(options.config) ? "acp" : resolveCodexTransport()
  state.harnessCommand = harnessSessionCommand(options.config)
  if (isCursorHarness(options.config) && CURSOR_EXCLUDED_FOCUS.has(state.focusMode)) {
    state.focusMode = "account"
  }

  void codexSessionHandle.session?.close().catch(() => undefined)
  assignHarnessSession(options, state, codexSessionHandle)
  return true
}

async function applyHarnessSwitch(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  harness: StackHarnessKind,
  refresh: () => void,
): Promise<void> {
  if (state.status === "running") {
    appendStackBlock(state.blocks, "interrupt or wait for the current turn before switching provider")
    refresh()
    return
  }
  if (!applyHarnessSwitchLight(options, state, codexSessionHandle, harness)) return

  appendStackBlock(state.blocks, `provider ${harnessAuthPlan(options.config)}`)
  refresh()
  void refreshHarnessAccountLight(options, state).then(refresh).catch(() => refresh())
}

async function handleAccountKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  refresh: () => void,
): Promise<void> {
  if (!isCycleKey(key)) return
  const direction = key.name === "k" || key.name === "left" ? -1 : 1
  const nextHarness = cycleHarnessProvider(options.config, direction)
  await applyHarnessSwitch(options, state, codexSessionHandle, nextHarness, refresh)
}

type OpenHarnessSessionOptions = {
  probe?: boolean
}

async function openHarnessSession(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  resumeBackendThreadId?: string,
  openOptions: OpenHarnessSessionOptions = {},
): Promise<void> {
  const probe = openOptions.probe ?? false
  await codexSessionHandle.session?.close().catch(() => undefined)
  codexSessionHandle.session = undefined

  if (isCursorHarness(options.config)) {
    if (probe) {
      const acpAvailable = await probeCursorAcpAvailability({
        command: options.config.cursorCommand,
        args: ["agent", "acp"],
        cwd: options.config.workspaceRoot,
      })
      if (!acpAvailable) return
    }
    assignHarnessSession(options, state, codexSessionHandle, resumeBackendThreadId)
    return
  }

  if (state.codexTransport !== "app-server") return
  if (probe) {
    const appServerAvailable = await probeCodexAppServerAvailability(options.config)
    if (!appServerAvailable) {
      state.codexTransport = "exec"
      return
    }
  }
  assignHarnessSession(options, state, codexSessionHandle, resumeBackendThreadId)
}

async function startNewThread(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<void> {
  if (state.status === "running") {
    appendStackBlock(state.blocks, "interrupt or wait for the current turn before starting a new thread")
    refresh()
    return
  }

  setStackHarness(options.config, "codex")
  options.session.codexThreadId = undefined

  const session = createSession(options.config.workspaceRoot, harnessSessionCommand(options.config))
  applySession(options, state, session, undefined)
  state.monitorSnapshot = refreshMonitorSnapshot(options.config.stackDataRoot, session.id)
  state.agentContext = emptyAgentContext(session.workspaceRoot)
  state.goalContext = emptyGoalContext()
  state.metaThreadManifest = undefined
  state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, session.id)
  state.queuedMessages = []
  state.gardenerWorkerQueue = []
  state.inputBuffer = readInitialPrompt(options.config)
  state.lastSteerHint = undefined
  state.lastUsage = undefined
  state.emaTokensPerSecond = undefined

  state.codexTransport = resolveCodexTransport()
  state.harnessCommand = harnessSessionCommand(options.config)
  void codexSessionHandle.session?.close().catch(() => undefined)
  assignHarnessSession(options, state, codexSessionHandle)
  void refreshHarnessAccountLight(options, state).then(refresh).catch(() => refresh())

  try {
    state.lastSessionLogPath = await writeSessionLog(session, options.config.sessionLogDir, {
      codexModel: harnessModel(options.config),
      pricingRows: options.config.codexPricing,
    })
    await refreshHistory()
    const index = state.history.findIndex((summary) => summary.id === session.id)
    state.selectedHistoryIndex = index >= 0 ? index : 0
  } catch (error) {
    appendStackBlock(state.blocks, `new thread log write failed: ${errorMessage(error)}`)
  }

  refreshMetaEvents()
  appendStackBlock(state.blocks, `new thread ${session.id.slice(0, 8)} · ${harnessModel(options.config)}`)
  refresh()
}

type RuntimeFactoryRead = {
  snapshot: StackdFactorySnapshot | null
  eventsAppended: number | null
}

async function readRuntimeFactory(): Promise<RuntimeFactoryRead> {
  try {
    const response = await stackdRuntimeFactory()
    return {
      snapshot: response.snapshot ?? null,
      eventsAppended: response.events_appended ?? null,
    }
  } catch {
    return {
      snapshot: null,
      eventsAppended: null,
    }
  }
}

function localOptimizerSnapshotFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
  fallback?: OptimizerSnapshot,
): OptimizerSnapshot | undefined {
  const local = snapshot?.local_gepa
  if (!snapshot || !local || local.service_status === "unknown") return undefined
  const runs = fallback?.runs ? [...fallback.runs] : []
  if (local.active_run_id && !runs.some((run) => run.runId === local.active_run_id)) {
    runs.unshift({
      runId: local.active_run_id,
      status: "running",
      startedAt: local.last_progress_at ?? snapshot.updated_at,
    })
  }
  const activeRunCount = local.active_run_count
  return {
    status: local.service_status === "running" ? "running" : local.service_status === "error" ? "error" : "stopped",
    serviceUrl: local.service_url ?? config.optimizerServiceUrl,
    dbPath: config.optimizerDbPath,
    logPath: config.optimizerLogPath,
    pid: fallback?.pid,
    pidAlive: fallback?.pidAlive,
    message: `runtime ${snapshot.control_state}`,
    checkedAt: snapshot.updated_at,
    runCounts: activeRunCount > 0 ? { running: activeRunCount } : {},
    workerCount: fallback?.workerCount,
    activeWorkers: fallback?.activeWorkers,
    idleWorkers: fallback?.idleWorkers,
    queuedRunnable: fallback?.queuedRunnable,
    queuedBlocked: fallback?.queuedBlocked,
    staleLeases: fallback?.staleLeases,
    runningCount: activeRunCount,
    oldestQueuedAgeSeconds: fallback?.oldestQueuedAgeSeconds,
    lastProgressAt: local.last_progress_at ?? fallback?.lastProgressAt,
    runs,
  }
}

function hostedOptimizerSnapshotFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
  fallback?: HostedOptimizerSnapshot,
): HostedOptimizerSnapshot | undefined {
  const remote = snapshot?.remote_synth
  const runs = remote?.hosted_optimizers ?? []
  if (!snapshot || !remote || runs.length === 0) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  return {
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    environmentName: runtimeEnvironment.environmentName,
    apiBaseUrl: runtimeEnvironment.apiBaseUrl,
    checkedAt: snapshot.updated_at,
    message: `runtime ${runs.length} hosted optimizer runs`,
    runs: runs.map((run) => ({
      runId: run.run_id,
      algorithm: "unknown",
      status: run.status,
      updatedAt: run.updated_at ?? undefined,
    })),
    runDetails: fallback?.runDetails ?? {},
  }
}

function remoteResearchSnapshotFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
  fallback?: RemoteResearchSnapshot,
): RemoteResearchSnapshot | undefined {
  const remote = snapshot?.remote_synth
  if (!snapshot || !remote) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  const hasRemoteState =
    remote.runs.length > 0 ||
    remote.factories.length > 0 ||
    remote.active_run_count > 0 ||
    remote.active_factory_count > 0
  if (!hasRemoteState) return undefined

  const fallbackRunsById = new Map((fallback?.jobs ?? []).map((run) => [run.runId, run]))
  const fallbackFactoriesById = new Map((fallback?.factories ?? []).map((factory) => [factory.factoryId, factory]))
  const jobs = remote.runs
    .slice()
    .sort(compareRuntimeRunRecency)
    .map((run): RemoteSmrRunSummary => {
      const fallbackRun = fallbackRunsById.get(run.run_id)
      return {
        ...fallbackRun,
        runId: run.run_id,
        projectId: run.project_id ?? fallbackRun?.projectId,
        state: run.state,
        phase: run.phase ?? fallbackRun?.phase,
        runbook: run.runbook ?? fallbackRun?.runbook,
        updatedAt: run.updated_at ?? fallbackRun?.updatedAt,
        reason: run.terminal ? fallbackRun?.reason ?? "terminal" : fallbackRun?.reason,
      }
    })
  const factories = remote.factories
    .slice()
    .sort(compareRuntimeFactoryRecency)
    .map((factory): RemoteFactorySummary => {
      const fallbackFactory = fallbackFactoriesById.get(factory.factory_id)
      return {
        ...fallbackFactory,
        factoryId: factory.factory_id,
        name: factory.name,
        kind: factory.kind ?? fallbackFactory?.kind,
        status: factory.status ?? fallbackFactory?.status,
        canonicalProjectId: factory.canonical_project_id ?? fallbackFactory?.canonicalProjectId,
        latestProjectId: factory.latest_project_id ?? fallbackFactory?.latestProjectId,
        latestRunId: factory.latest_run_id ?? fallbackFactory?.latestRunId,
        nextWakeAt: factory.next_wake_at ?? fallbackFactory?.nextWakeAt,
        activeEfforts: factory.active_efforts ?? fallbackFactory?.activeEfforts,
        hasCloudDevEnv: factory.has_cloud_dev_env ?? fallbackFactory?.hasCloudDevEnv,
        cloudDevLabel: factory.cloud_dev_label ?? fallbackFactory?.cloudDevLabel,
        isRunning: factory.is_running ?? fallbackFactory?.isRunning,
      }
    })

  return {
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    environmentName: runtimeEnvironment.environmentName,
    apiBaseUrl: runtimeEnvironment.apiBaseUrl,
    checkedAt: snapshot.updated_at,
    message: `runtime ${jobs.length} SMR runs, ${factories.length} factories`,
    jobs,
    factories,
    runDetails: fallback?.runDetails ?? {},
    hostedArtifacts: fallback?.hostedArtifacts ?? {},
  }
}

function compareRuntimeRunRecency(
  left: StackdFactorySnapshot["remote_synth"]["runs"][number],
  right: StackdFactorySnapshot["remote_synth"]["runs"][number],
): number {
  if (left.terminal !== right.terminal) return left.terminal ? 1 : -1
  return compareOptionalIsoDesc(left.updated_at, right.updated_at) || left.run_id.localeCompare(right.run_id)
}

function compareRuntimeFactoryRecency(
  left: StackdFactorySnapshot["remote_synth"]["factories"][number],
  right: StackdFactorySnapshot["remote_synth"]["factories"][number],
): number {
  if ((left.is_running ?? false) !== (right.is_running ?? false)) return left.is_running ? -1 : 1
  return compareOptionalIsoDesc(left.next_wake_at, right.next_wake_at) || left.factory_id.localeCompare(right.factory_id)
}

function compareOptionalIsoDesc(left: string | null | undefined, right: string | null | undefined): number {
  const leftMs = left ? Date.parse(left) : 0
  const rightMs = right ? Date.parse(right) : 0
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0
  return safeRight - safeLeft
}

function remoteProjectsPanelFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
): RemoteProjectsPanelSnapshot | undefined {
  const remote = snapshot?.remote_synth
  const projects = remote?.projects ?? []
  const runtimeRuns = remote?.runs ?? []
  const runtimeFactories = remote?.factories ?? []
  if (!remote || projects.length === 0) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  const runsById = new Map(runtimeRuns.map((run) => [run.run_id, run]))
  const factoriesById = new Map(runtimeFactories.map((factory) => [factory.factory_id, factory]))
  return {
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    environmentName: runtimeEnvironment.environmentName,
    apiBaseUrl: runtimeEnvironment.apiBaseUrl,
    checkedAt: snapshot.updated_at,
    message: `runtime ${projects.length} projects`,
    projects: projects.map((project) => {
      const linkedRuns = project.run_ids
        .map((runId) => runsById.get(runId))
        .filter((run): run is NonNullable<typeof run> => Boolean(run))
      const projectRuns = linkedRuns.length > 0
        ? linkedRuns
        : runtimeRuns.filter((run) => run.project_id === project.project_id)
      const linkedFactories = project.factory_ids
        .map((factoryId) => factoriesById.get(factoryId))
        .filter((factory): factory is NonNullable<typeof factory> => Boolean(factory))
      const projectFactories = linkedFactories.length > 0
        ? linkedFactories
        : runtimeFactories.filter((factory) => factory.project_ids.includes(project.project_id))
      const activeRun = projectRuns.find((run) => !run.terminal)
      return {
        projectId: project.project_id,
        name: project.name,
        alias: project.alias ?? undefined,
        updatedAt: project.updated_at ?? undefined,
        activeRunId: project.active_run_id ?? activeRun?.run_id,
        factories: projectFactories.map((factory) => ({
          factoryId: factory.factory_id,
          name: factory.name,
          kind: factory.kind ?? undefined,
          status: factory.status ?? undefined,
          canonicalProjectId: factory.canonical_project_id ?? undefined,
          latestProjectId: factory.latest_project_id ?? undefined,
          latestRunId: factory.latest_run_id ?? undefined,
          nextWakeAt: factory.next_wake_at ?? undefined,
          activeEfforts: factory.active_efforts ?? undefined,
          hasCloudDevEnv: factory.has_cloud_dev_env ?? undefined,
          cloudDevLabel: factory.cloud_dev_label ?? undefined,
          isRunning: factory.is_running ?? undefined,
        })),
        runs: projectRuns.map((run) => ({
          runId: run.run_id,
          projectId: run.project_id ?? undefined,
          state: run.state,
          phase: run.phase ?? undefined,
          runbook: run.runbook ?? undefined,
          updatedAt: run.updated_at ?? undefined,
        })),
      }
    }),
  }
}

function runtimeRemoteEnvironment(
  remote: StackdFactorySnapshot["remote_synth"],
  config: StackConfig,
): { environmentName: string; apiBaseUrl: string } {
  return {
    environmentName: remote.environment_name ?? config.environmentName,
    apiBaseUrl: remote.api_base_url ?? config.environment.apiBaseUrl,
  }
}

async function loadSelectedSession(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  mode: "resume" | "fork",
): Promise<void> {
  const summary = state.history[state.selectedHistoryIndex]
  if (!summary) return
  try {
    const loaded = await readSessionLog(summary.path)
    const session = mode === "resume" ? loaded : forkSession(options.session, loaded)
    applySession(options, state, session, mode === "resume" ? summary.path : undefined)
    if (mode === "resume") {
      await restoreWorkerSessionAfterResume(
        options,
        state,
        codexSessionHandle,
        undefined,
        refresh,
        refreshHistory,
        refreshMetaEvents,
      )
    } else {
      await refreshAgentContextFromSession(options, state, refresh, (limits) => {
        void observeCodexAuthState(options.config, options.session.id, limits, state)
      })
    }
    if (mode === "fork") {
      state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir, {
        codexModel: harnessModel(options.config),
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

function restoreHarnessFromSession(options: StackAppOptions, state: AppState): void {
  const harness = options.session.harness ?? (options.session.codexCommand.includes("cursor") ? "cursor" : "codex")
  setStackHarness(options.config, harness)
  if (harness === "cursor") {
    state.codexTransport = "acp"
  } else {
    state.codexTransport = options.session.codexCommand.includes("app-server")
      ? "app-server"
      : resolveCodexTransport()
  }
  state.harnessCommand = harnessSessionCommand(options.config)
}

function applyGoalUiAfterSessionResume(
  state: AppState,
  checkpoint?: StackResumeCheckpoint,
  session?: StackLocalSession,
): void {
  if (!isGoalMode(state)) {
    state.goalShutterWorkerPeek = false
    return
  }
  state.goalShutterWorkerPeek = checkpoint?.goalShutterWorkerPeek ?? false
  state.goalShutterScrollOffset = 0
  state.goalShutterScrollPinned = true
  state.talkToMonitor = true
  state.monitorPanelMode = "chat"
  if (checkpoint?.focusMode === "agent" || checkpoint?.focusMode === "monitor" || checkpoint?.focusMode === "goal") {
    state.focusMode = checkpoint.focusMode
  } else {
    state.focusMode = state.goalShutterWorkerPeek ? "agent" : "monitor"
  }
  if (session && session.turns.length > 0) {
    state.goalShutterWorkerPeek = true
    state.focusMode = "agent"
    state.talkToMonitor = false
  }
}

async function restoreWorkerSessionAfterResume(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  checkpoint: StackResumeCheckpoint | undefined,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<void> {
  if (checkpoint?.codexThreadId && !options.session.codexThreadId) {
    options.session.codexThreadId = checkpoint.codexThreadId
  }
  if (checkpoint?.metaThreadId && !options.session.metaThreadId) {
    options.session.metaThreadId = checkpoint.metaThreadId
  }
  if (checkpoint?.harness) {
    options.session.harness = checkpoint.harness
  }
  if (checkpoint?.codexTransport) {
    state.codexTransport = checkpoint.codexTransport
  }
  if (options.resumeManifest) {
    state.metaThreadManifest = options.resumeManifest
    state.goalContext = mergeMetaThreadGoalContext(state.goalContext, options.resumeManifest)
  }
  restoreHarnessFromSession(options, state)
  const backendSessionId =
    harnessBackendSessionId(checkpoint) ?? options.session.codexThreadId
  await openHarnessSession(options, state, codexSessionHandle, backendSessionId)
  const harnessResume = await resumeHarnessSession(codexSessionHandle.session, checkpoint)
  if (harnessResume.backendSessionId) {
    options.session.codexThreadId = harnessResume.backendSessionId
  }
  if (checkpoint?.harnessResume) {
    checkpoint.harnessResume = {
      ...checkpoint.harnessResume,
      backendSessionId: harnessResume.backendSessionId ?? checkpoint.harnessResume.backendSessionId,
      resumePhase: harnessResume.resumePhase,
    }
  }
  await refreshAgentContextFromSession(options, state, refresh, (limits) => {
    void observeCodexAuthState(options.config, options.session.id, limits, state)
  })
  state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  refreshMetaEvents()
  state.monitorSnapshot = refreshMonitorSnapshot(options.config.stackDataRoot, options.session.id)
  syncMonitorRightPanel(state)
  await refreshThreadGoalStatus(options, state)
  applyGoalUiAfterSessionResume(state, checkpoint, options.session)
  syncGoalModeDefaults(options, state)
  syncSessionDisplayNameFromGoal(options, state)
  state.monitorWorkerTargetId = options.session.id
  rememberGardenerWorkerTarget(state, options.session.id)
  await refreshHistory()
}

function syncSessionDisplayNameFromGoal(options: StackAppOptions, state: AppState): void {
  if (options.session.displayName?.trim()) return
  const objective =
    state.metaThreadManifest?.active_goal?.objective?.trim() ?? state.goalContext.objective?.trim()
  if (!objective) return
  const displayName = sanitizeThreadDisplayName(objective)
  if (!displayName) return
  options.session.displayName = displayName
}

function persistStackResumeCheckpoint(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  shutdown?: StackAppShutdown,
): void {
  if (options.session.id === state.gardenerThreadId) return
  const backendSessionId =
    codexSessionHandle.session?.codexThreadId ?? options.session.codexThreadId
  if (backendSessionId) options.session.codexThreadId = backendSessionId
  const checkpoint = enrichResumeCheckpoint({
    checkpoint: {
      version: 1,
      savedAt: new Date().toISOString(),
      sessionId: options.session.id,
      metaThreadId: options.session.metaThreadId,
      segmentId: options.session.segmentId,
      codexThreadId: backendSessionId,
      harness: options.session.harness ?? (isCursorHarness(options.config) ? "cursor" : "codex"),
      codexTransport: state.codexTransport,
      goalShutterWorkerPeek: state.goalShutterWorkerPeek,
      focusMode: state.focusMode,
      displayName: options.session.displayName,
    },
    session: options.session,
    manifest: state.metaThreadManifest,
    transport: state.codexTransport,
    backendSessionId,
  })
  writeResumeCheckpointSync(options.config.stackDataRoot, checkpoint)
  const resumeCommand = resumeCommandFromCheckpoint(checkpoint)
  shutdown?.setShellMessage(resumeCommand)
}

function persistSessionOnExit(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  shutdown?: StackAppShutdown,
): void {
  try {
    syncSessionDisplayNameFromGoal(options, state)
    const payload = JSON.stringify(
      {
        ...options.session,
        codexModel: options.session.codexModel ?? harnessModel(options.config),
        usageSummary: options.session.usageSummary,
      },
      null,
      2,
    )
    const path = join(options.config.sessionLogDir, `${options.session.id}.json`)
    mkdirSync(options.config.sessionLogDir, { recursive: true })
    writeFileSync(`${path}`, `${payload}\n`, "utf8")
    state.lastSessionLogPath = path
    persistStackResumeCheckpoint(options, state, codexSessionHandle, shutdown)
  } catch {
    // best-effort on exit
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
  options.session.codexModel = session.codexModel
  options.session.harness = session.harness
  options.session.harnessModel = session.harnessModel
  options.session.metaThreadId = session.metaThreadId
  options.session.segmentId = session.segmentId
  options.session.segmentRole = session.segmentRole
  options.session.predecessorThreadId = session.predecessorThreadId
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
  state.goalShutterWorkerPeek = false
  state.goalShutterScrollOffset = 0
  state.goalShutterScrollPinned = true
  state.agentViewEnabled = false
  state.sidecarQueuedMessages = []
  state.sidecarChatInFlight = false
  state.sidecarDispatchRef = { current: Promise.resolve() }
  if (session.id === state.gardenerThreadId) {
    applyGardenerHarnessToConfig(options.config)
    state.talkToGardener = false
    state.monitorSnapshot = emptyMonitorSnapshot(options.config.stackDataRoot)
  } else {
    restoreSessionHarnessToConfig(options.config, session)
    state.talkToGardener = false
    rememberGardenerWorkerTarget(state, session.id)
    state.monitorWorkerTargetId = session.id
    state.monitorSnapshot = refreshMonitorSnapshot(options.config.stackDataRoot, session.id)
  }
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
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  submitOpts?: { transcriptPrompt?: string },
): Promise<void> {
  state.status = "running"
  state.spinnerFrame = 0
  state.lastUsage = undefined
  state.lastSteerHint = undefined
  state.currentTurnStartedAt = new Date().toISOString()
  state.liveThinkingText = isCursorHarness(options.config) ? "starting Cursor" : "starting Codex"
  state.agentScrollOffset = 0
  appendUserBlock(state.blocks, submitOpts?.transcriptPrompt ?? prompt)
  options.session.codexCommand = isCursorHarness(options.config)
    ? `${options.config.cursorCommand} agent acp`
    : state.codexTransport === "app-server"
      ? `${options.config.codexCommand} app-server`
      : `${options.config.codexCommand} ${options.config.codexArgs.join(" ")}`
  state.harnessCommand = isCursorHarness(options.config)
    ? options.config.cursorCommand
    : options.config.codexCommand
  refresh()

  const selectedFiles = options.workspace.files.filter((file) => file.selected)
  let refreshPending = false
  let monitorQueue: Promise<StackMonitorSnapshot | undefined> = Promise.resolve(undefined)
  const refreshIfScrollStable = () => {
    if (isRecentAgentScroll(state)) return
    if (refreshPending) return
    refreshPending = true
    queueMicrotask(() => {
      refreshPending = false
      if (!isRecentAgentScroll(state)) refresh()
    })
  }
  const queueMonitorRun = (input: Parameters<typeof runMonitorForNewEvents>[0]) => {
    state.monitorSnapshot = { ...state.monitorSnapshot, status: "running" }
    refreshIfScrollStable()
    monitorQueue = monitorQueue
      .catch(() => undefined)
      .then(() => runMonitorForNewEvents(input))
      .then((snapshot) => {
        state.monitorSnapshot = snapshot
        refreshMetaEvents()
        refreshIfScrollStable()
        scheduleSidecarIdleDrain(
          options,
          state,
          refresh,
          refreshHistory,
          refreshMetaEvents,
          state.sidecarDispatchRef,
        )
        const steerEvent = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
          .filter((event) => event.type === "monitor.steer")
          .at(-1)
        const steerMessage =
          steerEvent && typeof steerEvent.payload.message === "string" ? steerEvent.payload.message.trim() : ""
        if (steerMessage && codexSessionHandle.session) {
          void codexSessionHandle.session.trySteer(steerMessage).then((steered) => {
            if (steered) {
              state.lastSteerHint = "monitor-steer"
              appendStackBlock(state.blocks, "monitor steered primary (style/guidance)")
              refreshIfScrollStable()
            }
          })
        }
        return snapshot
      })
      .catch((error) => {
        appendStackBlock(state.blocks, `monitor error: ${errorMessage(error)}`)
        refreshIfScrollStable()
        return undefined
      })
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
      void refreshAgentContextFromThread(
        state,
        threadId,
        options.config.workspaceRoot,
        refreshIfScrollStable,
        (limits) => {
          void observeCodexAuthState(options.config, options.session.id, limits, state)
        },
      )
    },
    (rateLimits) => {
      state.codexRateLimits = rateLimits
      void observeCodexAuthState(options.config, options.session.id, rateLimits, state)
      refreshIfScrollStable()
    },
    (line) => {
      const coreEvents = recordCoreAgentEventsFromCodexLine({
        stackRoot: options.config.stackDataRoot,
        threadId: options.session.id,
        actorId: isCursorHarness(options.config) ? "primary_cursor" : "primary_codex",
        metaThreadId: options.session.metaThreadId,
        segmentId: options.session.segmentId,
      }, line)
      if (coreEvents.length > 0) {
        refreshMetaEvents()
        refreshIfScrollStable()
      }
      const triggerEvents = coreEvents.filter((event) =>
        event.type === "agent.tool.completed" || event.type === "agent.tool.failed" || event.type === "agent.error"
      )
      if (triggerEvents.length === 0) return
      if (isGardenerSession(options, state)) return
      queueMonitorRun({
        config: options.config,
        session: options.session,
        agentContext: state.agentContext,
        goalContext: state.goalContext,
        wakeReason: triggerEvents.some((event) => event.type === "agent.tool.failed")
          ? "tool_failed"
          : triggerEvents.some((event) => event.type === "agent.error")
            ? "error"
          : "tool_completed",
        triggerEventIds: triggerEvents.map((event) => event.event_id),
      })
    },
  )

  const runOneTurn = async (turnPrompt: string): Promise<StackCodexTurn> => {
    const harnessSession = codexSessionHandle.session
    if (harnessSession && state.codexTransport === "acp") {
      harnessSession.setOutputHandler(outputSink.write)
      return harnessSession.runTurn({
        config: options.config,
        userPrompt: turnPrompt,
        selectedFiles,
        priorTurns: options.session.turns,
      })
    }
    if (harnessSession && state.codexTransport === "app-server") {
      try {
        harnessSession.setOutputHandler(outputSink.write)
        return await runCodexAppServerTurn(
          {
            config: options.config,
            userPrompt: turnPrompt,
            selectedFiles,
            priorTurns: options.session.turns,
            onOutput: outputSink.write,
          },
          harnessSession as CodexAppServerSession,
        )
      } catch (error) {
        await harnessSession.close().catch(() => undefined)
        codexSessionHandle.session = undefined
        state.codexTransport = "exec"
        appendStackBlock(state.blocks, `app-server unavailable; using codex exec (${errorMessage(error)})`)
        refreshIfScrollStable()
      }
    }
    if (isCursorHarness(options.config)) {
      return {
        id: randomUUID(),
        prompt: turnPrompt,
        selectedPaths: selectedFiles.map((file) => file.path),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        exitCode: 1,
        stdout: "",
        stderr: "cursor acp session unavailable; ensure `cursor agent login` and retry",
      }
    }
    return runCodexTurn({
      config: options.config,
      userPrompt: turnPrompt,
      selectedFiles,
      priorTurns: options.session.turns,
      onOutput: outputSink.write,
    })
  }

  try {
    let turn = await runOneTurn(prompt)
    outputSink.flush()
    if (!outputSink.hasVisibleOutput) {
      appendStackBlock(state.blocks, "no visible response")
    }
    refresh()
    turn.usage = state.lastUsage ?? readUsageFromStdout(turn.stdout)
    if (turn.usage) state.lastUsage = turn.usage
    options.session.turns.push(turn)
    if (codexSessionHandle.session?.codexThreadId) {
      options.session.codexThreadId = codexSessionHandle.session.codexThreadId
    }
    refreshSessionThroughput(state, options.session.turns)
    await monitorQueue.catch(() => undefined)
    if (!isGardenerSession(options, state)) {
      state.monitorSnapshot = await runMonitorAfterTurn({
        config: options.config,
        session: options.session,
        turn,
        agentContext: state.agentContext,
        goalContext: state.goalContext,
      })
    }
    const gardenerResult = runGardenerAfterTurn({
      config: options.config,
      session: options.session,
      turn,
      workerStatus: turnExitIdle(turn.exitCode) ? "idle" : "error",
      goalContext: state.goalContext,
      workerQueueCount: state.queuedMessages.length,
      codexAccountEmail: state.codexAccountEmail,
      ...gardenerPassContext(options, state),
    })
    state.gardenerGardenPath = gardenerResult.gardenPath
    if (gardenerResult.frictions.length > 0) {
      appendStackBlock(state.blocks, `gardener: ${gardenerResult.frictions[0]}`)
    }
    refreshMetaEvents()
    void refreshGardenerMaintenance(options, state, "turn_completed")

    while (codexSessionHandle.session && codexSessionHandle.session.queueLength > 0) {
      const queuedPrompt = codexSessionHandle.session.takeQueuedPrompt()
      if (!queuedPrompt) break
      state.queuedMessages = state.queuedMessages.filter((entry) => entry !== queuedPrompt)
      appendUserBlock(state.blocks, queuedPrompt)
      appendStackBlock(state.blocks, "running queued message")
      refreshIfScrollStable()
      turn = await runOneTurn(queuedPrompt)
      outputSink.flush()
      turn.usage = state.lastUsage ?? readUsageFromStdout(turn.stdout)
      if (turn.usage) state.lastUsage = turn.usage
      options.session.turns.push(turn)
      refreshSessionThroughput(state, options.session.turns)
      await monitorQueue.catch(() => undefined)
      if (!isGardenerSession(options, state)) {
        state.monitorSnapshot = await runMonitorAfterTurn({
          config: options.config,
          session: options.session,
          turn,
          agentContext: state.agentContext,
          goalContext: state.goalContext,
        })
      }
      const gardenerQueued = runGardenerAfterTurn({
        config: options.config,
        session: options.session,
        turn,
        workerStatus: turnExitIdle(turn.exitCode) ? "idle" : "error",
        goalContext: state.goalContext,
        workerQueueCount: state.queuedMessages.length,
        codexAccountEmail: state.codexAccountEmail,
        ...gardenerPassContext(options, state),
      })
      state.gardenerGardenPath = gardenerQueued.gardenPath
      refreshMetaEvents()
    }

    while (state.gardenerWorkerQueue.length > 0) {
      const gardenerPrompt = state.gardenerWorkerQueue.shift()
      if (!gardenerPrompt) break
      appendUserBlock(state.blocks, `[gardener→worker] ${gardenerPrompt}`)
      appendStackBlock(state.blocks, "running gardener-routed message")
      refreshIfScrollStable()
      turn = await runOneTurn(gardenerPrompt)
      outputSink.flush()
      turn.usage = state.lastUsage ?? readUsageFromStdout(turn.stdout)
      if (turn.usage) state.lastUsage = turn.usage
      options.session.turns.push(turn)
      refreshSessionThroughput(state, options.session.turns)
      await monitorQueue.catch(() => undefined)
      state.monitorSnapshot = await runMonitorAfterTurn({
        config: options.config,
        session: options.session,
        turn,
        agentContext: state.agentContext,
        goalContext: state.goalContext,
      })
      const gardenerFollowUp = runGardenerAfterTurn({
        config: options.config,
        session: options.session,
        turn,
        workerStatus: turnExitIdle(turn.exitCode) ? "idle" : "error",
        goalContext: state.goalContext,
        workerQueueCount: state.queuedMessages.length,
        codexAccountEmail: state.codexAccountEmail,
        ...gardenerPassContext(options, state),
      })
      state.gardenerGardenPath = gardenerFollowUp.gardenPath
      refreshMetaEvents()
    }

    state.status = turnExitIdle(turn.exitCode) ? "idle" : "error"
    state.liveThinkingText = undefined
    state.liveThinkingId = undefined
    state.turnStartedAt = undefined
    state.currentTurnStartedAt = undefined
    state.queuedMessages = []
    state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir, {
      codexModel: harnessModel(options.config),
      pricingRows: options.config.codexPricing,
    })
    await refreshAgentContextFromSession(options, state, refreshIfScrollStable, (limits) => {
      void observeCodexAuthState(options.config, options.session.id, limits, state)
    })
    refreshMetaEvents()
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
      codexModel: harnessModel(options.config),
      pricingRows: options.config.codexPricing,
    })
    refreshMetaEvents()
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

function nextFocusMode(current: FocusMode, mode: LiveOpsMode, config: StackConfig): FocusMode {
  const order = focusOrderForConfig(config, mode)
  const index = order.indexOf(current)
  if (index < 0) return order[0] ?? "agent"
  return order[(index + 1) % order.length] ?? "agent"
}

function focusOrderForConfig(config: StackConfig, mode: LiveOpsMode): FocusMode[] {
  const order = focusOrderForLiveOpsMode(mode)
  if (!isCursorHarness(config)) return order
  return order.filter((focus) => !CURSOR_EXCLUDED_FOCUS.has(focus))
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
