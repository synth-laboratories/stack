import {
  Box,
  clearEnvCache,
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
import { applyUpdate, checkUpdate, type UpdateCheckReport } from "../update.js"
import {
  buildPermissionsPanelRows,
  permissionsDraftFromTiers,
  permissionsNeedsReminder,
  permissionsToStackdConfig,
  setPermissionsGrantAll,
  PERMISSIONS_REMINDER,
  type PermissionsDraft,
} from "./permissions-panel.js"
import {
  telemetryKeyFromRawModalChunk,
  telemetryKeyFromRawSequence,
  telemetryModalCapturesRawInput,
} from "./telemetry-input.js"
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
import { appendFileSync, existsSync, mkdirSync, readFileSync as nodeReadFileSync, statSync as nodeStatSync, writeFileSync, type Stats } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, relative, resolve, join } from "node:path"
import {
  CODEX_MODEL_OPTIONS,
  CURSOR_MODEL_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
  CURSOR_REASONING_EFFORT_OPTIONS,
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
  writeStackConfigPatch,
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
  mergeGoalContext,
  parseGoalFromCodexJsonLine,
  readGoalFromSession,
  type CodexGoalSnapshot,
} from "../codex/goal-context.js"
import { agentGoalPreviewLineCount, agentPanelChromeRows, renderAgentGoalPreviewStyled } from "./goal-preview.js"
import {
  mergeMetaThreadGoalContext,
  readMetaThreadManifest,
  reconcileMetaThreadGoalFromCodex,
} from "../meta-thread-goal.js"
import { auditEffort, bindEffortMetaThread, createEffort, effortArtifactInventory, listEfforts, listEffortTemplates, readEffort, readEffortAcceptancePacket, readEffortBenchmarkSummaries, readEffortOpenBlockerTail, readEffortOptimizerCandidateSummaries, readEffortRemainingWork, readEffortRunEvidenceSummaries, updateEffortStatus, writeEffortHandoff, type StackEffortBenchmarkSummary, type StackEffortOptimizerCandidateSummary, type StackEffortRunEvidenceSummary, type StackEffortSummary } from "../effort.js"
import { readLatestArtifacts, type StackArtifactManifestEntry } from "../artifacts.js"
import { stackdUpdateMetaThreadEffortRef, type StackdMetaSidePanel, type StackdMetaStatus, type StackdMetaThreadManifest } from "../client/stackd.js"
import {
  formatCodexBudgetSuffix,
  formatCodexRateLimitsCardLines,
  readCodexRateLimits,
  readCodexRateLimitsFromSession,
  readLatestCodexRateLimits,
  type CodexRateLimitsSnapshot,
} from "../codex/rate-limits.js"
import { isChatGptAuthPlan, readCodexAccountSnapshot } from "../codex/account.js"
import {
  formatAccountTokenTotal,
  formatCodexUsageActivityLines,
  readCodexAccountUsage,
  type CodexAccountUsageSnapshot,
} from "../codex/account-usage.js"
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
  executeGardenerThreadLifecycle,
  resolveGardenerArchiveTargets,
  type GardenerThreadArchiveCandidate,
} from "../gardener-lifecycle.js"
import {
  STACK_PROFILE_DEFAULTS,
  nextStackProfile,
  normalizeStackProfileName,
  readStackProfile,
  writeStackProfile,
  type StackProfileName,
} from "../operator-profile.js"
import {
  readStackUxSettings,
  rightPanelFractionFromMouseX,
  type LightsPanelSectionId,
  writeStackUxSettings,
} from "../ux-settings.js"
import {
  lightsThreadViewDiskUpdatedAtMs,
  markLightsThreadsUnviewed,
  markLightsThreadsViewed,
  readLightsThreadViewState,
  resolveLightsThreadViewTargets,
} from "../lights-thread-view.js"
import { captureStackPapercut, type StackPapercutContext } from "../papercut-capture.js"
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
  formatTokenTotal,
  sessionTokenTotal,
} from "../codex/usage-cost.js"
import { formatGoalCompute } from "../codex/goal-context.js"
import { reduceGoalSessionSnapshot, type GoalSessionSnapshot } from "../goal-session.js"
import {
  emptyMonitorSnapshot,
  cycleMonitorMode,
  monitorRailLines,
  refreshMonitorSnapshot,
  runMonitorAfterTurn,
  runMonitorAfterOperatorMessage,
  runGoalMonitorCadenceTick,
  runMonitorForNewEvents,
  setMonitorEnabled,
  isExplicitMonitorPrefix,
  stripMonitorMessagePrefix,
  type StackMonitorSnapshot,
} from "../monitor.js"
import { readMonitorSidecarTranscript } from "../monitor-sidecar-codex.js"
import { parseChannelInput } from "../image-input.js"
import { recordCoreAgentEventsFromCodexLine } from "../core-agent-events.js"
import { startVoiceRecording, type VoiceRecordingHandle } from "../voice/recording.js"
import { isLikelyJunkVoiceTranscript, MIN_VOICE_HOLD_MS, voiceHoldElapsedMs } from "../voice/hold.js"
import {
  isVoiceHoldKeyPress,
  isVoiceHoldKeyRelease,
  shouldDeferRawSequenceForVoiceHold,
} from "../voice/keys.js"
import { transcribeAudio, voiceSttConfigFromStack } from "../voice/providers/resolve.js"
import {
  readVoiceStatus,
  voiceInputHintLine,
  type VoiceInputTarget,
  type VoiceStatusSnapshot,
} from "../voice/status.js"
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
  prepareTerminalForTui,
  type StackAppShutdown,
  registerFatalProcessHandlers,
  registerRendererShutdown,
} from "./terminal-cleanup.js"
import { createRemountCoordinator } from "./remount-coordinator.js"
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
  executeRemoteFactoryAction,
  executeRemoteRunAction,
  openUrlInSystemBrowser,
  previewRemoteOutput,
  previewSavedRemoteDownload,
  previewRemoteFactoryWakeDue,
  readRemoteDownloadHistory,
  sendRemoteFactoryMessage,
  sendRemoteRunMessage,
  uploadRemoteRunFile,
  wakeRemoteFactoryDue,
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
import { hostedOptimizerWatchLines } from "./hosted-watch.js"
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
  type RemoteSyncSnapshot,
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
  stackdGardenerPassComplete,
  stackdFlushTelemetryEvents,
  stackdRuntimeAppendEvent,
  stackdRuntimeFactory,
  stackdMetaStatus,
  stackdTelemetryStatus,
  stackdThreads,
  stackdUpdateTelemetryConfig,
  type StackdFactorySnapshot,
  type StackdRuntimeEventAppendRequest,
  type StackdTelemetryStatus,
  type StackdThreadSummary,
} from "../client/stackd.js"
import { appendThreadMetaEvent, latestForHumanMonitorHeadline, readThreadMetaEvents, stackEventId, type StackThreadMetaEvent } from "../thread-events.js"
import { isUiPanelId, type UiPanelId } from "../ui/vocabulary.js"
import {
  resolveThreadDisplayLabel,
  sanitizeThreadDisplayName,
  threadResumeHint,
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
import {
  estimateShortTranscriptLines,
  transcriptPaneFlexGrowForContent,
  transcriptViewportForEstimatedContent,
} from "./transcript-layout.js"
import { readRolloutTranscript, readRolloutTranscriptWithRetry } from "./rollout-transcript.js"
import type { SubagentLog } from "./subagents.js"
import { subagentDisplayName, subagentStatusLabel, upsertSubagentLog } from "./subagents.js"
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
  synthUsageSlashLines,
  type OpsPanelAgentUsage,
  type OpsPanelMetaEvent,
  type RightPanelMode,
} from "./ops-panel.js"
import { renderThreadsRailStyled } from "./threads-rail.js"
import {
  buildMonitorSidecarChatBlocks,
  sidecarThreadRenderedLineCount,
  monitorEventStreamLineCount,
  renderMonitorEventStreamStyled,
} from "./monitor-thread.js"
import {
  existingMonitorInterventionEventIds,
  formatMonitorQueuedFeedText,
  formatMonitorSteerFeedText,
  undeliveredMonitorInterventions,
} from "./monitor-worker-feed.js"
import { activeGoalModeSnapshot, hasGoalContext, isGoalMode, showWorkerGoalTabs } from "./goal-mode.js"
import { goalHistoryEntryKey, listGoalHistory } from "../goal-session.js"
import { goalShutterLineCount, renderSidecarChatInputStyled, renderMonitorGoalViewPanel, renderPreviousGoalsListPanel, renderPanelTabBar, monitorGoalViewMaxScroll, previousGoalsListMaxScroll, type MonitorGoalViewInput } from "./goal-shutter.js"
import { setCrashRuntimeContext } from "../telemetry/crash-report.js"
import { emitFeatureUsed } from "../telemetry/funnel.js"
import { agentInputRenderedLineCount, renderWorkerAgentInputStyled } from "./agent-input.js"
import { agentChatPauseEligible } from "./agent-chat-pause.js"
import { sidecarAgentActive } from "./sidecar-queue.js"
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
  parseSlashCommand,
  navigateSlashMenu,
  renderSlashCommandMenuStyled,
  resolveSlashSubmitPrompt,
  selectedSlashCommandSpec,
  slashMenuQuery,
  slashMenuVisible,
  clampSlashMenuIndex,
  parseUsageSlashView,
  type SlashCommandContext,
  type SlashDispatchHooks,
  type UsageSlashView,
} from "./slash-commands.js"
import { runGoalSlashCommand, runGoalPanelAction, refreshGoalPanelState } from "./goal-slash-dispatch.js"

function readFileSync(path: string, encoding: BufferEncoding): string {
  return retryEintr(() => nodeReadFileSync(path, encoding))
}

function statSync(path: string): Stats {
  return retryEintr(() => nodeStatSync(path))
}

function retryEintr<T>(operation: () => T): T {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return operation()
    } catch (error) {
      if (!isEintrError(error)) throw error
      lastError = error
    }
  }
  throw lastError
}

function isEintrError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EINTR"
}
import { buildGoalWorkerKickoffPrompt, goalKickoffTranscriptLabel, harnessGoalPayloadFromManifest } from "../harness/goal-notify.js"
import { navigateGoalPanelSelection, openGoalPanel, renderGoalPanel } from "./goal-panel.js"
import {
  buildGardenerChatTranscript,
  blocksFromMonitorChatEvents,
  gardenerTranscriptRenderOptions,
  mergeRoleChatBlocks,
  monitorTranscriptRenderOptions,
  renderRoleChatTranscriptStyled,
  type GardenerChatTranscript,
} from "./role-chat-transcript.js"
import {
  gardenerEventStreamLineCount,
  type GardenerThreadContext,
} from "./gardener-thread.js"
import {
  activeThreadRows,
  type ActiveThreadsRenderInput,
  activeThreadsFocusHint,
  coreEventStreamLineCount,
  renderActiveProjectsStyled,
  renderCoreEventStreamStyled,
  resolveActiveThreadIds,
  resolveCoreEventStreamContext,
  resolveVisibleThreadIds,
  styleActiveThreadRowStyled,
  type ThreadLifecycleStatus,
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
  | "config"
  | "monitor"
  | "gardener"
  | "harness"
  | "environment"
  | "account"
  | "telemetry"
  | "ops"
  | "experimental"
  | "optimizers"
  | "hosted"
  | "remote"
  | "projects"
  | "history"
  | "lights-filter"
type WorkMode = "eng" | "research"
type HarnessSession = CodexAppServerSession | CursorAcpSession
type LiveOpsMode = "local" | "remote"
type MonitorPanelMode = "chat" | "events"
type WorkerPanelView = "chat" | "goal"
type GardenerPanelMode = "chat" | "events"
type RightPanelContent = "default" | "gardener" | "threads" | "experimental" | "lights" | "efforts"

type LightsPanelSection = {
  id: LightsPanelSectionId
  header: string
  lines: string[]
  threadIds?: Array<string | undefined>
  threadRowKinds?: Array<LightsThreadPanelRowKind | undefined>
}

type LightsThreadPanelRowKind = "primary" | "detail" | "view" | "unview"

type ThreadGoalLightsMetrics = {
  status: ThreadGoalStatus
  elapsedLabel?: string
  usageLabel?: string
}

type ThreadLightsPreview = {
  headline?: string
  note?: string
  objective?: string
  workerState?: string
}
type HostedOptimizerActionKind = "cancel-run" | "preview-artifact" | "download-artifact"
type MediationTargetKind = "remote-run" | "factory" | "hosted-optimizer"
type LiveActionKind = RemoteActionKind
type EvalFeedbackKind = "note" | "directive" | "complaint" | "hypothesis" | "correction" | "taste"

const EVAL_FEEDBACK_KINDS: EvalFeedbackKind[] = [
  "note",
  "directive",
  "complaint",
  "hypothesis",
  "correction",
  "taste",
]

type EvalUiHandleSettings = {
  evalModeEnabled: boolean
  uiHandleEnabled: boolean
  voiceInputEnabled: boolean
  humanInputFile?: string
}

export type StackAppOptions = {
  config: StackConfig
  workspace: WorkspaceInfo
  session: StackLocalSession
  resumeCheckpoint?: StackResumeCheckpoint
  resumeManifest?: StackdMetaThreadManifest
}

type AppState = {
  focusMode: FocusMode
  workMode: WorkMode
  liveOpsMode: LiveOpsMode
  /** Agent Bridge + session detail panels (right). Threads rail stays visible. */
  railsVisible: boolean
  leftPanelOpen: boolean
  leftPanelRailsVisible: boolean
  rightPanelOpen: boolean
  rightPanelContent: RightPanelContent
  rightPanelWidthFraction: number
  rightPanelResizeDragging: boolean
  showDetails: boolean
  expandedBlockIds: Set<string>
  selectedToolIndex: number
  selectedHistoryIndex: number
  selectedProjectIndex: number
  agentScrollOffset: number
  lastAgentScrollAt?: number
  status: "idle" | "running" | "error"
  /** Esc once during a worker turn: scroll/draft without stopping the turn. Esc again stops it. */
  agentChatPaused: boolean
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
  configSelectedIndex: number
  configNotice?: string
  rawCommandTail: string
  sidecarQueuedMessages: string[]
  sidecarChatInFlight: boolean
  sidecarDispatchRef: { current: Promise<void> }
  gardenerInputBuffer: string
  slashMenuIndex: number
  goalPanelSelectedIndex: number
  goalShutterSidecarView: "thread" | "events"
  goalShutterSidecarThreadScrollOffset: number
  goalShutterSidecarThreadScrollPinned: boolean
  goalShutterScrollOffset: number
  goalShutterScrollPinned: boolean
  previousGoalExpandedKeys: Set<string>
  previousGoalSelectedIndex: number
  goalMonitorAutoEnabledObjective?: string
  pasteAccumulator?: string
  toolLogs: ToolLog[]
  subagentLogs: SubagentLog[]
  history: StackSessionSummary[]
  threadGoalStatus: Map<string, ThreadGoalStatus>
  threadGoalMetrics: Map<string, ThreadGoalLightsMetrics>
  threadLifecycleStatus: Map<string, ThreadLifecycleStatus>
  threadMetaThreadIds: Map<string, string>
  threadMetaThreadTitles: Map<string, string>
  threadLightsPreviews: Map<string, ThreadLightsPreview>
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
  workerPanelView: WorkerPanelView
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
  selectedEffortIndex: number
  lightsThreadScrollOffset: number
  lightsThreadFilter: string
  lightsSelectedThreadId?: string
  lightsViewedThreadIds: Set<string>
  lightsFilterReturnFocus: FocusMode
  lightsCollapsedSections: Set<LightsPanelSectionId>
  lightsThreadsOnly: boolean
  monitorScrollOffset: number
  monitorScrollPinned: boolean
  monitorEventScrollOffset: number
  monitorEventScrollPinned: boolean
  monitorWatchScrollOffset: number
  monitorWatchScrollPinned: boolean
  hostedOptimizerSnapshot: HostedOptimizerSnapshot
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
  updateCheck?: UpdateCheckReport
  updateChecking?: boolean
  updateApplying?: boolean
  updateNotice?: string
  telemetryStatus?: StackdTelemetryStatus
  telemetryNotice?: string
  permissionsDraft: PermissionsDraft
  permissionsSelectedIndex: number
  goalContext: CodexGoalSnapshot
  metaThreadManifest?: StackdMetaThreadManifest
  agentViewEnabled: boolean
  planningColumns: number
  codexTransport: "app-server" | "exec" | "acp"
  queuedMessages: string[]
  activeTurnPromise?: Promise<void>
  abortTurnLoop?: boolean
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
  voiceRecordingTarget?: VoiceInputTarget
  voiceLastCandidatePressAtMs?: number
  voiceSuppressStartUntilMs?: number
  evalModeEnabled: boolean
  evalUiHandleEnabled: boolean
  evalVoiceInputEnabled: boolean
  evalHumanInputFile?: string
  evalModalOpen: boolean
  evalModalBuffer: string
  evalModalKind: EvalFeedbackKind
  evalModalVoiceUsed: boolean
  evalModalNotice?: string
  gardenerNotice?: string
  monitorNotice?: string
  gardenerChatRunning: boolean
  gardenerChatStartedAt?: string
  gardenerQueuedMessages: string[]
  gardenerLiveBlocks: TranscriptBlock[]
  gardenerLiveTools: ToolLog[]
  gardenerLiveSubagents: SubagentLog[]
  gardenerLiveThinking?: string
  workerHarnessSnapshot?: WorkerHarnessSnapshot
  lastSteerHint?: string
  monitorFeedDeliveredEventIds: Set<string>
  monitorCadenceInFlight?: boolean
  lastMonitorCadenceCheckAt?: number
  monitorSnapshot: StackMonitorSnapshot
  metaEvents: StackThreadMetaEvent[]
  appliedStackdSidePanelKey?: string
  appliedStackdLightsPanelByThread: Map<string, string>
  lastOperatorSidePanelClosedAtMs?: number
}

type MountedView = {
  root: ReturnType<typeof Box>
}

let stackRootInstance = 0

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
  x?: number
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

function isLightsPanelOpen(state: AppState): boolean {
  return state.rightPanelOpen && state.rightPanelContent === "lights"
}

function closeSidePanelsForGardenerFocus(state: AppState): void {
  state.leftPanelOpen = false
  if (!isLightsPanelOpen(state)) {
    state.rightPanelOpen = false
  }
}

function applySidePanelFocus(state: AppState, focusMode: FocusMode): void {
  state.focusMode = focusMode
  if (focusMode === "history" || focusMode === "harness" || focusMode === "projects") {
    return
  }
  if (focusMode === "gardener") {
    closeSidePanelsForGardenerFocus(state)
    return
  }
  if (focusMode === "ops" || focusMode === "optimizers" || focusMode === "hosted" || focusMode === "remote") {
    state.rightPanelOpen = true
    state.rightPanelContent = "default"
    return
  }
  if (focusMode === "monitor") {
    state.rightPanelOpen = true
    state.rightPanelContent = "default"
    return
  }
}

function closeSelectorPanel(state: AppState): boolean {
  if (!isSelectorPanelFocusMode(state.focusMode)) return false
  state.focusMode = "agent"
  state.configNotice = undefined
  state.slashMenuIndex = 0
  return true
}

function isSelectorPanelFocusMode(focusMode: FocusMode): boolean {
  return (
    focusMode === "model" ||
    focusMode === "effort" ||
    focusMode === "subagent-model" ||
    focusMode === "subagent-effort" ||
    focusMode === "subagents" ||
    focusMode === "environment" ||
    focusMode === "account" ||
    focusMode === "config" ||
    focusMode === "experimental"
  )
}

function syncGardenerLeftPanel(state: AppState): void {
  closeSidePanelsForGardenerFocus(state)
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
    state.rightPanelContent = "default"
    state.focusMode = state.rightPanelOpsVisible ? "ops" : "monitor"
    state.opsScrollOffset = 0
    return
  }
  toggleRightPanelMode(state)
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
  "config",
  "monitor",
  "environment",
  "account",
  "telemetry",
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
  const telemetrySnapshot = await stackdTelemetryStatus().catch(() => undefined)
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
  const initialMetaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  const uxSettings = readStackUxSettings(options.config.stackDataRoot)
  const lightsViewState = readLightsThreadViewState(options.config.stackDataRoot)
  const evalUiHandleSettings = readEvalUiHandleSettings()
  const state: AppState = {
    // First-launch approval must own key focus: with the agent input focused, printable
    // keys never reach the global telemetry key handler, so the modal's a/d/l keys go dead.
    focusMode: "agent",
    workMode: "eng",
    liveOpsMode: "local",
    railsVisible: false,
    leftPanelOpen: false,
    leftPanelRailsVisible: false,
    rightPanelOpen: uxSettings.lightsPanelOpen,
    rightPanelContent: uxSettings.lightsPanelOpen ? "lights" : "default",
    rightPanelWidthFraction: uxSettings.rightPanelWidthFraction,
    rightPanelResizeDragging: false,
    showDetails: false,
    expandedBlockIds: new Set<string>(),
    selectedToolIndex: 0,
    selectedHistoryIndex: 0,
    selectedProjectIndex: 0,
    agentScrollOffset: 0,
    status: "idle",
    agentChatPaused: false,
    spinnerFrame: 0,
    emaTokensPerSecond: seedEmaFromTurns(options.session.turns),
    blocks: [],
    inputBuffer: readInitialPrompt(options.config),
    monitorInputBuffer: "",
    configSelectedIndex: 0,
    rawCommandTail: "",
    sidecarQueuedMessages: [],
    sidecarChatInFlight: false,
    sidecarDispatchRef: { current: Promise.resolve() },
    gardenerInputBuffer: "",
    slashMenuIndex: 0,
    goalPanelSelectedIndex: 0,
    goalShutterSidecarView: "events",
    goalShutterSidecarThreadScrollOffset: 0,
    goalShutterSidecarThreadScrollPinned: true,
    goalShutterScrollOffset: 0,
    goalShutterScrollPinned: true,
    previousGoalExpandedKeys: new Set<string>(),
    previousGoalSelectedIndex: 0,
    toolLogs: [],
    subagentLogs: [],
    history,
    threadGoalStatus: new Map(),
    threadGoalMetrics: new Map(),
    threadLifecycleStatus: new Map(),
    threadMetaThreadIds: new Map(),
    threadMetaThreadTitles: new Map(),
    threadLightsPreviews: new Map(),
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
    workerPanelView: "chat",
    gardenerPanelMode: "chat",
    leftPanelMode: "threads",
    leftPanelScrollOffset: 0,
    gardenerScrollOffset: 0,
    gardenerScrollPinned: true,
    gardenerEventScrollOffset: 0,
    gardenerEventScrollPinned: true,
    opsScrollOffset: 0,
    selectedEffortIndex: 0,
    lightsThreadScrollOffset: 0,
    lightsThreadFilter: "",
    lightsSelectedThreadId: lightsViewState.selectedThreadId,
    lightsViewedThreadIds: new Set(lightsViewState.viewedThreadIds),
    appliedStackdLightsPanelByThread: new Map(),
    lightsFilterReturnFocus: "gardener",
    lightsCollapsedSections: new Set(uxSettings.lightsCollapsedSections),
    lightsThreadsOnly: uxSettings.lightsThreadsOnly,
    monitorScrollOffset: 0,
    monitorScrollPinned: true,
    monitorEventScrollOffset: 0,
    monitorEventScrollPinned: true,
    monitorWatchScrollOffset: 0,
    monitorWatchScrollPinned: true,
    hostedOptimizerSnapshot,
    recentRemoteDownloads,
    selectedRemoteJobIndex: 0,
    selectedRemoteFactoryIndex: 0,
    selectedRemoteOutputIndex: 0,
    selectedHostedOptimizerRunIndex: 0,
    selectedHostedOptimizerArtifactIndex: 0,
    mediationTargetKind: "remote-run",
    agentContext: emptyAgentContext(options.config.workspaceRoot),
    telemetryStatus: telemetrySnapshot,
    permissionsDraft: permissionsDraftFromTiers(telemetrySnapshot?.tiers),
    permissionsSelectedIndex: 0,
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
    updateChecking: false,
    updateApplying: false,
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
    evalModeEnabled: evalUiHandleSettings.evalModeEnabled,
    evalUiHandleEnabled: evalUiHandleSettings.uiHandleEnabled,
    evalVoiceInputEnabled: evalUiHandleSettings.voiceInputEnabled,
    evalHumanInputFile: evalUiHandleSettings.humanInputFile,
    evalModalOpen: false,
    evalModalBuffer: "",
    evalModalKind: "note",
    evalModalVoiceUsed: false,
    gardenerChatRunning: false,
    gardenerQueuedMessages: [],
    gardenerLiveBlocks: [],
    gardenerLiveTools: [],
    gardenerLiveSubagents: [],
    monitorSnapshot: refreshMonitorSnapshot(options.config.stackDataRoot, options.session.id),
    metaEvents: initialMetaEvents,
    monitorFeedDeliveredEventIds: existingMonitorInterventionEventIds(initialMetaEvents),
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
  if (options.resumeCheckpoint) {
    applyStackCliResumeUi(options, state, options.session.id)
  }
  if (state.focusMode === "gardener") syncGardenerLeftPanel(state)
  syncMonitorRightPanel(state)
  state.rightPanelOpsVisible = !isMonitorOn(state.monitorSnapshot)
  let codexSessionHandle: { session?: HarnessSession } = {}
  if (options.session.id === gardenerEnsured.threadId) {
    applyGardenerHarnessToConfig(options.config)
  }
  await openHarnessSession(options, state, codexSessionHandle, options.session.codexThreadId, { probe: true })
  refreshSessionThroughput(state, options.session.turns)
  const currentThreadIndex = state.history.findIndex((summary) => summary.id === options.session.id)
  state.selectedHistoryIndex =
    currentThreadIndex >= 0 ? currentThreadIndex : clampIndex(state.selectedHistoryIndex, state.history.length)

  let view: MountedView | undefined
  const remountCoordinator = createRemountCoordinator()
  let remount = () => remountCoordinator.remountNow()
  let scheduleRemount = () => remountCoordinator.scheduleRemount()
  let scheduleRender = () => remountCoordinator.scheduleRender()

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

  let metaStatusPollInFlight = false
  const refreshStackdMetaStatusUi = async () => {
    if (metaStatusPollInFlight) return
    metaStatusPollInFlight = true
    try {
      const status = await stackdMetaStatus()
      let changed = applyStackdThreadPreviews(state, status)
      if (applyStackdSidePanelSnapshot(options, state, status)) changed = true
      if (changed) scheduleRemount()
    } catch {
      // stackd is optional for local TUI use; side-panel projection stays local-only.
    } finally {
      metaStatusPollInFlight = false
    }
  }

  let spinnerInterval: ReturnType<typeof setInterval> | undefined
  let metaStatusInterval: ReturnType<typeof setInterval> | undefined
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
    if (handleEvalFeedbackSlash(prompt, state, remount)) {
      state.inputBuffer = ""
      state.slashMenuIndex = 0
      return true
    }
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
          refreshCodexRateLimits,
          refreshRemoteAccount,
          refreshRemoteUsage,
        ),
      )
    ) {
      recordSlashFeatureUsage()
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
          refreshCodexRateLimits,
          refreshRemoteAccount,
          refreshRemoteUsage,
        ),
      )
    ) {
      recordSlashFeatureUsage()
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

  const submitFromGardenerInput = (key?: StackKeyEvent, forceQueue = false): boolean => {
    if (!view) return false
    const hasGardenerDraft = state.gardenerInputBuffer.trim().length > 0
    if (state.focusMode !== "gardener" && !hasGardenerDraft) return false
    if (state.focusMode !== "gardener" && hasGardenerDraft) {
      state.focusMode = "gardener"
    }
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
          refreshCodexRateLimits,
          refreshRemoteAccount,
          refreshRemoteUsage,
          "gardener",
        ),
      )
    ) {
      recordSlashFeatureUsage()
      state.gardenerInputBuffer = ""
      state.slashMenuIndex = 0
      return true
    }
    if (state.gardenerChatRunning && !forceQueue && !shouldRunGardenerSubmitImmediatelyWhileRunning(prompt)) {
      queueGardenerSubmit(state, prompt, remount)
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

  const shutdown = createStackAppShutdown()
  const exitStack = () => shutdown.run(0)

  let renderer: CliRenderer
  prepareTerminalForTui()
  process.env.OTUI_USE_ALTERNATE_SCREEN = "true"
  clearEnvCache()
  renderer = await createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    externalOutputMode: "passthrough",
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
          exitStack,
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
  remountCoordinator.bind({
    mount: () => {
      view = mountView(renderer, options, state, view)
    },
    render: () => {
      view?.root.requestRender()
    },
  })
  remount = () => remountCoordinator.remountNow()
  scheduleRemount = () => remountCoordinator.scheduleRemount()
  scheduleRender = () => remountCoordinator.scheduleRender()

  view = mountView(renderer, options, state, undefined)
  void refreshStackUpdateStatus(options, state, scheduleRemount)

  if (options.config.autoSubmitInitialPrompt && state.inputBuffer.trim().length > 0) {
    const prompt = state.inputBuffer.trim()
    state.focusMode = "agent"
    submitInputValue(prompt, options, state, codexSessionHandle, renderer, remount, refreshHistory, refreshMetaEvents)
    state.slashMenuIndex = 0
    remount()
  }

  if (!tuiSmokeAutomationDisabled()) {
    void refreshGardenerMaintenance(options, state, "manual").finally(scheduleRemount)
  }

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
        if (shouldContinueInterruptedTurnAfterResume(options.resumeCheckpoint, state)) {
          appendStackBlock(state.blocks, "resuming interrupted worker turn from checkpoint")
          trackActiveTurn(
            state,
            submitPrompt(
              interruptedTurnResumePrompt(options.resumeCheckpoint, state),
              options,
              state,
              codexSessionHandle,
              renderer,
              remount,
              refreshHistory,
              refreshMetaEvents,
              { transcriptPrompt: "(resume interrupted worker turn)" },
            ),
          )
        }
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

  spinnerInterval = setInterval(() => {
    if (!isTranscriptSpinnerActive(state)) return
    state.spinnerFrame += 1
    if (state.gardenerChatRunning) syncGardenerLiveThinkingBlock(state)
    const now = Date.now()
    if (
      isGoalMode(state) &&
      !isGardenerSession(options, state) &&
      !state.monitorCadenceInFlight &&
      now - (state.lastMonitorCadenceCheckAt ?? 0) >= 5_000
    ) {
      state.lastMonitorCadenceCheckAt = now
      state.monitorCadenceInFlight = true
      void runGoalMonitorCadenceTick({
        config: options.config,
        session: options.session,
        agentContext: state.agentContext,
        goalContext: mergeMetaThreadGoalContext(state.goalContext, state.metaThreadManifest),
      })
        .then((snapshot) => {
          if (snapshot) {
            state.monitorSnapshot = snapshot
            refreshMetaEvents()
          }
        })
        .catch((error) => {
          appendStackBlock(state.blocks, `monitor cadence error: ${errorMessage(error)}`)
        })
        .finally(() => {
          state.monitorCadenceInFlight = false
          scheduleRemount()
        })
    }
    if (isRecentAgentScroll(state)) return
    scheduleRender()
  }, 120)

  optimizerInterval = setInterval(() => {
    void refreshOptimizers().finally(scheduleRemount)
  }, 2500)

  const projectsInterval = setInterval(() => {
    if (state.remoteAccountSnapshot.status !== "connected") return
    void refreshRemoteOpsPanel().finally(scheduleRemount)
  }, 20_000)

  void refreshCodexRateLimits().finally(scheduleRemount)
  rateLimitsInterval = setInterval(() => {
    void refreshCodexRateLimits().finally(scheduleRemount)
  }, 120_000)

  void refreshStackdMetaStatusUi()
  metaStatusInterval = setInterval(() => {
    void refreshStackdMetaStatusUi()
  }, 1_000)

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
  registerRendererShutdown(
    shutdown,
    renderer,
    [spinnerInterval, metaStatusInterval, optimizerInterval, projectsInterval, rateLimitsInterval],
    [
      () => {
        remountCoordinator.dispose()
      },
      () => {
        void codexSessionHandle.session?.close()
      },
    ],
  )

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
    if (
      state.evalModalOpen &&
      (isEnterKey(key) || key.name === "escape" || key.name === "tab" || /^[1-6]$/.test(key.name ?? "")) &&
      handleEvalFeedbackKey(key, options, state, remount)
    ) {
      return
    }
    if (isEnterKey(key) && key.ctrl && state.focusMode === "agent") {
      submitFromCurrentInput(key, true)
      return
    }

    if (isEnterKey(key) && submitFromCurrentInput(key)) return
  })

  const handleVoiceKeyEvent = (key: StackKeyEvent, kind: "press" | "release") => {
    if (handleVoiceKey(key, kind, voiceKeyContext())) return true
    return false
  }

  renderer._internalKeyInput.onInternal("keyrelease", (key: StackKeyEvent) => {
    handleVoiceKeyEvent(key, "release")
  })

  renderer.keyInput.on("keyrelease", (key: StackKeyEvent) => {
    handleVoiceKeyEvent(key, "release")
  })

  renderer.keyInput.on("keypress", (key: StackKeyEvent) => {
    if (key.ctrl && key.name === "c") {
      appendStackBlock(state.blocks, "type /exit to quit")
      remount()
      return
    }
    if (key.ctrl && key.name === "f") {
      void capturePapercutFromUi(options, state, remount)
      return
    }
    if (!state.evalModalOpen && key.ctrl && key.name === "e" && handleEvalFeedbackKey(key, options, state, remount)) {
      return
    }
    if (key.eventType === "release") {
      if (handleVoiceKeyEvent(key, "release")) return
    } else if (key.eventType !== "repeat") {
      if (handleVoiceKeyEvent(key, "press")) return
    } else {
      return
    }
    if (state.evalModalOpen && handleEvalFeedbackKey(key, options, state, remount)) {
      return
    }
    if (handlePermissionsKey(key, options, state, remount)) return
    if (
      state.workerPanelView === "goal" &&
      !isGoalMode(state) &&
      state.focusMode === "agent" &&
      handlePreviousGoalsListKeys(key, state, state.metaEvents, options.session.metaThreadId, remount)
    ) {
      return
    }
    if (key.name === "N" && !focusedInputEditing(state)) {
      void capturePapercutFromUi(options, state, remount)
      return
    }
    if (showWorkerGoalTabs(state, state.metaEvents) && goalNavigationShortcutsEnabled(state)) {
      if (isGoalMode(state)) {
        if (key.name === "m") {
          focusGoalSidecarChat(options, state, remount)
          return
        }
        if (key.name === "t") {
          state.monitorPanelMode = "chat"
          state.focusMode = "monitor"
          remount()
          return
        }
        if (key.name === "e") {
          state.monitorPanelMode = "events"
          state.focusMode = "monitor"
          remount()
          return
        }
        if (key.name === "a") {
          state.agentViewEnabled = !state.agentViewEnabled
          remount()
          return
        }
        if (key.name === "1") {
          selectWorkerPanelView(state, "chat", remount)
          return
        }
        if (key.name === "2") {
          selectWorkerPanelView(state, "goal", remount)
          return
        }
      }
      if (key.name === "g") {
        selectWorkerPanelView(state, "goal", remount)
        return
      }
    }

    if (isEnterKey(key) && activeInputIsExitCommand(state)) {
      key.preventDefault?.()
      key.stopPropagation?.()
      exitStack()
      return
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

    if (
      isEnterKey(key) &&
      key.ctrl &&
      (state.focusMode === "gardener" || state.gardenerInputBuffer.trim().length > 0)
    ) {
      submitFromGardenerInput(key, true)
      return
    }

    if (isEnterKey(key) && submitFromGardenerInput(key)) {
      return
    }

    if (isEnterKey(key) && submitFromCurrentInput(key)) {
      return
    }

    if (isEnterKey(key) && submitFromMonitorInput(key)) {
      return
    }

    if (state.focusMode === "config" && handleConfigKey(key, options, state, remount, refreshAfterEnvironmentChange, codexSessionHandle)) {
      return
    }

    if (key.name === "escape") {
      if (state.focusMode === "goal") {
        state.focusMode = "agent"
        remount()
        return
      }
      if (closeSelectorPanel(state)) {
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
      if (state.focusMode === "lights-filter") {
        state.focusMode = state.lightsFilterReturnFocus
        remount()
        return
      }
      if (state.lightsThreadFilter.length > 0) {
        state.lightsThreadFilter = ""
        state.lightsThreadScrollOffset = 0
        state.lightsSelectedThreadId = undefined
        remount()
        return
      }
      if (closeOperatorSidePanels(options, state, "escape")) {
        remount()
        return
      }
      if (showWorkerGoalTabs(state, state.metaEvents)) {
        if (returnToGoalView(state, remount)) return
        selectWorkerPanelView(state, "chat", remount)
        return
      }
      if (agentChatPauseEligible(state)) {
        if (state.agentChatPaused) {
          state.agentChatPaused = false
          if (codexSessionHandle.session) {
            appendStackBlock(state.blocks, "interrupt requested")
            void codexSessionHandle.session.interrupt().finally(remount)
          }
          return
        }
        state.agentChatPaused = true
        state.lastAgentScrollAt = Date.now()
        remount()
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
      openGardenerPanel(options, state, remount, "keyboard")
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

    if (key.ctrl && key.name === "]" && !focusedInputEditing(state)) {
      void openLatestLocalArtifact(options, state, remount)
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

    if (handleAgentScrollKey(key, state, renderer, options)) {
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
      if (state.rightPanelContent === "lights") {
        handleLightsKey(key, options, state, buildOpsPanelInput(options, state), rightPanelThreadRows(renderer), remount)
      } else if (state.rightPanelContent === "efforts") {
        void handleEffortsKey(key, options, state, remount)
      } else {
        handleOpsKey(key, state, renderer, options, buildOpsPanelInput(options, state), opsVisibleRows(renderer, state), remount, refreshRemoteOpsPanel, refreshOptimizers)
      }
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
      handleModelKey(key, options, state, remount)
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
    for (const child of renderer.root.getChildren()) {
      renderer.root.remove(child.id)
      child.destroyRecursively()
    }
    if (existing && existing.root.parent !== null) {
      existing.root.destroyRecursively()
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
  const configSettings = configPanel(options, state, refresh, applyStackEnvironmentFromUi, codexSessionHandle)
  const experimentalSettings = experimentalPanel(state)
  const permissionsSettings = permissionsPanel(options, state, refresh)
  const goalModeActive = isGoalMode(state)
  const showRightGardenerPanel = state.rightPanelOpen && state.rightPanelContent === "gardener"
  const showRightThreadsPanel = state.rightPanelOpen && state.rightPanelContent === "threads"
  const showRightLightsPanel = state.rightPanelOpen && state.rightPanelContent === "lights"
  const showRightEffortsPanel = state.rightPanelOpen && state.rightPanelContent === "efforts"
  const showDefaultRightPanel = state.rightPanelOpen && state.rightPanelContent === "default"
  const showCoreGardenerPanel = state.focusMode === "gardener"
  const showCenterPanels =
    !showRightThreadsPanel &&
    (state.focusMode === "projects" || state.focusMode === "history" || state.focusMode === "harness")
  const metaThreadTitle =
    state.metaThreadManifest?.title?.trim() ||
    state.metaThreadManifest?.active_goal?.objective?.trim() ||
    state.goalContext.objective?.trim()
  setCrashRuntimeContext({
    surface: "tui",
    goalMode: goalModeActive,
    monitorEnabled: state.monitorSnapshot.enabled,
    sidecarView: state.monitorPanelMode,
    focusMode: state.focusMode,
    environment: options.config.environmentName,
    terminalRows: renderer.terminalHeight,
    terminalCols: renderer.terminalWidth,
  })
  const baseTranscriptViewport = buildAgentTranscriptViewport(renderer, options, state)
  const transcriptViewport = baseTranscriptViewport
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
  const visibleThreadIds = resolveVisibleThreadIds(options.session.id, state.gardenerWorkerTargetId, {
    lifecycle: "live",
    history: state.history,
    threadLifecycleStatus: state.threadLifecycleStatus,
  })
  const gardenerEvents = readThreadMetaEvents(options.config.stackDataRoot, state.gardenerThreadId)
  const workerMetaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  const workerGoalTabs = showWorkerGoalTabs(state, workerMetaEvents)
  const gardenerChat = buildGardenerChatTranscriptView(options, state, gardenerEvents)
  const gardenerChatBlocks = gardenerChat.blocks
  const gardenerChatTools = gardenerChat.tools
  const gardenerChatSubagents = gardenerChat.subagents
  const gardenerTranscriptOptions = gardenerTranscriptRenderOptions(
    transcriptRenderOptions(state),
    state.gardenerChatRunning,
    state.gardenerLiveThinking,
  )
  const gardenerChatAreaRows = showCoreGardenerPanel
    ? transcriptViewport.lines
    : gardenerChatVisibleRows(renderer, state)
  const gardenerChatColumns = showCoreGardenerPanel ? transcriptViewport.columns : leftColumns
  const coreEventStreamContext = resolveCoreEventStreamContext(state)
  tailGardenerThreadScroll(
    state,
    gardenerChatBlocks,
    gardenerChatTools,
    gardenerChatSubagents,
    gardenerChatColumns,
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
  const rightThreadsRows = rightPanelThreadRows(renderer)
  const lightsRows = rightPanelThreadRows(renderer)
  const workerActive =
    monitorWatchLive && monitorWorkerActive(state) && !monitorWatchSuppressedByGoalChat(state)
  const showMonitorRightPanel = showDefaultRightPanel && isMonitorOn(state.monitorSnapshot)
  const sidecarTranscript = showMonitorRightPanel
      ? readMonitorSidecarTranscript(
          options.config.stackDataRoot,
          options.session.id,
          state.monitorSnapshot.actorId,
        )
      : undefined
  const monitorSidecarChat =
    (sidecarTranscript?.turns?.length ?? 0) > 0
      ? buildMonitorSidecarChatBlocks(sidecarTranscript?.turns, monitorTargetMetaEvents)
      : undefined
  const monitorChatBlocks = monitorSidecarChat?.blocks ?? blocksFromMonitorChatEvents(monitorTargetMetaEvents)
  const monitorChatTools = monitorSidecarChat?.tools ?? []
  const monitorChatSubagents = monitorSidecarChat?.subagents ?? []
  const monitorTranscriptOptions = monitorTranscriptRenderOptions(
    transcriptRenderOptions(state),
    monitorPanelSnapshot,
  )
  const monitorChatSplit = monitorChatRowSplit(monitorRows, workerActive)
  const monitorChatRows = monitorChatSplit.watchRows > 0 ? monitorChatSplit.narrativeRows : monitorRows
  const monitorTranscriptEstimatedLines = estimateShortTranscriptLines(
    monitorChatBlocks,
    monitorChatTools,
    monitorChatSubagents,
    rightColumns,
  )
  const {
    viewport: monitorTranscriptViewport,
  } = transcriptViewportForEstimatedContent({
    columns: rightColumns,
    lines: monitorChatRows,
    pageLines: 6,
  }, monitorTranscriptEstimatedLines)
  const showOpsPanel = showDefaultRightPanel && (!isMonitorOn(state.monitorSnapshot) || state.rightPanelOpsVisible)
  if (showMonitorRightPanel) {
    tailMonitorThreadScroll(
      state,
      monitorChatBlocks,
      monitorChatTools,
      monitorChatSubagents,
      rightColumns,
      monitorTranscriptViewport.lines,
      monitorTranscriptOptions,
    )
    tailMonitorWatchScroll(state, rightColumns, monitorChatSplit.watchRows)
  }
  if (workerGoalTabs && state.workerPanelView === "goal" && isGoalMode(state)) {
    tailGoalShutterScroll(state, workerMetaEvents, transcriptViewport.columns, transcriptViewport.lines)
  }
  const opsPanelInput = buildOpsPanelInput(options, state)
  const focusCenterProjects = panelFocusHandlers(state, "projects", refresh)
  const focusCenterThreads = panelFocusHandlers(state, "history", refresh)
  const focusCenterEvents = panelFocusHandlers(state, "harness", refresh)
  const focusGardener = panelFocusHandlers(state, "gardener", refresh)
  const focusAgent = agentPanelFocusHandlers(state, refresh)
  const focusOps = panelFocusHandlers(state, "ops", refresh)
  const focusMonitor = panelFocusHandlers(state, "monitor", refresh)
  const agentTranscriptEstimatedLines = estimateShortTranscriptLines(
    state.blocks,
    state.toolLogs,
    state.subagentLogs,
    transcriptViewport.columns,
  )
  const { viewport: agentTranscriptRenderViewport } = transcriptViewportForEstimatedContent(
    transcriptViewport,
    agentTranscriptEstimatedLines,
  )
  const workerPanelContentRows = agentTranscriptRenderViewport.lines
  const agentMainPane =
    workerGoalTabs && state.workerPanelView === "goal"
      ? Box(
          {
            flexDirection: "column",
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 0,
            width: "100%",
            overflow: "hidden",
          },
          isGoalMode(state)
            ? renderMonitorGoalViewPanel({
                ...monitorGoalViewInput(options, state, workerMetaEvents, transcriptViewport.columns, metaThreadTitle),
                visibleRows: workerPanelContentRows,
                scrollOffset: state.goalShutterScrollOffset,
              })
            : renderPreviousGoalsListPanel({
                state,
                events: workerMetaEvents,
                metaThreadId: options.session.metaThreadId,
                columns: transcriptViewport.columns,
                visibleRows: workerPanelContentRows,
                scrollOffset: state.goalShutterScrollOffset,
                expandedKeys: state.previousGoalExpandedKeys,
                selectedIndex: state.previousGoalSelectedIndex,
                onToggleEntry: (entryKey) => {
                  togglePreviousGoalExpanded(state, entryKey)
                  refresh()
                },
              }),
        )
      : transcriptPane(renderTranscriptPanel(state, agentTranscriptRenderViewport), transcriptPaneFlexGrowForContent())
  const gardenerCoreChildren = [
    transcriptPane(
      renderRoleChatTranscriptStyled(
        gardenerChatBlocks,
        gardenerChatTools,
        gardenerChatSubagents,
        {
          columns: transcriptViewport.columns,
          lines: gardenerChatAreaRows,
          pageLines: 6,
        },
        gardenerTranscriptOptions,
        state.gardenerScrollOffset,
      ),
      transcriptPaneFlexGrowForContent(),
    ),
    gardenerControlRow(options, state, refresh, transcriptViewport.columns),
  ]
  const evalFeedbackModal = renderEvalFeedbackModal(state)
  const agentChildren = showCoreGardenerPanel ? gardenerCoreChildren : [
    agentPanelIdsCopyIcon(renderer, options, state, refresh),
    ...(state.railsVisible ? [Text({ content: mediationTopStrip(options, state), fg: theme.synth.amber })] : []),
    ...(workerGoalTabs ? [workerPanelModeBar(state, refresh)] : []),
    agentMainPane,
    ...(state.focusMode === "goal" ? [renderGoalPanel(state)] : []),
    ...(switcher ? [switcher] : []),
    ...(configSettings ? [configSettings] : []),
    ...(experimentalSettings ? [experimentalSettings] : []),
    ...(permissionsSettings ? [permissionsSettings] : []),
    ...(evalFeedbackModal ? [evalFeedbackModal] : []),
    agentControlRow(options, state, transcriptViewport.columns, refresh),
  ]

  const root = Box(
    {
      id: `stack-root-${++stackRootInstance}`,
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
                      gardenerChatTools,
                      gardenerChatSubagents,
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
                    gardenerChatTools,
                    gardenerChatSubagents,
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
        : []),
      ...(showCenterPanels
        ? [
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
                  minWidth: 1,
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
                    minWidth: 1,
                    flexGrow: 1,
                  }),
                  controlChip("+ new", true, () => {
                    void startNewThread(options, state, codexSessionHandle, refresh, refreshHistory, refreshMetaEvents)
                  }),
                ),
                Box(
                  { flexDirection: "column", width: "100%", flexShrink: 0 },
                  ...activeThreadRowElements(
                    {
                      focusMode: state.focusMode,
                      history: state.history,
                      activeThreadIds,
                      visibleThreadIds,
                      selectedHistoryIndex: state.selectedHistoryIndex,
                      currentSessionId: options.session.id,
                      visibleRows: threadRows,
                      columns: centerColumns,
                      gardenerThreadIds: new Set([state.gardenerThreadId]),
                      liveTokensPerSecond: formatAverageTokensPerSecond(displayTokensPerSecond(state)),
                      usageForSummary: (summary) => threadUsageSummary(options, summary),
                      threadGoalStatus: state.threadGoalStatus,
                      threadLifecycleStatus: state.threadLifecycleStatus,
                      threadMetaThreadIds: state.threadMetaThreadIds,
                      threadMetaThreadTitles: state.threadMetaThreadTitles,
                    },
                    options,
                    state,
                    codexSessionHandle,
                    refresh,
                    refreshHistory,
                    refreshMetaEvents,
                  ),
                ),
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
          ]
        : []),
      Box(
        {
          border: true,
          borderStyle: "single",
          borderColor:
            state.focusMode === "agent" ||
            state.focusMode === "goal" ||
            state.focusMode === "model" ||
            state.focusMode === "effort" ||
            state.focusMode === "environment" ||
            state.focusMode === "account" ||
            state.focusMode === "gardener"
              ? theme.borderActive
              : theme.borderInactive,
          title: showCoreGardenerPanel ? gardenerPanelTitle(options, state) : agentPanelTitle(options, state),
          backgroundColor: theme.bgCanvas,
          flexGrow: 1,
          padding: stackTuiLayout.panelPadding,
          flexDirection: "column",
          gap: stackTuiLayout.panelGap,
          ...(showCoreGardenerPanel ? focusGardener : focusAgent),
          onMouseScroll(event) {
            event.preventDefault()
            event.stopPropagation()
            if (showCoreGardenerPanel) {
              handleGardenerChatScroll(
                event,
                state,
                gardenerChatBlocks,
                gardenerChatTools,
                gardenerChatSubagents,
                transcriptViewport.columns,
                gardenerChatAreaRows,
                gardenerTranscriptOptions,
                refresh,
              )
              return
            }
            state.lastAgentScrollAt = Date.now()
            const direction = event.scroll?.direction
            if (workerGoalTabs && state.workerPanelView === "goal") {
              if (direction === "up" || direction === "down") {
                const maxOffset = isGoalMode(state)
                  ? monitorGoalViewMaxScroll(
                      monitorGoalViewInput(options, state, workerMetaEvents, transcriptViewport.columns, metaThreadTitle),
                      workerPanelContentRows,
                    )
                  : previousGoalsListMaxScroll({
                      state,
                      events: workerMetaEvents,
                      metaThreadId: options.session.metaThreadId,
                      columns: transcriptViewport.columns,
                      expandedKeys: state.previousGoalExpandedKeys,
                      selectedIndex: state.previousGoalSelectedIndex,
                      visibleRows: workerPanelContentRows,
                    })
                handleWorkerGoalViewScroll(direction, state, maxOffset, refresh)
              }
              return
            }
            if (direction === "up") {
              scrollAgentTranscript(state, 3, agentTranscriptRenderViewport, "up")
            } else if (direction === "down") {
              scrollAgentTranscript(state, 3, agentTranscriptRenderViewport, "down")
            }
            refresh()
          },
        },
        ...agentChildren,
      ),
      ...(state.rightPanelOpen
        ? [
            renderRightPanelResizeHandle(renderer, options, state, refresh),
            Box(
              {
                width: monitorPanelWidth(state),
                flexDirection: "column",
                gap: stackTuiLayout.panelGap,
                flexShrink: 0,
              },
              ...(showRightGardenerPanel
                ? [
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
                            gardenerChatTools,
                            gardenerChatSubagents,
                            rightColumns,
                            gardenerChatAreaRows,
                            gardenerTranscriptOptions,
                            refresh,
                          )
                        },
                      },
                      transcriptPane(
                        renderRoleChatTranscriptStyled(
                          gardenerChatBlocks,
                          gardenerChatTools,
                          gardenerChatSubagents,
                          {
                            columns: rightColumns,
                            lines: gardenerChatAreaRows,
                            pageLines: 6,
                          },
                          gardenerTranscriptOptions,
                          state.gardenerScrollOffset,
                        ),
                      ),
                      gardenerControlRow(options, state, refresh, rightColumns),
                    ),
                  ]
                : []),
              ...(showRightThreadsPanel
                ? [
                    Box(
                      {
                        border: true,
                        borderStyle: "single",
                        borderColor:
                          state.focusMode === "history" ? theme.borderActive : theme.borderInactive,
                        title: "Threads",
                        backgroundColor: theme.bgPanel,
                        flexGrow: 1,
                        padding: stackTuiLayout.panelPadding,
                        ...focusCenterThreads,
                        onMouseScroll(event) {
                          handleThreadsMouseScroll(event, state, refresh)
                        },
                      },
                      Text({
                        content: renderThreadsRailStyled({
                          ...buildThreadsRailInput(options, state, rightThreadsRows),
                          columns: rightColumns,
                        }),
                        fg: theme.fgPrimary,
                      }),
                    ),
                  ]
                : []),
              ...(showRightLightsPanel
                ? [
                    Box(
                      {
                        border: true,
                        borderStyle: "single",
                        borderColor: theme.borderInactive,
                        title: `Lights · ${options.config.environmentName}`,
                        backgroundColor: theme.bgPanel,
                        flexGrow: 1,
                        padding: stackTuiLayout.panelPadding,
                        onMouseScroll(event) {
                          handleLightsMouseScroll(event, options, state, opsPanelInput, lightsRows, refresh)
                        },
                      },
                      renderLightsPanel(
                        options,
                        state,
                        opsPanelInput,
                        rightColumns,
                        lightsRows,
                        refresh,
                        codexSessionHandle,
                        refreshHistory,
                        refreshMetaEvents,
                      ),
                    ),
                  ]
                : []),
              ...(showRightEffortsPanel
                ? [
                    Box(
                      {
                        border: true,
                        borderStyle: "single",
                        borderColor: theme.borderInactive,
                        title: `Efforts · ${options.config.environmentName}`,
                        backgroundColor: theme.bgPanel,
                        flexGrow: 1,
                        padding: stackTuiLayout.panelPadding,
                      },
                      Text({
                        content: renderEffortsPanelStyled(options, state, rightColumns, lightsRows),
                        fg: theme.fgPrimary,
                      }),
                    ),
                  ]
                : []),
              ...(showMonitorRightPanel
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
                        gap: 1,
                        ...focusMonitor,
                        onMouseScroll(event) {
                          const direction = event.scroll?.direction
                          if (state.monitorPanelMode === "events") {
                            handleMonitorEventScroll(
                              event,
                              state,
                              rightColumns,
                              monitorRows,
                              refresh,
                            )
                            return
                          }
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
                              monitorChatTools,
                              monitorChatSubagents,
                              rightColumns,
                              monitorRows,
                              monitorTranscriptOptions,
                              refresh,
                            )
                          }
                        },
                      },
                      monitorPanelModeBar(state, refresh),
                      state.monitorPanelMode === "events"
                        ? transcriptPane(
                            renderMonitorEventStreamStyled(
                              monitorTargetMetaEvents,
                              rightColumns,
                              monitorRows,
                              state.monitorEventScrollOffset,
                            ),
                            1,
                          )
                        : transcriptPane(
                            renderRoleChatTranscriptStyled(
                              monitorChatBlocks,
                              monitorChatTools,
                              monitorChatSubagents,
                              monitorTranscriptViewport,
                              monitorTranscriptOptions,
                              state.monitorScrollOffset,
                            ),
                            monitorChatSplit.watchRows > 0 ? 0 : transcriptPaneFlexGrowForContent(),
                          ),
                      ...(state.monitorPanelMode === "chat" && monitorWatchLive && monitorChatSplit.watchRows > 0
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
        : []),
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

  if (focusMode === "model") {
    return modelPickerPanel(options, state, refresh)
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

type ModelPickerAction =
  | { kind: "model"; value: string }
  | { kind: "effort"; value: string }
  | { kind: "fixed-effort"; value: string }

type ModelPickerRow = {
  text: string
  active?: boolean
  action?: ModelPickerAction
}

function modelPickerPanel(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): ReturnType<typeof Box> {
  const rows = modelPickerRows(options.config)
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderActive,
      title: "Model",
      padding: stackTuiLayout.panelPadding,
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      gap: 0,
    },
    ...rows.map((row) => {
      const action = row.action
      return switcherLine(
        row.text,
        Boolean(row.active),
        action ? () => applyModelPickerAction(action, options, state, refresh) : undefined,
      )
    }),
  )
}

function modelPickerRows(config: StackConfig): ModelPickerRow[] {
  const modelOptions = switcherOptions(config, "model")
  const rows: ModelPickerRow[] = [
    { text: `provider: ${harnessAuthPlan(config)} · /provider changes provider` },
    { text: "number or click option · j/k model · e reasoning · Esc close" },
    { text: "Models" },
  ]
  const currentModel = harnessModel(config)
  for (const [index, model] of modelOptions.entries()) {
    rows.push({
      text: `${index + 1}. ${modelPickerModelLabel(config, model)}${model === currentModel ? " (current)" : ""}  ${modelPickerModelDescription(config, model)}`,
      active: model === currentModel,
      action: { kind: "model", value: model },
    })
  }

  rows.push({ text: "Reasoning" })
  if (isCursorHarness(config)) {
    const effort = CURSOR_REASONING_EFFORT_OPTIONS[0]
    rows.push({
      text: `${modelOptions.length + 1}. ${modelPickerEffortLabel(effort)} (current)  ${modelPickerEffortDescription(effort)}`,
      active: true,
      action: { kind: "fixed-effort", value: effort },
    })
    return rows
  }
  const start = modelOptions.length
  for (const [index, effort] of CODEX_REASONING_EFFORT_OPTIONS.entries()) {
    rows.push({
      text: `${start + index + 1}. ${modelPickerEffortLabel(effort)}${effort === config.codexReasoningEffort ? " (current)" : effort === "medium" ? " (default)" : ""}  ${modelPickerEffortDescription(effort)}`,
      active: effort === config.codexReasoningEffort,
      action: { kind: "effort", value: effort },
    })
  }
  return rows
}

function modelPickerModelLabel(config: StackConfig, model: string): string {
  if (isCursorHarness(config)) {
    if (model === "composer-2.5") return "Composer 2.5"
    if (model === "auto") return "Auto"
  }
  return model
}

function modelPickerModelDescription(config: StackConfig, model: string): string {
  if (isCursorHarness(config)) {
    if (model === "composer-2.5") return "Cursor Composer model"
    if (model === "auto") return "Cursor-managed routing"
  }
  if (model === "gpt-5.4-mini") return "fast daily worker"
  if (model === "gpt-5.5") return "deeper frontier reasoning"
  return ""
}

function modelPickerEffortLabel(effort: string): string {
  if (effort === "low") return "Low"
  if (effort === "medium") return "Medium"
  if (effort === "normal") return "Normal"
  if (effort === "high") return "High"
  if (effort === "xhigh") return "Extra high"
  return effort
}

function modelPickerEffortDescription(effort: string): string {
  if (effort === "low") return "fast responses with lighter reasoning"
  if (effort === "medium") return "balanced speed and depth"
  if (effort === "normal") return "Cursor agent fixed effort"
  if (effort === "high") return "greater reasoning depth"
  if (effort === "xhigh") return "maximum reasoning depth"
  return ""
}

function applyModelPickerAction(
  action: ModelPickerAction,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  if (action.kind === "model") {
    applySwitcherOption("model", action.value, options, state, refresh)
    appendStackBlock(state.blocks, `model ${harnessModel(options.config)}`)
  } else if (action.kind === "fixed-effort") {
    appendStackBlock(state.blocks, `reasoning effort ${action.value}`)
    refresh()
    return
  } else if (!isCursorHarness(options.config)) {
    setCodexReasoningEffort(options.config, action.value)
    appendStackBlock(state.blocks, `reasoning effort ${options.config.codexReasoningEffort}`)
  }
  persistStackConfig(options, state, refresh)
}

function modelPickerActionForKey(keyName: string | undefined, config: StackConfig): ModelPickerAction | undefined {
  const modelOptions = switcherOptions(config, "model")
  if (keyName === "e" && !isCursorHarness(config)) {
    const current = Math.max(0, CODEX_REASONING_EFFORT_OPTIONS.findIndex((option) => option === config.codexReasoningEffort))
    return {
      kind: "effort",
      value: CODEX_REASONING_EFFORT_OPTIONS[(current + 1) % CODEX_REASONING_EFFORT_OPTIONS.length] ?? config.codexReasoningEffort,
    }
  }

  const numeric = Number.parseInt(keyName ?? "", 10)
  if (!Number.isInteger(numeric) || numeric <= 0) return undefined
  const model = modelOptions[numeric - 1]
  if (model) return { kind: "model", value: model }

  if (isCursorHarness(config) && numeric === modelOptions.length + 1) {
    return { kind: "fixed-effort", value: CURSOR_REASONING_EFFORT_OPTIONS[0] }
  }

  if (!isCursorHarness(config)) {
    const effort = CODEX_REASONING_EFFORT_OPTIONS[numeric - modelOptions.length - 1]
    if (effort) return { kind: "effort", value: effort }
  }
  return undefined
}

type ConfigRowId =
  | "provider"
  | "environment"
  | "model"
  | "effort"
  | "subagents"
  | "subagent-model"
  | "subagent-effort"
  | "voice"
  | "telemetry"

type ConfigRow = {
  id: ConfigRowId
  text: string
  active?: boolean
  onSelect: () => void
}

function configPanel(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  applyStackEnvironmentFromUi: (environmentName: StackEnvironmentName) => Promise<void>,
  codexSessionHandle: { session?: HarnessSession },
): ReturnType<typeof Box> | undefined {
  if (state.focusMode !== "config") return undefined
  const rows = configRows(options, state, refresh, applyStackEnvironmentFromUi, codexSessionHandle)
  state.configSelectedIndex = clampIndex(state.configSelectedIndex, rows.length)
  const help = state.configNotice ?? "j/k select · Enter edit · persisted to stack.config.json · Esc close"
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderActive,
      title: "Stack Config",
      padding: stackTuiLayout.panelPadding,
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      gap: 0,
    },
    switcherLine(help, false),
    ...rows.map((row, index) =>
      switcherLine(
        `${index === state.configSelectedIndex ? ">" : " "} ${row.text}`,
        index === state.configSelectedIndex || Boolean(row.active),
        () => {
          state.configSelectedIndex = index
          row.onSelect()
        },
      ),
    ),
  )
}

function experimentalPanel(state: AppState): ReturnType<typeof Box> | undefined {
  if (state.focusMode !== "experimental") return undefined
  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderActive,
      title: "Experimental",
      padding: stackTuiLayout.panelPadding,
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      gap: 0,
    },
    Text({ content: "Toggle experimental features.", fg: theme.fgMuted }),
  )
}

function configRows(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  applyStackEnvironmentFromUi: (environmentName: StackEnvironmentName) => Promise<void>,
  codexSessionHandle: { session?: HarnessSession },
): ConfigRow[] {
  const config = options.config
  return [
    {
      id: "provider",
      text: `provider: ${harnessAuthPlan(config)}`,
      onSelect: () => {
        const next = cycleHarnessProvider(config, 1)
        void applyHarnessSwitch(options, state, codexSessionHandle, next, refresh).then(() => {
          persistStackConfig(options, state, refresh)
        })
      },
    },
    {
      id: "environment",
      text: `environment: ${config.environmentName}`,
      onSelect: () => {
        const current = STACK_ENVIRONMENT_OPTIONS.indexOf(config.environmentName)
        const next = STACK_ENVIRONMENT_OPTIONS[(current + 1) % STACK_ENVIRONMENT_OPTIONS.length] ?? config.environmentName
        void applyStackEnvironmentFromUi(next).then(() => persistStackConfig(options, state, refresh))
      },
    },
    {
      id: "model",
      text: `worker model: ${harnessModel(config)}`,
      onSelect: () => {
        cycleModel(config, 1)
        persistStackConfig(options, state, refresh)
      },
    },
    {
      id: "effort",
      text: isCursorHarness(config) ? `reasoning effort: ${CURSOR_REASONING_EFFORT_OPTIONS[0]}` : `reasoning effort: ${config.codexReasoningEffort}`,
      onSelect: () => {
        if (isCursorHarness(config)) {
          state.configNotice = `reasoning effort ${CURSOR_REASONING_EFFORT_OPTIONS[0]}`
          refresh()
          return
        }
        cycleEffort(config, 1)
        persistStackConfig(options, state, refresh)
      },
    },
    {
      id: "subagents",
      text: `subagents: ${config.codexSubagentsEnabled ? "on" : "off"}`,
      active: config.codexSubagentsEnabled,
      onSelect: () => {
        if (!isCursorHarness(config)) {
          setCodexSubagentsEnabled(config, !config.codexSubagentsEnabled)
        }
        persistStackConfig(options, state, refresh)
      },
    },
    {
      id: "subagent-model",
      text: isCursorHarness(config) ? "subagent model: cursor managed" : `subagent model: ${config.codexSubagentModel}`,
      onSelect: () => {
        if (!isCursorHarness(config)) {
          cycleSubagentModel(config, 1)
          syncStackSubagentAgentFiles(config)
        }
        persistStackConfig(options, state, refresh)
      },
    },
    {
      id: "subagent-effort",
      text: isCursorHarness(config)
        ? "subagent effort: cursor managed"
        : `subagent effort: ${config.codexSubagentReasoningEffort}`,
      onSelect: () => {
        if (!isCursorHarness(config)) {
          cycleSubagentEffort(config, 1)
          syncStackSubagentAgentFiles(config)
        }
        persistStackConfig(options, state, refresh)
      },
    },
    {
      id: "voice",
      text: `voice: ${config.voice.enabled ? "on" : "off"}`,
      active: config.voice.enabled,
      onSelect: () => {
        config.voice.enabled = !config.voice.enabled
        state.voiceStatus = readVoiceStatus(config)
        persistStackConfig(options, state, refresh)
      },
    },
    {
      id: "telemetry",
      text: "permissions (/permissions)",
      onSelect: () => {
        openPermissionsPanel(state, refresh)
      },
    },
  ]
}

function persistStackConfig(options: StackAppOptions, state: AppState, refresh: () => void): void {
  const config = options.config
  try {
    const path = writeStackConfigPatch(config.appRoot, {
      defaultEnvironment: config.environmentName,
      defaultHarness: config.harness,
      codexModel: config.codexModel,
      codexReasoningEffort: config.codexReasoningEffort,
      cursorModel: config.cursorModel,
      codexSubagentsEnabled: config.codexSubagentsEnabled,
      codexSubagentModel: config.codexSubagentModel,
      codexSubagentReasoningEffort: config.codexSubagentReasoningEffort,
      voice: { enabled: config.voice.enabled },
    })
    state.configNotice = `saved ${relative(config.appRoot, path)}`
  } catch (error) {
    state.configNotice = `config save failed: ${errorMessage(error)}`
  }
  refresh()
}

function handleConfigKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  applyStackEnvironmentFromUi: (environmentName: StackEnvironmentName) => Promise<void>,
  codexSessionHandle: { session?: HarnessSession },
): boolean {
  const rows = configRows(options, state, refresh, applyStackEnvironmentFromUi, codexSessionHandle)
  if (key.name === "escape") {
    state.focusMode = "agent"
    refresh()
    return true
  }
  if (key.name === "j" || key.name === "down") {
    state.configSelectedIndex = (state.configSelectedIndex + 1) % rows.length
    refresh()
    return true
  }
  if (key.name === "k" || key.name === "up") {
    state.configSelectedIndex = (state.configSelectedIndex - 1 + rows.length) % rows.length
    refresh()
    return true
  }
  if (isEnterKey(key) || key.name === "space") {
    rows[clampIndex(state.configSelectedIndex, rows.length)]?.onSelect()
    return true
  }
  return false
}

function openPermissionsPanel(state: AppState, refresh: () => void): void {
  state.focusMode = "telemetry"
  state.permissionsDraft = permissionsDraftFromTiers(state.telemetryStatus?.tiers)
  state.permissionsSelectedIndex = 0
  state.telemetryNotice = undefined
  void refreshTelemetryStatus(state, refresh)
}

function permissionsPanel(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): ReturnType<typeof Box> | undefined {
  if (state.focusMode !== "telemetry") return undefined
  const rows = buildPermissionsPanelRows(state.permissionsDraft, (next) => {
    state.permissionsDraft = next
    void persistPermissionsDraft(options, state, refresh)
  })
  state.permissionsSelectedIndex = clampIndex(state.permissionsSelectedIndex, rows.length)
  const status = state.telemetryStatus
  const help =
    state.telemetryNotice ??
    "j/k select · Enter toggle · g grant all · n decline all · r refresh · Esc close"
  const headerLines = [
    PERMISSIONS_REMINDER,
    status
      ? `basic ${status.tiers.basic_dau} · advanced ${status.tiers.advanced_product}`
      : "stackd telemetry status unavailable",
  ]

  return Box(
    {
      border: true,
      borderStyle: "single",
      borderColor: theme.borderActive,
      title: "Permissions",
      padding: stackTuiLayout.panelPadding,
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      gap: 0,
    },
    ...headerLines.map((line) =>
      Text({
        content: line,
        fg: theme.fgMuted,
        width: "100%",
        flexShrink: 0,
      }),
    ),
    switcherLine(help, false),
    ...rows.map((row, index) =>
      switcherLine(
        `${index === state.permissionsSelectedIndex ? ">" : " "} ${row.text}`,
        index === state.permissionsSelectedIndex || row.active,
        () => {
          state.permissionsSelectedIndex = index
          row.onSelect()
        },
      ),
    ),
  )
}

async function persistPermissionsDraft(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): Promise<void> {
  try {
    const response = await stackdUpdateTelemetryConfig(
      permissionsToStackdConfig(state.permissionsDraft, options.config.appRoot),
    )
    state.telemetryStatus = mergeTelemetryTiers(state.telemetryStatus, response.tiers)
    state.permissionsDraft = permissionsDraftFromTiers(response.tiers)
    state.telemetryNotice = "permissions saved"
  } catch (error) {
    state.telemetryNotice = `permissions update failed: ${error instanceof Error ? error.message : String(error)}`
  }
  refresh()
}

async function refreshTelemetryStatus(state: AppState, refresh: () => void): Promise<void> {
  try {
    state.telemetryStatus = await stackdTelemetryStatus()
    state.permissionsDraft = permissionsDraftFromTiers(state.telemetryStatus.tiers)
    state.telemetryNotice = undefined
  } catch (error) {
    state.telemetryNotice = `telemetry status unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
  refresh()
}

function mergeTelemetryTiers(
  status: StackdTelemetryStatus | undefined,
  tiers: StackdTelemetryStatus["tiers"],
): StackdTelemetryStatus | undefined {
  if (!status) return status
  return {
    ...status,
    tiers,
    local_product_telemetry: {
      ...status.local_product_telemetry,
      enabled: tiers.basic_dau === "on" || tiers.advanced_product === "accepted",
      reason: `basic DAU ${tiers.basic_dau} · advanced product ${tiers.advanced_product}`,
    },
  }
}

function handlePermissionsKey(
  key: StackKeyEvent,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): boolean {
  if (state.focusMode !== "telemetry") return false
  if (key.name === "escape") {
    state.focusMode = "agent"
    state.telemetryNotice = undefined
    refresh()
    return true
  }
  if (key.name === "r") {
    void refreshTelemetryStatus(state, refresh)
    return true
  }
  if (key.name === "g") {
    state.permissionsDraft = setPermissionsGrantAll(state.permissionsDraft, true)
    void persistPermissionsDraft(options, state, refresh)
    return true
  }
  if (key.name === "n") {
    state.permissionsDraft = setPermissionsGrantAll(state.permissionsDraft, false)
    void persistPermissionsDraft(options, state, refresh)
    return true
  }
  const rows = buildPermissionsPanelRows(state.permissionsDraft, (next) => {
    state.permissionsDraft = next
    void persistPermissionsDraft(options, state, refresh)
  })
  if (key.name === "j" || key.name === "down") {
    state.permissionsSelectedIndex = clampIndex(state.permissionsSelectedIndex + 1, rows.length)
    refresh()
    return true
  }
  if (key.name === "k" || key.name === "up") {
    state.permissionsSelectedIndex = clampIndex(state.permissionsSelectedIndex - 1, rows.length)
    refresh()
    return true
  }
  if (isEnterKey(key) || key.name === "space") {
    rows[clampIndex(state.permissionsSelectedIndex, rows.length)]?.onSelect()
    return true
  }
  return false
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
  const authStatus = environmentAuthStatus(environment).hasAuth ? "key ok" : "local ok signin"
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
    monitorPanelOpen: state.rightPanelOpen && state.rightPanelContent === "default",
    lightsOn: state.rightPanelOpen && state.rightPanelContent === "lights",
    subagentsEnabled: options.config.codexSubagentsEnabled,
    showDetails: state.showDetails,
    railsVisible: state.railsVisible,
    agentViewEnabled: state.agentViewEnabled,
    environmentName: options.config.environmentName,
    providerName: harnessAuthPlan(options.config),
    profileName: readStackProfile(options.config.stackDataRoot).active,
    workMode: state.workMode,
    model: workerHarness.codexModel,
    effort: isCursorHarness(options.config) ? CURSOR_REASONING_EFFORT_OPTIONS[0] : workerHarness.codexReasoningEffort,
    goalObjective: objective,
    goalStatus: state.metaThreadManifest?.active_goal?.status ?? state.goalContext.status,
  }
}

function activeInputBuffer(state: AppState): string {
  if (state.focusMode === "lights-filter") return state.lightsThreadFilter
  if (goalWorkerChatFocused(state)) return state.inputBuffer
  if (state.focusMode === "gardener") return state.gardenerInputBuffer
  if (state.focusMode === "monitor") return state.monitorInputBuffer
  return state.inputBuffer
}

function setActiveInputBuffer(state: AppState, value: string): void {
  if (state.focusMode === "lights-filter") state.lightsThreadFilter = value
  else if (goalWorkerChatFocused(state)) state.inputBuffer = value
  else if (state.focusMode === "gardener") state.gardenerInputBuffer = value
  else if (state.focusMode === "monitor") state.monitorInputBuffer = value
  else state.inputBuffer = value
}

function goalWorkerChatFocused(state: AppState): boolean {
  return isGoalMode(state) && state.focusMode === "agent"
}

function focusedInputEditing(state: AppState): boolean {
  return activeInputBuffer(state).length > 0
}

/** Goal navigation hotkeys (g, 1, 2, m, …) must not steal keys from panel text inputs. */
function goalNavigationShortcutsEnabled(state: AppState): boolean {
  if (state.focusMode === "monitor" || state.focusMode === "gardener" || state.focusMode === "lights-filter") {
    return false
  }
  return !focusedInputEditing(state)
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
  const goalPreview = renderAgentGoalPreviewStyled(state.metaThreadManifest, state.goalContext, columns)
  const onGardenerSession = isGardenerSession(options, state)
  const workerHarness = workerHarnessForDisplay(config, state)
  const slashCtx = buildSlashCommandContext(options, state)
  const goalMode = isGoalMode(state)
  const workerVoiceHint = panelVoiceHintLine(state, "worker")
  return Box(
    {
      flexDirection: "column",
      gap: stackTuiLayout.panelGap,
      flexShrink: 0,
      width: "100%",
    },
    ...(goalPreview.length > 0
      ? [
          Box(
            {
              flexDirection: "column",
              width: "100%",
              alignItems: "flex-end",
              gap: 0,
            },
            ...goalPreview.map((line) =>
              Text({
                content: line,
                width: "100%",
                flexShrink: 0,
              }),
            ),
          ),
        ]
      : []),
    ...(workerVoiceHint
      ? [
          Text({
            content: workerVoiceHint,
            fg: voiceHintColor(state),
            width: "100%",
            flexShrink: 0,
          }),
        ]
      : []),
    Text({
      content: renderAgentInputStyled(options, state, columns),
      bg: agentInputBackground(state),
      width: "100%",
    }),
    ...slashMenuElements(state.inputBuffer, state.slashMenuIndex, slashCtx, columns, state.focusMode === "agent"),
    ...(goalMode && !onGardenerSession
      ? [compactGoalWorkerControlRow(options, state, workerHarness, cursorHarness, refresh)]
      : onGardenerSession
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
            controlChip(state.monitorSnapshot.model, false),
            ...(cursorHarness ? [] : [controlDivider(), controlChip(state.monitorSnapshot.reasoningEffort, false)]),
            controlDivider(),
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
            controlChip(state.monitorSnapshot.model, false),
            ...(cursorHarness ? [] : [controlDivider(), controlChip(state.monitorSnapshot.reasoningEffort, false)]),
            controlDivider(),
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

function compactGoalWorkerControlRow(
  options: StackAppOptions,
  state: AppState,
  workerHarness: ReturnType<typeof workerHarnessForDisplay>,
  cursorHarness: boolean,
  refresh: () => void,
): ReturnType<typeof Box> {
  const config = options.config
  return Box(
    {
      flexDirection: "row",
      gap: stackTuiLayout.panelGap,
      alignItems: "center",
      width: "100%",
      overflow: "hidden",
      flexShrink: 0,
    },
    controlLabel("worker"),
    focusControlChip(compactModelLabel(workerHarness.codexModel), "model", state, refresh),
    ...(cursorHarness
      ? []
      : [controlDivider(), focusControlChip(compactEffortLabel(workerHarness.codexReasoningEffort), "effort", state, refresh)]),
    controlDivider(),
    focusControlChip(`env ${config.environmentName}`, "environment", state, refresh),
    ...(cursorHarness
      ? []
      : [
          controlDivider(),
          focusControlChip(`sub ${options.config.codexSubagentsEnabled ? "on" : "off"}`, "subagents", state, refresh),
        ]),
    controlDivider(),
    monitorControlChip(`mon ${monitorOnOffLabel(state.monitorSnapshot)}`, state.monitorSnapshot, false, () =>
      toggleMonitorEnabled(options, state, refresh),
    ),
    controlDivider(),
    controlChip(state.rightPanelOpen ? "hide" : "show", state.rightPanelOpen, () =>
      toggleMonitorPanelVisibility(options, state, refresh),
    ),
  )
}

function compactModelLabel(model: string): string {
  return inlineText(model.replace(/^gpt-/, ""), 14)
}

function compactEffortLabel(effort: string): string {
  if (effort === "medium") return "med"
  if (effort === "high") return "high"
  if (effort === "low") return "low"
  return inlineText(effort, 8)
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
    minWidth: 1,
    flexShrink: 0,
  })
}

/** Bottom-flow transcript text; the input/control footer owns the bottom of the pane. */
function transcriptPane(content: StyledText, flexGrow = 1): ReturnType<typeof Box> {
  return Box(
    {
      flexDirection: "column",
      flexGrow,
      flexShrink: 1,
      minHeight: 0,
      justifyContent: "flex-end",
      overflow: "hidden",
    },
    Text({
      content,
      minWidth: 1,
      flexShrink: 0,
    }),
  )
}

function controlChip(content: string, active: boolean, onSelect?: () => void): ReturnType<typeof Text> {
  return Text({
    content,
    fg: active ? theme.fgOnAccent : theme.synth.amber,
    bg: active ? theme.bgChipActive : theme.bgSubtle,
    minWidth: 1,
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

/** Renders the active-threads list as one clickable Text per row. Thread rows resume the clicked
 * thread (mirroring `enter`); pager/empty rows carry no handler so the click bubbles to the panel
 * and just focuses the list. */
function activeThreadRowElements(
  input: ActiveThreadsRenderInput,
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): ReturnType<typeof Text>[] {
  return activeThreadRows(input).map((row) => {
    if (row.kind !== "thread") {
      return Text({ content: styleActiveThreadRowStyled(row), minWidth: 1, flexShrink: 0 })
    }
    const historyIndex = row.historyIndex
    return Text({
      content: styleActiveThreadRowStyled(row),
      minWidth: 1,
      flexShrink: 0,
      onMouseDown(event: PanelMouseEvent) {
        event.preventDefault?.()
        event.stopPropagation?.()
        state.focusMode = "history"
        state.selectedHistoryIndex = historyIndex
        if (input.history[historyIndex]?.id === options.session.id) {
          state.agentScrollOffset = 0
          refresh()
          return
        }
        void loadSelectedSession(
          options,
          state,
          codexSessionHandle,
          refresh,
          refreshHistory,
          refreshMetaEvents,
          "resume",
        )
      },
    })
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
  if (options.session.metaThreadId) metaThreadIds.add(options.session.metaThreadId)
  if (metaThreadIds.size === 0) {
    if (state.threadGoalStatus.size > 0) state.threadGoalStatus = new Map()
    if (state.threadGoalMetrics.size > 0) state.threadGoalMetrics = new Map()
    if (state.threadLifecycleStatus.size > 0) state.threadLifecycleStatus = new Map()
    if (state.threadMetaThreadIds.size > 0) state.threadMetaThreadIds = new Map()
    if (state.threadMetaThreadTitles.size > 0) state.threadMetaThreadTitles = new Map()
    if (state.threadLightsPreviews.size > 0) state.threadLightsPreviews = new Map()
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
  const nextMetrics = new Map<string, ThreadGoalLightsMetrics>()
  const nextLifecycle = new Map<string, ThreadLifecycleStatus>()
  const nextMetaThreadIds = new Map<string, string>()
  const nextMetaThreadTitles = new Map<string, string>()
  const nextPreviews = new Map<string, ThreadLightsPreview>(state.threadLightsPreviews)
  for (const summary of state.history) {
    if (!summary.metaThreadId) continue
    const manifest = manifests.get(summary.metaThreadId)
    if (manifest) {
      nextMetaThreadIds.set(summary.id, manifest.id)
      nextLifecycle.set(summary.id, manifest.lifecycle_status === "archived" ? "archived" : "live")
      const title = manifest.title?.trim() || manifest.active_goal?.objective?.trim()
      if (title) nextMetaThreadTitles.set(summary.id, title)
      const objective = manifest.active_goal?.objective?.trim()
      if (objective) {
        mergeThreadLightsPreview(nextPreviews, summary.id, { objective })
      }
    }
    const events = readThreadMetaEvents(options.config.stackDataRoot, summary.id)
    const human = latestForHumanMonitorHeadline(events)
    if (human) {
      mergeThreadLightsPreview(nextPreviews, summary.id, {
        headline: human.headline,
        note: human.note,
      })
    }
    const goal = manifest?.active_goal
    if (goal?.objective?.trim()) {
      const status = normalizeThreadGoalStatus(goal.status)
      if (status) {
        next.set(summary.id, status)
        if (status !== "done") {
          const session = reduceGoalSessionSnapshot({
            events,
            goal: {
              objective: goal.objective,
              status: goal.status,
              acceptanceCriteria: goal.acceptance_criteria ?? [],
            },
            metaThreadId: summary.metaThreadId,
            monitorThreadSpendUsd: summary.id === options.session.id ? state.monitorSnapshot.threadSpendUsd : 0,
          })
          nextMetrics.set(summary.id, {
            status,
            elapsedLabel: formatLightsGoalElapsed(session),
            usageLabel: formatLightsGoalUsage(session, threadUsageSummary(options, summary)),
          })
        }
      }
    }
  }
  if (options.session.metaThreadId) {
    const activeManifest = manifests.get(options.session.metaThreadId)
    if (activeManifest) {
      state.metaThreadManifest = activeManifest
      state.goalContext = mergeMetaThreadGoalContext(state.goalContext, activeManifest)
    }
  }
  state.threadGoalStatus = next
  state.threadGoalMetrics = nextMetrics
  state.threadLifecycleStatus = nextLifecycle
  state.threadMetaThreadIds = nextMetaThreadIds
  state.threadMetaThreadTitles = nextMetaThreadTitles
  state.threadLightsPreviews = nextPreviews
}

/**
 * Authoritative goal-ownership invariant, enforced every render before any isGoalMode read:
 *  - A meta goal belongs to the metathread named by `manifest.id`; show it only when the foreground
 *    thread is in that metathread (`manifest.id === session.metaThreadId`).
 *  - A meta-sourced goalContext is valid only while that owning manifest is in play.
 * Anything that fails its ownership check is dropped, so a meta goal can never leak onto another
 * thread regardless of which writer last touched the state. Codex (tool/context) goals are the
 * thread's own and are scoped by clearing on session swap (see applySession), then reloaded.
 */
function reconcileGoalOwnership(options: StackAppOptions, state: AppState): void {
  const sessionMetaThreadId = options.session.metaThreadId
  const ownsManifest = !!state.metaThreadManifest && state.metaThreadManifest.id === sessionMetaThreadId
  if (state.metaThreadManifest && !ownsManifest) {
    state.metaThreadManifest = undefined
  }
  if (state.goalContext.source === "meta_thread" && !ownsManifest) {
    state.goalContext = emptyGoalContext()
  }
}

function mergeThreadLightsPreview(
  previews: Map<string, ThreadLightsPreview>,
  threadId: string,
  incoming: ThreadLightsPreview,
): boolean {
  const prev = previews.get(threadId) ?? {}
  const next: ThreadLightsPreview = {
    headline: incoming.headline ?? prev.headline,
    note: incoming.note ?? prev.note,
    objective: incoming.objective ?? prev.objective,
    workerState: incoming.workerState ?? prev.workerState,
  }
  if (
    next.headline === prev.headline &&
    next.note === prev.note &&
    next.objective === prev.objective &&
    next.workerState === prev.workerState
  ) {
    return false
  }
  previews.set(threadId, next)
  return true
}

function applyStackdThreadPreviews(state: AppState, status: StackdMetaStatus): boolean {
  let changed = false
  for (const thread of status.threads) {
    const worker = thread.actors.find((actor) => actor.role === "worker" || actor.role === "primary")
    const incoming: ThreadLightsPreview = {
      headline: thread.headline?.headline?.trim() || undefined,
      note: thread.headline?.note?.trim() || undefined,
      objective: thread.goal?.objective?.trim() || undefined,
      workerState: worker?.state?.trim() || undefined,
    }
    if (mergeThreadLightsPreview(state.threadLightsPreviews, thread.thread_id, incoming)) {
      changed = true
    }
  }
  return changed
}

function syncLightsThreadViewFromDisk(options: StackAppOptions, state: AppState): boolean {
  const disk = readLightsThreadViewState(options.config.stackDataRoot)
  const nextViewed = new Set(disk.viewedThreadIds)
  let changed = nextViewed.size !== state.lightsViewedThreadIds.size
  if (!changed) {
    for (const id of nextViewed) {
      if (!state.lightsViewedThreadIds.has(id)) {
        changed = true
        break
      }
    }
  }
  state.lightsViewedThreadIds = nextViewed
  const nextSelected = disk.selectedThreadId
  if (nextSelected !== state.lightsSelectedThreadId) {
    state.lightsSelectedThreadId = nextSelected
    changed = true
  }
  return changed
}

function openLightsPanelLayout(options: StackAppOptions, state: AppState): boolean {
  const before = stackdSidePanelLayoutKey(state)
  state.leftPanelOpen = false
  state.rightPanelOpen = true
  state.rightPanelContent = "lights"
  state.rightPanelOpsVisible = false
  state.opsScrollOffset = 0
  writeStackUxSettings(options.config.stackDataRoot, { lightsPanelOpen: true })
  return stackdSidePanelLayoutKey(state) !== before
}

function stackdLightsSidePanelIsStaleVsDisk(
  stackRoot: string,
  sidePanel: StackdMetaSidePanel,
): boolean {
  const diskUpdatedAt = lightsThreadViewDiskUpdatedAtMs(stackRoot)
  if (diskUpdatedAt === undefined) return false
  const openedAt = sidePanel.opened_at?.trim()
  if (!openedAt) return false
  const openedAtMs = Date.parse(openedAt)
  if (!Number.isFinite(openedAtMs)) return false
  return diskUpdatedAt > openedAtMs + 50
}

function pickNewestUnappliedLightsSidePanel(
  status: StackdMetaStatus,
  state: AppState,
): { threadId: string; sidePanel: StackdMetaSidePanel } | undefined {
  let best: { threadId: string; sidePanel: StackdMetaSidePanel; openedAtMs: number } | undefined
  for (const thread of status.threads) {
    const sidePanel = thread.ui.side_panel
    if (sidePanel?.panel !== "lights") continue
    if (stackdSidePanelOpenedBeforeOperatorClose(state, sidePanel)) continue
    const key = stackdSidePanelKey(sidePanel)
    if (state.appliedStackdLightsPanelByThread.get(thread.thread_id) === key) continue
    const openedAtMs = Date.parse(sidePanel.opened_at ?? "")
    const sortKey = Number.isFinite(openedAtMs) ? openedAtMs : 0
    if (!best || sortKey >= best.openedAtMs) {
      best = { threadId: thread.thread_id, sidePanel, openedAtMs: sortKey }
    }
  }
  if (!best) return undefined
  return { threadId: best.threadId, sidePanel: best.sidePanel }
}

function applyStackdLightsPanel(
  options: StackAppOptions,
  state: AppState,
  targetThreadId: string,
  opts?: { expandThread?: boolean },
): boolean {
  let changed = openLightsPanelLayout(options, state)
  if (opts?.expandThread === false) return changed
  const beforeSelected = state.lightsSelectedThreadId
  const beforeViewedSize = state.lightsViewedThreadIds.size
  markLightsThreadViewedInState(options.config.stackDataRoot, state, [targetThreadId])
  return (
    changed ||
    beforeSelected !== state.lightsSelectedThreadId ||
    beforeViewedSize !== state.lightsViewedThreadIds.size
  )
}

function applyStackdSidePanelSnapshot(
  options: StackAppOptions,
  state: AppState,
  status: StackdMetaStatus,
): boolean {
  let changed = syncLightsThreadViewFromDisk(options, state)

  const newestLights = pickNewestUnappliedLightsSidePanel(status, state)
  if (newestLights) {
    const key = stackdSidePanelKey(newestLights.sidePanel)
    state.appliedStackdLightsPanelByThread.set(newestLights.threadId, key)
    state.appliedStackdSidePanelKey = key
    const staleVsDisk = stackdLightsSidePanelIsStaleVsDisk(
      options.config.stackDataRoot,
      newestLights.sidePanel,
    )
    changed =
      applyStackdLightsPanel(options, state, newestLights.threadId, {
        expandThread: !staleVsDisk,
      }) || changed
  }

  if (state.rightPanelOpen && state.rightPanelContent === "lights") return changed

  const threadSnapshot =
    status.threads.find((thread) => thread.thread_id === options.session.id) ??
    (options.session.metaThreadId
      ? status.threads.find((thread) => thread.meta_thread_id === options.session.metaThreadId)
      : undefined)
  if (!threadSnapshot) return changed

  const sidePanel = threadSnapshot.ui.side_panel ?? null
  const nextKey = stackdSidePanelKey(sidePanel)
  const previousKey = state.appliedStackdSidePanelKey
  if (nextKey === previousKey) return changed

  if (sidePanel && stackdSidePanelOpenedBeforeOperatorClose(state, sidePanel)) {
    state.appliedStackdSidePanelKey = nextKey
    return changed
  }

  state.appliedStackdSidePanelKey = nextKey
  if (!sidePanel) {
    if (previousKey === undefined || previousKey === "closed") return changed
    return applyStackdClosedSidePanel(state) || changed
  }

  if (sidePanel.panel === "lights") {
    if (stackdSidePanelOpenedBeforeOperatorClose(state, sidePanel)) {
      state.appliedStackdSidePanelKey = nextKey
      return changed
    }
    if (state.appliedStackdLightsPanelByThread.get(threadSnapshot.thread_id) !== nextKey) {
      state.appliedStackdSidePanelKey = nextKey
      state.appliedStackdLightsPanelByThread.set(threadSnapshot.thread_id, nextKey)
      const staleVsDisk = stackdLightsSidePanelIsStaleVsDisk(options.config.stackDataRoot, sidePanel)
      changed =
        applyStackdLightsPanel(options, state, threadSnapshot.thread_id, {
          expandThread: !staleVsDisk,
        }) || changed
    }
    return changed
  }

  const appliedNow = applyStackdOpenedSidePanel(options, state, sidePanel, threadSnapshot.thread_id)
  if (appliedNow) {
    // A3/B5 — the screen actually changed for an agent-opened panel; audit it so a
    // live panel-walk is provable from the event log (ui.panel_focus refreshes the
    // stackd projection's view without touching open/closed state).
    try {
      appendThreadMetaEvent(options.config.stackDataRoot, {
        event_id: stackEventId("ui_panel_focus"),
        type: "ui.panel_focus",
        thread_id: options.session.id,
        observed_at: new Date().toISOString(),
        actor_id: "tui",
        actor_role: "primary",
        payload: {
          panel: sidePanel.panel,
          view: sidePanel.view ?? null,
          opened_by: sidePanel.opened_by,
          source: "stackd_side_panel",
        },
      })
    } catch {
      // audit append is best-effort; the panel is already on screen
    }
  }
  return appliedNow || changed
}

function stackdSidePanelKey(sidePanel: StackdMetaSidePanel | null): string {
  if (!sidePanel) return "closed"
  return JSON.stringify([
    sidePanel.panel,
    sidePanel.view ?? "",
    sidePanel.opened_by,
    sidePanel.reason ?? "",
    sidePanel.opened_at ?? "",
  ])
}

function stackdSidePanelOpenedBeforeOperatorClose(
  state: AppState,
  sidePanel: StackdMetaSidePanel,
): boolean {
  if (!state.lastOperatorSidePanelClosedAtMs || !sidePanel.opened_at) return false
  const openedAtMs = Date.parse(sidePanel.opened_at)
  return Number.isFinite(openedAtMs) && openedAtMs <= state.lastOperatorSidePanelClosedAtMs
}

function stackdSidePanelLayoutKey(state: AppState): string {
  return JSON.stringify([
    state.focusMode,
    state.leftPanelOpen,
    state.rightPanelOpen,
    state.rightPanelContent,
    state.rightPanelOpsVisible,
    state.rightPanelMode,
    state.liveOpsMode,
    state.monitorPanelMode,
    state.gardenerPanelMode,
    state.workerPanelView,
    state.goalShutterSidecarView,
  ])
}

function applyStackdClosedSidePanel(state: AppState): boolean {
  const before = stackdSidePanelLayoutKey(state)
  state.leftPanelOpen = false
  state.rightPanelOpen = false
  state.rightPanelContent = "default"
  if (
    state.focusMode === "monitor" ||
    state.focusMode === "gardener" ||
    state.focusMode === "ops" ||
    state.focusMode === "history" ||
    state.focusMode === "projects" ||
    state.focusMode === "harness" ||
    state.focusMode === "optimizers" ||
    state.focusMode === "hosted" ||
    state.focusMode === "remote"
  ) {
    state.focusMode = "agent"
  }
  return stackdSidePanelLayoutKey(state) !== before
}

function applyStackdOpenedSidePanel(
  options: StackAppOptions,
  state: AppState,
  sidePanel: StackdMetaSidePanel,
  targetThreadId: string,
): boolean {
  if (!isUiPanelId(sidePanel.panel)) return false

  const before = stackdSidePanelLayoutKey(state)
  if (sidePanel.panel === "monitor") {
    state.leftPanelOpen = false
    state.rightPanelOpen = true
    state.rightPanelContent = "default"
    state.rightPanelOpsVisible = false
    state.monitorWorkerTargetId = options.session.id
    state.monitorPanelMode =
      sidePanel.view === "events" || sidePanel.view === "tape"
        ? "events"
        : "chat"
    if (hasGoalContext(state)) {
      if (sidePanel.view === "goal") {
        state.workerPanelView = "goal"
        state.focusMode = "agent"
      } else {
        state.goalShutterSidecarView = sidePanel.view === "thread" ? "thread" : "events"
        state.focusMode = "monitor"
      }
    } else {
      state.focusMode = "monitor"
    }
  } else if (sidePanel.panel === "gardener") {
    closeSidePanelsForGardenerFocus(state)
    state.rightPanelOpsVisible = false
    state.gardenerPanelMode = sidePanel.view === "portfolio" ? "events" : "chat"
    state.focusMode = "gardener"
  } else if (sidePanel.panel === "ops") {
    state.leftPanelOpen = false
    state.rightPanelOpen = true
    state.rightPanelContent = "default"
    state.rightPanelOpsVisible = true
    state.opsScrollOffset = 0
    if (sidePanel.view === "remote") {
      state.liveOpsMode = "remote"
      state.focusMode = "remote"
    } else {
      state.liveOpsMode = "local"
      state.rightPanelMode = sidePanel.view === "hosted" ? "hosted" : "local"
      state.focusMode = "ops"
    }
  } else if (sidePanel.panel === "threads") {
    state.leftPanelOpen = false
    state.rightPanelOpen = true
    state.rightPanelContent = "threads"
    state.rightPanelOpsVisible = false
    state.leftPanelScrollOffset = 0
    state.focusMode = "history"
  } else if (sidePanel.panel === "lights") {
    applyStackdLightsPanel(options, state, targetThreadId)
  } else if (sidePanel.panel === "efforts") {
    state.leftPanelOpen = false
    state.rightPanelOpen = true
    state.rightPanelContent = "efforts"
    state.rightPanelOpsVisible = false
  }
  return stackdSidePanelLayoutKey(state) !== before
}

function syncGoalModeDefaults(options: StackAppOptions, state: AppState): void {
  reconcileGoalOwnership(options, state)
  if (!showWorkerGoalTabs(state, state.metaEvents)) {
    state.workerPanelView = "chat"
    state.goalShutterSidecarView = "events"
    state.goalShutterSidecarThreadScrollOffset = 0
    state.goalShutterSidecarThreadScrollPinned = true
    state.goalShutterScrollOffset = 0
    state.goalShutterScrollPinned = true
    state.goalMonitorAutoEnabledObjective = undefined
    return
  }
  const objective = activeGoalModeSnapshot(state).objective ?? ""
  if (isGoalMode(state) && state.goalMonitorAutoEnabledObjective !== objective) {
    if (!isMonitorOn(state.monitorSnapshot)) {
      state.monitorSnapshot = setMonitorEnabled(options.config.stackDataRoot, options.session.id, true)
      syncMonitorRightPanel(state)
    }
    const wasOpen = state.rightPanelOpen
    state.rightPanelOpen = true
    state.rightPanelContent = "default"
    state.rightPanelOpsVisible = false
    state.monitorWorkerTargetId = options.session.id
    state.workerPanelView = "chat"
    state.focusMode = "agent"
    state.goalMonitorAutoEnabledObjective = objective
    if (!wasOpen) {
      appendUiPanelOpened(options, state, "monitor", "events", "operator", "goal")
    }
  }
  if (!isGoalMode(state) && state.focusMode === "goal") {
    state.focusMode = "agent"
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
  state.goalShutterSidecarView = "thread"
  state.goalShutterSidecarThreadScrollPinned = true
  const wasOpen = state.rightPanelOpen
  state.rightPanelOpen = true
  state.rightPanelContent = "default"
  state.rightPanelOpsVisible = false
  state.talkToMonitor = true
  state.monitorPanelMode = "chat"
  state.monitorWorkerTargetId = options.session.id
  state.focusMode = "monitor"
  if (!wasOpen) {
    appendUiPanelOpened(options, state, "monitor", "thread", "operator", "goal_sidecar_chat")
  }
  refresh()
}

function focusGoalWorkerChat(state: AppState, refresh: () => void): boolean {
  if (!showWorkerGoalTabs(state, state.metaEvents)) return false
  selectWorkerPanelView(state, "chat", refresh)
  return true
}

function returnToGoalView(state: AppState, refresh: () => void): boolean {
  if (!showWorkerGoalTabs(state, state.metaEvents) || state.workerPanelView === "goal") return false
  selectWorkerPanelView(state, "goal", refresh)
  return true
}

function appendUiPanelOpened(
  options: StackAppOptions,
  state: AppState,
  panel: UiPanelId,
  view: string | undefined,
  openedBy: "operator" | "monitor" | "gardener",
  reason: string,
): void {
  try {
    appendThreadMetaEvent(options.config.stackDataRoot, {
      event_id: stackEventId("ui_panel_opened"),
      type: "ui.panel_opened",
      thread_id: options.session.id,
      observed_at: new Date().toISOString(),
      actor_id: openedBy,
      actor_role: openedBy === "operator" ? "primary" : openedBy,
      payload: {
        panel,
        ...(view ? { view } : {}),
        opened_by: openedBy,
        reason,
        source: "tui",
      },
    })
    void emitFeatureUsed("side_panel_open")
    for (const featureId of panelFeatureIds(panel, view)) {
      void emitFeatureUsed(featureId)
    }
    state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  } catch (error) {
    appendStackBlock(state.blocks, `ui panel open audit failed: ${errorMessage(error)}`)
  }
}

function panelFeatureIds(panel: UiPanelId, view: string | undefined): string[] {
  if (panel === "ops" && view === "remote") return ["hosted_ops", "remote_sync"]
  if (panel === "ops" && view === "hosted") return ["hosted_ops"]
  return []
}

function recordSlashFeatureUsage(): void {
  void emitFeatureUsed("slash_command")
}

function appendUiPanelClosed(
  options: StackAppOptions,
  state: AppState,
  panel: UiPanelId,
  reason: string,
): void {
  state.lastOperatorSidePanelClosedAtMs = Date.now()
  try {
    appendThreadMetaEvent(options.config.stackDataRoot, {
      event_id: stackEventId("ui_panel_closed"),
      type: "ui.panel_closed",
      thread_id: options.session.id,
      observed_at: new Date().toISOString(),
      actor_id: "operator",
      actor_role: "primary",
      payload: {
        panel,
        closed_by: "operator",
        reason,
        source: "tui",
      },
    })
    state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  } catch (error) {
    appendStackBlock(state.blocks, `ui panel close audit failed: ${errorMessage(error)}`)
  }
}

function closeOperatorSidePanels(
  options: StackAppOptions,
  state: AppState,
  reason: string,
): boolean {
  const previousFocusMode = state.focusMode
  const closedPanels: string[] = []
  if (state.leftPanelOpen) {
    state.leftPanelOpen = false
    closedPanels.push("gardener")
  }
  if (state.rightPanelOpen) {
    if (state.rightPanelContent === "gardener") closedPanels.push("gardener")
    else if (state.rightPanelContent === "threads") closedPanels.push("threads")
    else if (state.rightPanelContent === "lights") closedPanels.push("ops")
    else if (state.rightPanelContent === "efforts") closedPanels.push("efforts")
    else closedPanels.push(state.rightPanelOpsVisible || !isMonitorOn(state.monitorSnapshot) ? "ops" : "monitor")
    state.rightPanelOpen = false
    state.rightPanelContent = "default"
  }
  if (state.focusMode === "history" || state.focusMode === "projects" || state.focusMode === "harness") {
    closedPanels.push("threads")
  }
  if (closedPanels.length === 0) return false
  state.lastOperatorSidePanelClosedAtMs = Date.now()
  state.focusMode =
    closedPanels.length === 1 && closedPanels[0] === "ops" && previousFocusMode === "gardener"
      ? previousFocusMode
      : "agent"

  for (const panel of new Set(closedPanels)) {
    try {
      appendThreadMetaEvent(options.config.stackDataRoot, {
        event_id: stackEventId("ui_panel_closed"),
        type: "ui.panel_closed",
        thread_id: options.session.id,
        observed_at: new Date().toISOString(),
        actor_id: "operator",
        actor_role: "primary",
        payload: {
          panel,
          closed_by: "operator",
          reason,
          source: "tui",
        },
      })
    } catch (error) {
      appendStackBlock(state.blocks, `ui panel close audit failed: ${errorMessage(error)}`)
    }
  }
  state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
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
  mode: MonitorPanelMode = "chat",
  reason = "slash",
): void {
  if (!isMonitorOn(state.monitorSnapshot)) {
    state.monitorSnapshot = setMonitorEnabled(options.config.stackDataRoot, options.session.id, true)
  }
  state.leftPanelOpen = false
  state.rightPanelOpen = true
  state.rightPanelContent = "default"
  state.rightPanelOpsVisible = false
  state.talkToMonitor = true
  state.monitorPanelMode = mode
  state.monitorWorkerTargetId = options.session.id
  state.focusMode = "monitor"
  appendUiPanelOpened(
    options,
    state,
    "monitor",
    mode === "events" ? "events" : "thread",
    "operator",
    reason,
  )
  void emitFeatureUsed("monitor_sidecar")
  refresh()
}

function toggleMonitorPanelVisibility(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  if (state.rightPanelOpen) {
    state.rightPanelOpen = false
    state.rightPanelContent = "default"
    if (state.focusMode === "monitor") state.focusMode = "agent"
    appendUiPanelClosed(options, state, "monitor", "slash")
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
  state.monitorNotice = undefined
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

function togglePreviousGoalExpanded(state: AppState, entryKey: string): void {
  if (state.previousGoalExpandedKeys.has(entryKey)) {
    state.previousGoalExpandedKeys.delete(entryKey)
  } else {
    state.previousGoalExpandedKeys.add(entryKey)
  }
  state.goalShutterScrollPinned = false
}

function previousGoalHistoryEntries(
  state: AppState,
  events: readonly StackThreadMetaEvent[],
  metaThreadId?: string,
) {
  return listGoalHistory(events, {
    metaThreadId,
    manifestGoal: state.metaThreadManifest?.active_goal,
  })
}

function handlePreviousGoalsListKeys(
  key: { name?: string },
  state: AppState,
  events: readonly StackThreadMetaEvent[],
  metaThreadId: string | undefined,
  refresh: () => void,
): boolean {
  if (state.workerPanelView !== "goal" || isGoalMode(state)) return false
  const entries = previousGoalHistoryEntries(state, events, metaThreadId)
  if (entries.length === 0) return false
  if (key.name === "j" || key.name === "down") {
    state.previousGoalSelectedIndex = clampIndex(state.previousGoalSelectedIndex + 1, entries.length)
    refresh()
    return true
  }
  if (key.name === "k" || key.name === "up") {
    state.previousGoalSelectedIndex = clampIndex(state.previousGoalSelectedIndex - 1, entries.length)
    refresh()
    return true
  }
  if (key.name === "enter" || key.name === "space") {
    const entry = entries[clampIndex(state.previousGoalSelectedIndex, entries.length)]
    if (entry) togglePreviousGoalExpanded(state, goalHistoryEntryKey(entry))
    refresh()
    return true
  }
  return false
}

function selectWorkerPanelView(state: AppState, view: WorkerPanelView, refresh: () => void): void {
  if (!showWorkerGoalTabs(state, state.metaEvents)) return
  state.workerPanelView = view
  state.focusMode = "agent"
  if (view === "goal") {
    state.goalShutterScrollOffset = 0
    state.goalShutterScrollPinned = true
  }
  refresh()
}

function workerPanelModeBar(state: AppState, refresh: () => void): ReturnType<typeof Box> {
  const selectView = (view: WorkerPanelView) => selectWorkerPanelView(state, view, refresh)
  return renderPanelTabBar([
    { label: "chat", active: state.workerPanelView === "chat", onSelect: () => selectView("chat") },
    { label: "goal", active: state.workerPanelView === "goal", onSelect: () => selectView("goal") },
  ])
}

function monitorPanelModeBar(state: AppState, refresh: () => void): ReturnType<typeof Box> {
  const selectMode = (mode: MonitorPanelMode) => {
    state.monitorPanelMode = mode
    state.focusMode = "monitor"
    refresh()
  }
  return renderPanelTabBar([
    { label: "chat", active: state.monitorPanelMode === "chat", onSelect: () => selectMode("chat") },
    { label: "events", active: state.monitorPanelMode === "events", onSelect: () => selectMode("events") },
  ])
}

function monitorControlRow(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  columns: number,
): ReturnType<typeof Box> {
  const slashCtx = buildSlashCommandContext(options, state)
  const monitorVoiceHint = panelVoiceHintLine(state, "monitor", state.monitorNotice)
  return Box(
    {
      flexDirection: "column",
      gap: stackTuiLayout.panelGap,
    },
    ...(monitorVoiceHint
      ? [
          Text({
            content: monitorVoiceHint,
            fg: voiceHintColor(state, state.monitorNotice),
            width: "100%",
          }),
        ]
      : []),
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

function applyStackCliResumeUi(options: StackAppOptions, state: AppState, _sessionId: string): void {
  state.focusMode = "gardener"
  state.gardenerPanelMode = "chat"
  state.rightPanelOpen = true
  state.rightPanelContent = "lights"
  state.rightPanelOpsVisible = false
  state.opsScrollOffset = 0
  syncLightsThreadViewFromDisk(options, state)
  syncGardenerLeftPanel(state)
  writeStackUxSettings(options.config.stackDataRoot, { lightsPanelOpen: true })
}

function openGardenerPanel(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  reason = "slash",
): void {
  closeSidePanelsForGardenerFocus(state)
  state.rightPanelOpsVisible = false
  state.gardenerPanelMode = "chat"
  state.focusMode = "gardener"
  appendUiPanelOpened(options, state, "gardener", "chat", "operator", reason)
  void emitFeatureUsed("gardener_chat")
  refresh()
}

function openThreadsPanel(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  reason = "slash",
): void {
  state.leftPanelOpen = false
  state.rightPanelOpen = true
  state.rightPanelContent = "threads"
  state.rightPanelOpsVisible = false
  state.leftPanelScrollOffset = 0
  state.focusMode = "history"
  appendUiPanelOpened(options, state, "threads", "list", "operator", reason)
  refresh()
}

function openEffortsPanel(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  reason = "slash",
): void {
  state.leftPanelOpen = false
  state.rightPanelOpen = true
  state.rightPanelContent = "efforts"
  state.rightPanelOpsVisible = false
  state.focusMode = "ops"
  state.opsScrollOffset = 0
  appendUiPanelOpened(options, state, "efforts", "list", "operator", reason)
  refresh()
}

function handleEffortsSlash(
  args: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  const trimmed = args.trim()
  if (!trimmed) {
    openEffortsPanel(options, state, refresh, "slash")
    return
  }
  const parsed = parseEffortsSlashArgs(trimmed)
  if (!parsed) {
    appendStackBlock(state.blocks, effortsSlashUsage())
    refresh()
    return
  }
  try {
    if (parsed.action === "new") {
      const effort = createEffort({
        stackDataRoot: options.config.stackDataRoot,
        workspaceRoot: options.config.workspaceRoot,
        appRoot: options.config.appRoot,
        slug: parsed.ref,
        title: effortTitleFromSlug(parsed.ref),
        template: parsed.template,
      })
      selectEffortPanelId(options, state, effort.manifest.id)
      appendStackBlock(state.blocks, `effort created: ${effort.manifest.slug} - ${effort.registry.folder_ref}`)
      openEffortsPanel(options, state, refresh, "slash:new")
      return
    }
    const status = parsed.action === "archive" ? "archived" : "active"
    const effort = updateEffortStatus({
      stackDataRoot: options.config.stackDataRoot,
      workspaceRoot: options.config.workspaceRoot,
      effortRef: parsed.ref,
      status,
    })
    selectEffortPanelId(options, state, effort.manifest.id)
    appendStackBlock(state.blocks, `effort ${status}: ${effort.manifest.slug}`)
    openEffortsPanel(options, state, refresh, `slash:${parsed.action}`)
  } catch (error) {
    appendStackBlock(state.blocks, `efforts ${parsed.action} failed: ${errorMessage(error)}`)
    refresh()
  }
}

type EffortsSlashAction = "new" | "archive" | "activate"

function parseEffortsSlashArgs(args: string): { action: EffortsSlashAction; ref: string; template?: string } | undefined {
  const tokens = args.split(/\s+/).map((token) => token.trim()).filter(Boolean)
  const action = tokens[0]?.toLowerCase()
  if (action !== "new" && action !== "create" && action !== "archive" && action !== "activate" && action !== "active" && action !== "resume") {
    return undefined
  }
  const ref = tokens[1]
  if (!ref) return undefined
  if (action === "new" || action === "create") {
    return {
      action: "new",
      ref,
      template: effortsSlashTemplate(tokens.slice(2)) ?? "research",
    }
  }
  return {
    action: action === "archive" ? "archive" : "activate",
    ref,
  }
}

function effortsSlashTemplate(tokens: string[]): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === "--template" || token === "-t") return tokens[index + 1]
    if (token?.startsWith("--template=")) return token.slice("--template=".length)
  }
  return tokens.find((token) => !token.startsWith("-"))
}

function effortsSlashUsage(): string {
  return "efforts - use /efforts, /efforts new <slug> [--template <id>], /efforts archive <effort>, or /efforts activate <effort>"
}

function effortTitleFromSlug(slug: string): string {
  const words = slug
    .split(/[-_]+/)
    .map((word) => word.trim())
    .filter(Boolean)
  if (words.length === 0) return "Untitled Effort"
  return words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(" ")
}

function selectEffortPanelId(options: StackAppOptions, state: AppState, effortId: string): void {
  try {
    const index = readEffortsPanelSummaries(options).findIndex((effort) => effort.id === effortId)
    if (index >= 0) state.selectedEffortIndex = index
  } catch {
    state.selectedEffortIndex = 0
  }
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
  if (state.gardenerChatRunning) {
    queueGardenerSubmit(state, prompt, refresh)
    state.gardenerInputBuffer = ""
    return
  }
  state.gardenerInputBuffer = ""
  state.gardenerNotice = undefined
  const stripped = isExplicitGardenerPrefix(prompt) ? stripGardenerMessagePrefix(prompt) : prompt
  const parsed = parseChannelInput(stripped)
  if (parsed.missingPaths.length > 0) {
    state.gardenerNotice = `image not found: ${parsed.missingPaths.map((path) => path.split("/").pop() ?? path).join(", ")}`
  }
  const message = parsed.text || parsed.displayText
  if (!message.trim() && parsed.imagePaths.length === 0) {
    refresh()
    return
  }
  const filterOnly = parseGardenerLightsFilterSubmit(message)
  if (filterOnly !== null) {
    state.lightsThreadFilter = filterOnly
    state.lightsThreadScrollOffset = 0
    state.lightsSelectedThreadId = undefined
    refresh()
    return
  }
  const intent = gardenerSubmitIntent(message)
  state.gardenerScrollPinned = true
  state.gardenerScrollOffset = 0
  state.gardenerEventScrollPinned = true

  if (intent.mode === "archive" || intent.mode === "revive") {
    const gardenerConfig = loadGardenerConfig(options.config.stackDataRoot)
    if (!gardenerConfig.permissions.metaThreadLifecycle) {
      state.gardenerNotice = `${intent.mode} blocked: gardener meta-thread lifecycle permission is disabled`
      refresh()
      return
    }
    const candidates = buildGardenerArchiveCandidates(options, state)
    let targets: GardenerThreadArchiveCandidate[] = []
    if (intent.body.trim().toLowerCase() === "filter") {
      if (!state.lightsThreadFilter.trim()) {
        state.gardenerNotice = "archive filter requires a lights thread filter — try filter craftax first"
        refresh()
        return
      }
      targets = buildGardenerArchiveFilterTargets(options, state, 120).filter(
        (candidate) => candidate.lifecycle === (intent.mode === "archive" ? "live" : "archived"),
      )
      if (targets.length === 0) {
        state.gardenerNotice =
          intent.mode === "archive"
            ? "archive filter: no live meta-threads in the current filter"
            : "revive filter: no archived meta-threads in the current filter"
        refresh()
        return
      }
    } else {
      const resolved = resolveGardenerArchiveTargets(
        intent.body,
        candidates,
        resolveGardenerWorkerTargetId(options, state),
      )
      if (!resolved.ok) {
        state.gardenerNotice = resolved.error
        refresh()
        return
      }
      targets = resolved.targets.filter(
        (candidate) => candidate.lifecycle === (intent.mode === "archive" ? "live" : "archived"),
      )
      if (targets.length === 0) {
        state.gardenerNotice =
          intent.mode === "archive"
            ? "thread already archived or has no meta-thread binding"
            : "thread is already live or has no meta-thread binding"
        refresh()
        return
      }
    }
    const result = await executeGardenerThreadLifecycle({
      mode: intent.mode,
      targets,
      foregroundThreadId: options.session.id,
    })
    appendGardenerChatMessage(
      options.config.stackDataRoot,
      gardenerThreadId(state),
      "user",
      message,
      opts?.source ? { source: opts.source } : undefined,
    )
    appendGardenerChatMessage(
      options.config.stackDataRoot,
      gardenerThreadId(state),
      "gardener",
      result.message,
    )
    state.gardenerNotice = result.message
    await refreshHistory()
    refreshMetaEvents()
    await refreshThreadGoalStatus(options, state)
    refresh()
    return
  }

  if (intent.mode === "viewed" || intent.mode === "unviewed") {
    const filterSummaries =
      intent.body.trim().toLowerCase() === "filter"
        ? lightsThreadSummariesForView(options, state, 120)
        : undefined
    const resolved = resolveLightsThreadViewTargets({
      body: intent.body,
      history: state.history,
      gardenerThreadId: gardenerThreadId(state),
      workerTargetId: resolveGardenerWorkerTargetId(options, state),
      filteredSummaries: filterSummaries,
    })
    if (!resolved.ok) {
      state.gardenerNotice = resolved.error
      refresh()
      return
    }
    const resultMessage =
      intent.mode === "viewed"
        ? `marked ${resolved.threadIds.length} thread${resolved.threadIds.length === 1 ? "" : "s"} viewed`
        : `marked ${resolved.threadIds.length} thread${resolved.threadIds.length === 1 ? "" : "s"} unviewed`
    if (intent.mode === "viewed") {
      markLightsThreadViewedInState(options.config.stackDataRoot, state, resolved.threadIds)
    } else {
      markLightsThreadUnviewedInState(options.config.stackDataRoot, state, resolved.threadIds)
    }
    appendGardenerChatMessage(
      options.config.stackDataRoot,
      gardenerThreadId(state),
      "user",
      message,
      opts?.source ? { source: opts.source } : undefined,
    )
    appendGardenerChatMessage(options.config.stackDataRoot, gardenerThreadId(state), "gardener", resultMessage)
    state.gardenerNotice = resultMessage
    refresh()
    return
  }

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
    parsed.displayText,
    opts?.source ? { source: opts.source } : undefined,
  )
  refreshMetaEvents()
  state.gardenerScrollPinned = true
  state.gardenerScrollOffset = 0
  state.workerHarnessSnapshot = snapshotWorkerHarness(options.config)
  resetGardenerLiveTranscript(state)
  state.gardenerLiveThinking = "starting…"
  state.gardenerChatStartedAt = new Date().toISOString()
  seedGardenerLiveThinkingBlock(state)
  state.gardenerChatRunning = true
  refresh()
  const liveSink = createGardenerLiveSink(state, refresh)
  try {
    const response = await runGardenerChatTurn({
      config: options.config,
      gardenerThreadId: gardenerThreadId(state),
      userMessage: intent.body || parsed.displayText,
      imagePaths: parsed.imagePaths,
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
    state.gardenerChatStartedAt = undefined
    state.workerHarnessSnapshot = undefined
    resetGardenerLiveTranscript(state)
    refresh()
    const queuedPrompt = state.gardenerQueuedMessages.shift()
    if (queuedPrompt) {
      void submitGardenerInputValue(
        queuedPrompt,
        options,
        state,
        codexSessionHandle,
        renderer,
        refresh,
        refreshHistory,
        refreshMetaEvents,
      )
    }
  }
}

function shouldRunGardenerSubmitImmediatelyWhileRunning(prompt: string): boolean {
  if (parseSlashCommand(prompt) || isGoalSlashCommand(prompt)) return true
  const stripped = isExplicitGardenerPrefix(prompt) ? stripGardenerMessagePrefix(prompt) : prompt
  const parsed = parseChannelInput(stripped)
  const message = parsed.text || parsed.displayText
  if (parseGardenerLightsFilterSubmit(message) !== null) return true
  const intent = gardenerSubmitIntent(message)
  return intent.mode === "archive" || intent.mode === "revive" || intent.mode === "viewed" || intent.mode === "unviewed"
}

function queueGardenerSubmit(state: AppState, prompt: string, refresh: () => void): void {
  state.gardenerQueuedMessages = [...state.gardenerQueuedMessages, prompt]
  state.gardenerNotice = `queued (${state.gardenerQueuedMessages.length})`
  refresh()
}

function gardenerPanelModeBar(state: AppState, refresh: () => void): ReturnType<typeof Box> {
  const selectMode = (mode: GardenerPanelMode) => {
    state.gardenerPanelMode = mode
    state.focusMode = "gardener"
    refresh()
  }
  return renderPanelTabBar([
    { label: "chat", active: state.gardenerPanelMode === "chat", onSelect: () => selectMode("chat") },
    { label: "events", active: state.gardenerPanelMode === "events", onSelect: () => selectMode("events") },
  ])
}

function buildGardenerChatTranscriptView(
  options: StackAppOptions,
  state: AppState,
  events: StackThreadMetaEvent[],
): GardenerChatTranscript {
  const turns = readGardenerSessionTurns(options, state.gardenerThreadId)
  const persisted = buildGardenerChatTranscript(events, turns)
  if (!state.gardenerChatRunning) return persisted
  return {
    blocks: mergeRoleChatBlocks(persisted.blocks, state.gardenerLiveBlocks),
    tools: [...persisted.tools, ...state.gardenerLiveTools],
    subagents: [...persisted.subagents, ...state.gardenerLiveSubagents],
  }
}

function readGardenerSessionTurns(options: StackAppOptions, gardenerThreadId: string): StackCodexTurn[] {
  const path = join(options.config.sessionLogDir, `${gardenerThreadId}.json`)
  if (!existsSync(path)) return []
  try {
    const session = JSON.parse(readFileSync(path, "utf8")) as StackLocalSession
    return session.turns ?? []
  } catch {
    return []
  }
}

function gardenerHarnessRows(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): ReturnType<typeof Box>[] {
  const config = options.config
  const gardenerConfig = loadGardenerConfig(config.stackDataRoot)
  const workerHarness = workerHarnessForDisplay(config, state)
  const cursorHarness = isCursorHarness(config)
  const rowProps = {
    flexDirection: "row" as const,
    gap: stackTuiLayout.panelGap,
    alignItems: "center" as const,
    width: "100%" as const,
    overflow: "hidden" as const,
    flexShrink: 0 as const,
  }

  const gardenerRow = Box(
    rowProps,
    controlLabel(agentRoleLabel("gardener")),
    controlChip(gardenerConfig.model.model, false),
    ...(cursorHarness
      ? []
      : [controlDivider(), controlChip(gardenerConfig.model.reasoningEffort, false)]),
    controlDivider(),
    focusControlChip(`env ${config.environmentName}`, "environment", state, refresh),
  )

  const workerRow = Box(
    rowProps,
    controlLabel(agentRoleLabel("worker")),
    controlChip(workerHarness.codexModel, false),
    ...(cursorHarness
      ? []
      : [controlDivider(), controlChip(workerHarness.codexReasoningEffort, false)]),
    controlDivider(),
    controlChip(`env ${config.environmentName}`, false),
  )

  return [gardenerRow, workerRow]
}

function gardenerControlRow(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  columns: number,
): ReturnType<typeof Box> {
  const config = options.config
  const gardenerConfig = loadGardenerConfig(config.stackDataRoot)
  const cursorHarness = isCursorHarness(config)
  const voiceHint = panelVoiceHintLine(state, "gardener", state.gardenerNotice)
  const slashCtx = buildSlashCommandContext(options, state)
  const rowProps = {
    flexDirection: "row" as const,
    gap: stackTuiLayout.panelGap,
    alignItems: "center" as const,
    width: "100%" as const,
    overflow: "hidden" as const,
    flexShrink: 0 as const,
  }
  return Box(
    {
      flexDirection: "column",
      gap: stackTuiLayout.panelGap,
    },
    ...(voiceHint
      ? [
          Text({
            content: voiceHint,
            fg: voiceHintColor(state, state.gardenerNotice),
            width: "100%",
          }),
        ]
      : []),
    Text({
      content: renderGardenerInputStyled(options, state, columns),
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
    Box(
      rowProps,
      controlLabel(agentRoleLabel("gardener")),
      focusControlChip(gardenerConfig.model.model, "model", state, refresh),
      ...(cursorHarness
        ? []
        : [controlDivider(), focusControlChip(gardenerConfig.model.reasoningEffort, "effort", state, refresh)]),
      controlDivider(),
      focusControlChip(`env ${config.environmentName}`, "environment", state, refresh),
    ),
  )
}

function gardenerInputBackground(state: AppState): string {
  if (state.focusMode === "gardener" || state.gardenerInputBuffer.length > 0) return theme.bgInputFocused
  return theme.bgPanel
}

function renderGardenerInputStyled(options: StackAppOptions, state: AppState, columns?: number): StyledText {
  const idleHint = isLightsPanelOpen(state)
    ? "viewed/unviewed · archive · filter · /usage · /help"
    : "Message gardener · /usage · /help"
  return renderWorkerAgentInputStyled(
    {
      status: state.gardenerChatRunning ? "running" : "idle",
      focusMode: state.focusMode,
      agentChatPaused: false,
      inputBuffer: state.gardenerInputBuffer,
      queuedMessages: state.gardenerQueuedMessages,
      spinnerFrame: state.spinnerFrame,
      toolLogs: state.gardenerLiveTools,
      currentTurnStartedAt: state.gardenerChatStartedAt,
      columns,
      showRecentToolActivity: true,
    },
    {
      idleHint,
      promptColor: "#3fb950",
    },
  )
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
  const pct = Math.round(state.rightPanelWidthFraction * 100)
  return `${pct}%`
}

function monitorPanelColumns(renderer: CliRenderer, state: AppState): number {
  return Math.max(24, Math.floor(renderer.terminalWidth * state.rightPanelWidthFraction) - 8)
}

function renderRightPanelResizeHandle(
  renderer: CliRenderer,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): ReturnType<typeof Box> {
  const active = state.rightPanelResizeDragging
  const applyDrag = (event: PanelMouseEvent) => {
    event.preventDefault?.()
    event.stopPropagation?.()
    if (event.x === undefined) return
    const next = rightPanelFractionFromMouseX(renderer.terminalWidth, event.x)
    if (Math.abs(next - state.rightPanelWidthFraction) < 0.005) return
    state.rightPanelResizeDragging = true
    state.rightPanelWidthFraction = next
    refresh()
  }
  return Box(
    {
      width: 1,
      flexShrink: 0,
      flexDirection: "column",
      onMouseDown(event: PanelMouseEvent) {
        event.preventDefault?.()
        event.stopPropagation?.()
        state.rightPanelResizeDragging = true
        applyDrag(event)
      },
      onMouseDrag(event: PanelMouseEvent) {
        applyDrag(event)
      },
      onMouseDragEnd(event: PanelMouseEvent) {
        event.preventDefault?.()
        event.stopPropagation?.()
        state.rightPanelResizeDragging = false
        writeStackUxSettings(options.config.stackDataRoot, {
          rightPanelWidthFraction: state.rightPanelWidthFraction,
        })
        refresh()
      },
    },
    Text({
      content: "▐",
      fg: active ? theme.borderActive : theme.synth.amber,
      width: 1,
      flexGrow: 1,
    }),
  )
}

function gardenerPanelColumns(renderer: CliRenderer, fraction = LEFT_GARDENER_PANEL_COLUMNS_FRACTION): number {
  const panelChars = Math.floor(renderer.terminalWidth * fraction)
  return Math.max(36, panelChars - 6)
}

function gardenerChatVisibleRows(renderer: CliRenderer, state: AppState): number {
  const total = gardenerThreadVisibleRows(renderer, state)
  let chrome = 6
  if (panelVoiceHintLine(state, "gardener", state.gardenerNotice)) chrome += 1
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
  if (value === "codex-app-server") return "codex"
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
  opts?: { echoInWorker?: boolean },
): Promise<void> {
  const parsed = parseChannelInput(message)
  if (parsed.missingPaths.length > 0 && opts?.echoInWorker !== false) {
    appendStackBlock(
      state.blocks,
      `monitor image not found: ${parsed.missingPaths.map((path) => path.split("/").pop() ?? path).join(", ")}`,
    )
  }
  if (opts?.echoInWorker !== false) {
    appendStackBlock(state.blocks, `monitor ← ${oneLine(parsed.displayText, 72)}`)
    refresh()
  }
  const threadId = resolveMonitorWorkerTargetId(options, state)
  void (async () => {
    const directName = await tryApplyThreadNameFromOperatorMessage({
      stackRoot: options.config.stackDataRoot,
      sessionLogDir: options.config.sessionLogDir,
      threadId,
      message: parsed.displayText,
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
    await submitMonitorOperatorMessage(
      message,
      options,
      state,
      refresh,
      refreshHistory,
      refreshMetaEvents,
      { echoInWorker: false },
    )
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
    const codexSession = codexSessionHandle.session
    if (codexSession) {
      void codexSession.trySteer(kickoff).then((steered) => {
        if (steered) {
          appendUserBlock(state.blocks, transcriptLabel)
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
  trackActiveTurn(
    state,
    submitPrompt(
      kickoff,
      options,
      state,
      codexSessionHandle,
      renderer,
      refresh,
      refreshHistory,
      refreshMetaEvents,
      { transcriptPrompt: transcriptLabel },
    ),
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

type SlashFeedbackChannel = "agent" | "gardener"

function appendSlashFeedback(
  options: StackAppOptions,
  state: AppState,
  message: string,
  channel: SlashFeedbackChannel,
  refresh: () => void,
): void {
  if (channel === "gardener") {
    appendGardenerChatMessage(
      options.config.stackDataRoot,
      gardenerThreadId(state),
      "gardener",
      message,
      { source: "slash" },
    )
    state.focusMode = "gardener"
    state.gardenerPanelMode = "chat"
    state.gardenerScrollPinned = true
    state.gardenerScrollOffset = 0
    state.gardenerNotice = undefined
  } else {
    appendStackBlock(state.blocks, message)
  }
  refresh()
}

function appendGardenerSlashUserMessage(
  options: StackAppOptions,
  state: AppState,
  prompt: string,
): void {
  appendGardenerChatMessage(
    options.config.stackDataRoot,
    gardenerThreadId(state),
    "user",
    prompt,
    { source: "slash" },
  )
}

async function awaitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
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
  refreshCodexRateLimits: () => Promise<void>,
  refreshRemoteAccount: () => Promise<void>,
  refreshRemoteUsage: () => Promise<void>,
  feedbackChannel: SlashFeedbackChannel = "agent",
): SlashDispatchHooks {
  return {
    exit,
    feedback: (message) => {
      appendSlashFeedback(options, state, message, feedbackChannel, refresh)
    },
    openGardener: () => openGardenerPanel(options, state, refresh, "slash"),
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
    setMonitorView: (view) => {
      if (view === "goal") {
        if (hasGoalContext(state)) {
          selectWorkerPanelView(state, "goal", refresh)
        }
        return
      }
      const mode: MonitorPanelMode = view === "stream" ? "events" : "chat"
      openMonitorPanel(
        options,
        state,
        refresh,
        mode,
        `slash:${view}`,
      )
    },
    messageMonitor: (message) => {
      void submitMonitorOperatorMessage(message, options, state, refresh, refreshHistory, refreshMetaEvents)
    },
    setLights: (enabled) => {
      const previousFocusMode = state.focusMode
      if (enabled) {
        state.rightPanelOpen = true
        state.rightPanelContent = "lights"
        state.rightPanelOpsVisible = false
        state.opsScrollOffset = 0
        appendStackBlock(state.blocks, "lights on")
      } else {
        if (state.rightPanelOpen && state.rightPanelContent === "lights") {
          appendUiPanelClosed(options, state, "ops", "slash:lights")
          state.rightPanelOpen = false
          state.rightPanelContent = "default"
          state.rightPanelOpsVisible = false
        }
        appendStackBlock(state.blocks, "lights off")
      }
      state.focusMode = previousFocusMode
      writeStackUxSettings(options.config.stackDataRoot, { lightsPanelOpen: enabled })
      refresh()
    },
    cycleEnvironment: (direction) => {
      void cycleStackEnvironmentFromUi(direction)
    },
    setEnvironment: (name) => {
      if (!STACK_ENVIRONMENT_OPTIONS.includes(name as StackEnvironmentName)) return false
      void refreshAfterEnvironmentChange(name as StackEnvironmentName)
      return true
    },
    cycleProvider: (direction) => {
      void switchProviderFromSlash(options, state, codexSessionHandle, cycleHarnessProvider(options.config, direction), refresh)
    },
    setProvider: (name) => {
      const harness = providerSlashArgToHarness(name)
      if (!harness) return false
      void switchProviderFromSlash(options, state, codexSessionHandle, harness, refresh)
      return true
    },
    cycleProfile: (direction) => {
      const current = readStackProfile(options.config.stackDataRoot).active
      applyStackProfile(nextStackProfile(current, direction), options, state, refresh)
    },
    capturePapercut: (note) => {
      capturePapercutFromUi(options, state, refresh, note || undefined)
    },
    setProfile: (name) => {
      const profile = normalizeStackProfileName(name)
      if (!profile) return false
      applyStackProfile(profile, options, state, refresh)
      return true
    },
    setWorkMode: (mode) => {
      state.workMode = mode
      appendStackBlock(state.blocks, `work_mode ${mode} (not wired yet)`)
      refresh()
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
      persistStackConfig(options, state, refresh)
      return true
    },
    showUsage: (view: UsageSlashView) => {
      const usagePrompt = view === "default" ? "/usage" : `/usage ${view}`
      if (feedbackChannel === "gardener") {
        appendGardenerSlashUserMessage(options, state, usagePrompt)
      }
      void appendUsageSummaryFresh(
        options,
        state,
        refresh,
        refreshCodexRateLimits,
        refreshRemoteAccount,
        refreshRemoteUsage,
        view,
        feedbackChannel,
      )
    },
    openExperimental: () => {
      state.focusMode = "experimental"
      refresh()
    },
    cycleEffort: () => {
      if (isCursorHarness(options.config)) {
        appendStackBlock(state.blocks, `reasoning effort ${CURSOR_REASONING_EFFORT_OPTIONS[0]}`)
        refresh()
        return
      }
      cycleEffort(options.config, 1)
      appendStackBlock(state.blocks, `reasoning effort ${options.config.codexReasoningEffort}`)
      persistStackConfig(options, state, refresh)
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
      openThreadsPanel(options, state, refresh, "slash")
    },
    openEfforts: (args) => {
      handleEffortsSlash(args ?? "", options, state, refresh)
    },
    startNewThread: () => {
      void startNewThread(options, state, codexSessionHandle, refresh, refreshHistory, refreshMetaEvents)
    },
    openOps: () => {
      state.rightPanelOpen = true
      state.rightPanelContent = "default"
      state.rightPanelOpsVisible = true
      state.focusMode = "ops"
      state.opsScrollOffset = 0
      appendUiPanelOpened(options, state, "ops", state.liveOpsMode === "remote" ? "remote" : "local", "operator", "slash")
      refresh()
    },
    openConfig: () => {
      state.focusMode = "config"
      state.configSelectedIndex = 0
      state.configNotice = undefined
      refresh()
    },
    openPermissions: () => {
      openPermissionsPanel(state, refresh)
    },
    openTelemetrySettings: () => {
      openPermissionsPanel(state, refresh)
    },
    toggleActors: () => {
      if (isMonitorOn(state.monitorSnapshot)) {
        toggleRightPanelOps(state)
        refresh()
      }
    },
    focusAgent: () => {
      if (focusGoalWorkerChat(state, refresh)) return
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

function appendUsageSummary(options: StackAppOptions, state: AppState, refresh: () => void): void {
  appendStackBlock(state.blocks, stackUsageSummaryText(options, state))
  refresh()
}

async function appendUsageSummaryFresh(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshCodexRateLimits: () => Promise<void>,
  refreshRemoteAccount: () => Promise<void>,
  refreshRemoteUsage: () => Promise<void>,
  view: UsageSlashView = "default",
  feedbackChannel: SlashFeedbackChannel = "agent",
): Promise<void> {
  const cached = stackUsageSummaryText(options, state, view)
  appendSlashFeedback(options, state, cached, feedbackChannel, refresh)

  try {
    const refreshed = await awaitWithTimeout(
      Promise.all([refreshCodexRateLimits(), refreshRemoteAccount(), refreshRemoteUsage()]),
      8_000,
    )
    if (!refreshed) {
      if (feedbackChannel === "gardener") {
        appendSlashFeedback(
          options,
          state,
          "usage refresh timed out — showing cached limits above",
          feedbackChannel,
          refresh,
        )
      }
      return
    }
    let accountUsage: CodexAccountUsageSnapshot | undefined
    if (!isCursorHarness(options.config) && isChatGptAuthPlan(harnessAuthPlan(options.config))) {
      accountUsage = await awaitWithTimeout(
        readCodexAccountUsage({
          codexCommand: options.config.codexCommand,
          codexArgs: options.config.codexArgs,
        }),
        8_000,
      )
    }
    const fresh = stackUsageSummaryText(options, state, view, accountUsage)
    if (fresh !== cached) {
      appendSlashFeedback(options, state, fresh, feedbackChannel, refresh)
    }
  } catch (error) {
    appendSlashFeedback(
      options,
      state,
      `usage refresh failed: ${errorMessage(error)}`,
      feedbackChannel,
      refresh,
    )
  }
}

function stackUsageSummaryText(
  options: StackAppOptions,
  state: AppState,
  view: UsageSlashView = "default",
  accountUsage?: CodexAccountUsageSnapshot,
): string {
  const config = options.config
  const provider = harnessAuthPlan(config)
  const model = harnessModel(config)
  const effort = isCursorHarness(config)
    ? CURSOR_REASONING_EFFORT_OPTIONS[0]
    : config.codexReasoningEffort
  const sessionUsage = buildSessionUsageSummary(options.session.turns, model, config.codexPricing)
  const agentUsage = buildOpsPanelAgentUsage(options, state)
  const lines: string[] = []

  if (view !== "default") {
    lines.push(`Usage · ${view}`)
    if (accountUsage) {
      lines.push(...formatCodexUsageActivityLines(view, accountUsage))
    } else {
      lines.push("  ChatGPT token activity unavailable (sign in to Codex)")
    }
  } else {
    lines.push("Usage")
    if (isCursorHarness(config)) {
      lines.push(`Cursor · ${model}`)
      if (agentUsage.codexEmail) lines.push(`  ${agentUsage.codexEmail}`)
      const cursorBudget = formatCursorBudgetSuffix(config.cursorAuthPlan, state.cursorAccount, config.cursorModel)
      lines.push(cursorBudget ? `  ${cursorBudget}` : "  Cursor budget unavailable")
    } else if (isChatGptAuthPlan(provider)) {
      const plan = state.codexRateLimits?.planType?.trim()
      lines.push(`ChatGPT${plan ? ` · ${plan}` : ""} · ${model} · ${effort}`)
      if (agentUsage.codexEmail) lines.push(`  ${agentUsage.codexEmail}`)
      const limitLines = formatCodexRateLimitsCardLines(state.codexRateLimits, provider)
      if (limitLines.length > 0) {
        lines.push(...limitLines)
      } else {
        const budget = formatCodexBudgetSuffix(config.codexAuthPlan, state.codexRateLimits)
        lines.push(budget ? `  ${budget}` : "  ChatGPT limits unavailable")
      }
      if (accountUsage) {
        const today = accountUsage.dailyUsageBuckets.at(-1)
        if (today) {
          lines.push(`  today ${today.startDate} · ${formatAccountTokenTotal(today.tokens)} tok`)
        }
      }
    } else {
      lines.push(`Provider · ${provider} · ${model} · ${effort}`)
      if (agentUsage.codexEmail) lines.push(`  ${agentUsage.codexEmail}`)
    }
    lines.push(`  session · ${formatSessionUsageSummary(sessionUsage)}`)
    lines.push(`  last turn · ${compactUsageWithThroughput(state.lastUsage, displayTokensPerSecond(state))}`)
    if (isChatGptAuthPlan(provider) && accountUsage) {
      lines.push("  token activity · /usage daily · weekly · cumulative")
    }
  }

  lines.push("")
  lines.push(...synthUsageSlashLines(state.remoteAccountSnapshot, state.remoteUsageSnapshot))
  return lines.filter((line) => line.length > 0).join("\n")
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 10 ? 2 : 3).replace(/0+$/, "").replace(/\.$/, "")}`
}

async function switchProviderFromSlash(
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  harness: StackHarnessKind,
  refresh: () => void,
): Promise<void> {
  const before = options.config.harness
  if (before === harness) {
    appendStackBlock(state.blocks, `provider ${harnessAuthPlan(options.config)}`)
    refresh()
    return
  }
  await applyHarnessSwitch(options, state, codexSessionHandle, harness, refresh)
  if (options.config.harness !== before) {
    persistStackConfig(options, state, refresh)
  }
}

function providerSlashArgToHarness(value: string): StackHarnessKind | undefined {
  const normalized = value.trim().toLowerCase()
  if (["chatgpt", "codex", "openai"].includes(normalized)) return "codex"
  if (["cursor", "composer"].includes(normalized)) return "cursor"
  return undefined
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
  state.agentChatPaused = false
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
    void submitMonitorOperatorMessage(message, options, state, refresh, refreshHistory, refreshMetaEvents, {
      echoInWorker: true,
    })
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

  const parsed = parseChannelInput(prompt)
  if (parsed.missingPaths.length > 0) {
    appendStackBlock(
      state.blocks,
      `image not found: ${parsed.missingPaths.map((path) => path.split("/").pop() ?? path).join(", ")}`,
    )
  }
  const channelPrompt = parsed.displayText
  if (!channelPrompt.trim() && parsed.imagePaths.length === 0) return

  if (state.status === "running" && codexSession) {
    if (forceQueue) {
      codexSession.enqueue(prompt)
      state.queuedMessages = [...state.queuedMessages, channelPrompt]
      state.lastSteerHint = `queued (${state.queuedMessages.length})`
      refresh()
      return
    }
    void codexSession.trySteer(prompt).then((steered) => {
      if (steered) {
        appendUserBlock(state.blocks, channelPrompt)
        state.lastSteerHint = "steered"
        refresh()
        return
      }
      codexSession.enqueue(prompt)
      state.queuedMessages = [...state.queuedMessages, channelPrompt]
      state.lastSteerHint = `queued (${state.queuedMessages.length})`
      refresh()
    })
    return
  }

  if (state.status === "running") return
  trackActiveTurn(
    state,
    submitPrompt(channelPrompt, options, state, codexSessionHandle, renderer, refresh, refreshHistory, refreshMetaEvents, {
      imagePaths: parsed.imagePaths,
    }),
  )
}

function readEvalUiHandleSettings(): EvalUiHandleSettings {
  const evalModeEnabled = process.env.STACK_EFFORT_EVAL_MODE === "1"
  const uiHandleRequested = process.env.STACK_EFFORT_UI_HANDLE === "1"
  return {
    evalModeEnabled,
    uiHandleEnabled: evalModeEnabled && uiHandleRequested,
    voiceInputEnabled: evalModeEnabled && uiHandleRequested && process.env.STACK_EFFORT_VOICE_INPUT === "1",
    humanInputFile: process.env.STACK_EFFORT_HUMAN_INPUT_FILE || undefined,
  }
}

function evalFeedbackEnabled(state: AppState): boolean {
  return state.evalModeEnabled && state.evalUiHandleEnabled
}

function handleEvalFeedbackSlash(prompt: string, state: AppState, refresh: () => void): boolean {
  const parsed = parseSlashCommand(prompt)
  if (!parsed) return false
  if (parsed.name !== "feedback" && parsed.name !== "eval" && parsed.name !== "eval-feedback") return false
  if (!evalFeedbackEnabled(state)) {
    appendStackBlock(state.blocks, "eval feedback is only available in eval mode")
    refresh()
    return true
  }
  const { kind, body } = parseEvalFeedbackSlashArgs(parsed.args)
  if (kind) state.evalModalKind = kind
  openEvalFeedbackModal(state, refresh, body)
  return true
}

function parseEvalFeedbackSlashArgs(args: string): { kind?: EvalFeedbackKind; body?: string } {
  const trimmed = args.trim()
  if (!trimmed) return {}
  const [first = "", ...rest] = trimmed.split(/\s+/)
  if (EVAL_FEEDBACK_KINDS.includes(first as EvalFeedbackKind)) {
    return { kind: first as EvalFeedbackKind, body: rest.join(" ") }
  }
  return { body: trimmed }
}

function openEvalFeedbackModal(state: AppState, refresh: () => void, initialText?: string): void {
  if (!evalFeedbackEnabled(state)) return
  state.evalModalOpen = true
  state.evalModalBuffer = initialText ?? ""
  state.evalModalVoiceUsed = false
  state.evalModalNotice = undefined
  refresh()
}

function closeEvalFeedbackModal(state: AppState, refresh: () => void): void {
  state.evalModalOpen = false
  state.evalModalBuffer = ""
  state.evalModalVoiceUsed = false
  state.evalModalNotice = undefined
  refresh()
}

function cycleEvalFeedbackKind(state: AppState, direction: number): void {
  const current = EVAL_FEEDBACK_KINDS.indexOf(state.evalModalKind)
  const next = (current + direction + EVAL_FEEDBACK_KINDS.length) % EVAL_FEEDBACK_KINDS.length
  state.evalModalKind = EVAL_FEEDBACK_KINDS[next] ?? "note"
}

function setEvalFeedbackKindByIndex(state: AppState, sequence: string): boolean {
  const index = Number.parseInt(sequence, 10) - 1
  const kind = EVAL_FEEDBACK_KINDS[index]
  if (!kind) return false
  state.evalModalKind = kind
  return true
}

function appendEvalHumanInputEvent(options: StackAppOptions, state: AppState, source: "keyboard" | "voice"): void {
  const body = state.evalModalBuffer.trim()
  if (!body || !state.evalHumanInputFile) return
  mkdirSync(dirname(state.evalHumanInputFile), { recursive: true })
  appendFileSync(
    state.evalHumanInputFile,
    JSON.stringify({
      ts: new Date().toISOString(),
      type: "human.eval_feedback",
      source,
      kind: state.evalModalKind,
      session_id: options.session.id,
      meta_thread_id: options.session.metaThreadId,
      body,
    }) + "\n",
  )
}

function submitEvalFeedbackModal(options: StackAppOptions, state: AppState, refresh: () => void): boolean {
  const body = state.evalModalBuffer.trim()
  if (!body) {
    state.evalModalNotice = "write feedback before saving"
    refresh()
    return true
  }
  try {
    appendEvalHumanInputEvent(options, state, state.evalModalVoiceUsed ? "voice" : "keyboard")
    appendStackBlock(state.blocks, `eval feedback saved · ${state.evalModalKind} · ${oneLine(body, 80)}`)
    state.evalModalBuffer = ""
    state.evalModalVoiceUsed = false
    state.evalModalOpen = false
    state.evalModalNotice = undefined
  } catch (error) {
    state.evalModalNotice = `save failed: ${errorMessage(error)}`
  }
  refresh()
  return true
}

function appendVoiceTranscriptToEvalFeedback(
  state: AppState,
  text: string,
  provider: string,
  refresh: () => void,
): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    state.evalModalNotice = "voice: no speech detected"
    refresh()
    return false
  }
  if (isLikelyJunkVoiceTranscript(trimmed)) {
    state.evalModalNotice = "voice: ignored filler; try again"
    refresh()
    return false
  }
  state.evalModalBuffer = state.evalModalBuffer.trim()
    ? `${state.evalModalBuffer.trim()} ${trimmed}`
    : trimmed
  state.evalModalVoiceUsed = true
  state.evalModalNotice = `voice ready · ${provider} · enter saves`
  refresh()
  return true
}

function handleEvalFeedbackKey(
  key: StackKeyEvent,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): boolean {
  if (!evalFeedbackEnabled(state)) return false
  if (key.ctrl && key.name === "e") {
    if (state.evalModalOpen) {
      closeEvalFeedbackModal(state, refresh)
    } else {
      openEvalFeedbackModal(state, refresh)
    }
    return true
  }
  if (isVoiceKeyCandidate(key) || isVoiceKeyRelease(key)) return false
  if (!state.evalModalOpen) {
    return false
  }
  if (key.name?.toLowerCase() === "escape") {
    closeEvalFeedbackModal(state, refresh)
    return true
  }
  if (isEnterKey(key)) return submitEvalFeedbackModal(options, state, refresh)
  if (key.name === "tab") {
    cycleEvalFeedbackKind(state, key.shift ? -1 : 1)
    refresh()
    return true
  }
  if (key.name === "backspace" || key.name === "delete" || key.name === "BSpace") {
    state.evalModalBuffer = state.evalModalBuffer.slice(0, -1)
    state.evalModalNotice = undefined
    refresh()
    return true
  }
  if (key.name === "space") {
    state.evalModalBuffer += " "
    state.evalModalNotice = undefined
    refresh()
    return true
  }
  if (typeof key.name === "string" && /^[1-6]$/.test(key.name) && setEvalFeedbackKindByIndex(state, key.name)) {
    refresh()
    return true
  }
  if (typeof key.name === "string" && key.name.length === 1 && !key.ctrl) {
    state.evalModalBuffer += key.name
    state.evalModalNotice = undefined
    refresh()
    return true
  }
  return true
}

function handleRawEvalFeedbackInput(
  sequence: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): boolean {
  if (!evalFeedbackEnabled(state)) return false
  if (sequence === "\x05") {
    if (state.evalModalOpen) {
      closeEvalFeedbackModal(state, refresh)
    } else {
      openEvalFeedbackModal(state, refresh)
    }
    return true
  }
  if (shouldDeferRawSequenceForVoiceHold(sequence)) return false
  if (!state.evalModalOpen) {
    return false
  }
  if (sequence === "\x1b") {
    closeEvalFeedbackModal(state, refresh)
    return true
  }
  if (isRawEnterSequence(sequence)) return submitEvalFeedbackModal(options, state, refresh)
  if (sequence === "\t") {
    cycleEvalFeedbackKind(state, 1)
    refresh()
    return true
  }
  if (sequence === "\x7f" || sequence === "\b") {
    state.evalModalBuffer = state.evalModalBuffer.slice(0, -1)
    state.evalModalNotice = undefined
    refresh()
    return true
  }
  if (setEvalFeedbackKindByIndex(state, sequence)) {
    refresh()
    return true
  }
  if (sequence.length === 1 && sequence >= " ") {
    state.evalModalBuffer += sequence
    state.evalModalNotice = undefined
    refresh()
    return true
  }
  return true
}

function renderEvalFeedbackModal(state: AppState) {
  if (!evalFeedbackEnabled(state) || !state.evalModalOpen) return undefined
  const kindLine = EVAL_FEEDBACK_KINDS
    .map((kind, index) => `${index + 1} ${kind === state.evalModalKind ? `[${kind}]` : kind}`)
    .join("  ")
  const voiceHint = state.evalVoiceInputEnabled ? "Shift+V voice" : "voice off"
  const body = state.evalModalBuffer || "Type feedback for the eval trace..."
  return Box(
    {
      border: true,
      borderStyle: "double",
      borderColor: theme.synth.amber,
      title: "Effort Bench Feedback",
      flexDirection: "column",
      gap: 1,
      padding: 1,
      width: "100%",
    },
    Text({ content: kindLine, fg: theme.synth.gold }),
    Text({ content: body, fg: state.evalModalBuffer ? theme.fgPrimary : theme.fgMuted }),
    Text({
      content: `${voiceHint} · 1-6 kind · Tab cycle · Enter save · Esc close`,
      fg: theme.fgMuted,
    }),
    ...(state.evalModalNotice ? [Text({ content: state.evalModalNotice, fg: theme.synth.amber })] : []),
    Text({ content: `capture ${state.evalHumanInputFile ? relative(process.cwd(), state.evalHumanInputFile) : "not configured"}`, fg: theme.fgMuted }),
  )
}

function resolveVoiceInputTarget(state: AppState): VoiceInputTarget | undefined {
  if (state.evalModalOpen && state.evalVoiceInputEnabled) return "worker"
  if (state.focusMode === "gardener") return "gardener"
  if (state.gardenerInputBuffer.trim().length > 0) return "gardener"
  if (state.focusMode === "monitor") return "monitor"
  if (state.focusMode === "agent") return "worker"
  return undefined
}

function activeVoiceInputTarget(state: AppState): VoiceInputTarget | undefined {
  if (state.voiceRecording || state.voiceTranscribing || state.voiceFinishInFlight) {
    return state.voiceRecordingTarget
  }
  return resolveVoiceInputTarget(state)
}

function panelVoiceHintLine(
  state: AppState,
  target: VoiceInputTarget,
  notice?: string,
): string | undefined {
  if (notice) return notice
  const activeTarget = activeVoiceInputTarget(state)
  if (state.voiceRecording || state.voiceTranscribing) {
    if (activeTarget !== target) return undefined
    return voiceInputHintLine({
      status: state.voiceStatus,
      recording: Boolean(state.voiceRecording),
      transcribing: state.voiceTranscribing,
      target,
    })
  }
  if (
    activeTarget === target &&
    (state.voiceStatus.health === "OFF" || state.voiceStatus.health === "BLOCKED")
  ) {
    return voiceInputHintLine({
      status: state.voiceStatus,
      recording: false,
      transcribing: false,
      target,
    })
  }
  if (activeTarget === target && state.voiceStatus.health === "READY") {
    if (target === "gardener") {
      return "Shift+V · voice · type or speak · enter to send"
    }
    return `Shift+V · voice → ${target} · enter to send`
  }
  return undefined
}

function voiceHintColor(state: AppState, notice?: string): string {
  if (notice) return theme.synth.amber
  if (state.voiceRecording) return theme.synth.gold
  if (state.voiceTranscribing) return theme.synth.amber
  return theme.fgMuted
}

function setGardenerNotice(state: AppState, message: string | undefined, refresh: () => void): void {
  state.gardenerNotice = message
  refresh()
}

function isVoiceKeyCandidate(key: { name?: string; shift?: boolean; ctrl?: boolean; meta?: boolean }): boolean {
  return isVoiceHoldKeyPress(key)
}

function isVoiceKeyRelease(key: { name?: string; ctrl?: boolean; meta?: boolean }): boolean {
  return isVoiceHoldKeyRelease(key)
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

const VOICE_RESTART_SUPPRESSION_MS = 900
const VOICE_TOGGLE_REPEAT_GAP_MS = 900

function handleVoiceKey(key: StackKeyEvent, kind: "press" | "release", ctx: VoiceKeyContext): boolean {
  const target = ctx.state.voiceRecordingTarget ?? resolveVoiceInputTarget(ctx.state)
  if (!target) return false

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
    void (target === "gardener" ? finishVoiceHoldToGardener(ctx) : finishVoiceHold(ctx))
    return true
  }

  if (!isVoiceKeyCandidate(key)) return false
  key.preventDefault?.()
  key.stopPropagation?.()

  const now = Date.now()
  const sinceLastVoicePress = now - (ctx.state.voiceLastCandidatePressAtMs ?? 0)
  ctx.state.voiceLastCandidatePressAtMs = now

  if (ctx.state.voiceRecording) {
    const heldMs = voiceHoldElapsedMs(ctx.state.voiceRecordingStartedAt)
    if (heldMs < MIN_VOICE_HOLD_MS || sinceLastVoicePress < VOICE_TOGGLE_REPEAT_GAP_MS) {
      return true
    }
    void (target === "gardener" ? finishVoiceHoldToGardener(ctx) : finishVoiceHold(ctx))
    return true
  }
  if (ctx.state.voiceTranscribing || ctx.state.voiceFinishInFlight) {
    return true
  }
  if ((ctx.state.voiceSuppressStartUntilMs ?? 0) > Date.now()) {
    return true
  }
  if (target === "gardener") {
    startVoiceHoldToGardener(ctx.options, ctx.state, ctx.refresh)
  } else {
    startVoiceHold(ctx.options, ctx.state, ctx.refresh)
  }
  return true
}

function appendVoiceNotice(
  state: AppState,
  message: string,
  refresh: () => void,
  target?: VoiceInputTarget,
): void {
  const resolved = target ?? resolveVoiceInputTarget(state)
  if (resolved === "gardener") {
    setGardenerNotice(state, message, refresh)
    return
  }
  if (resolved === "monitor") {
    state.monitorNotice = message
    refresh()
    return
  }
  appendStackBlock(state.blocks, message)
  refresh()
}

async function cancelVoiceRecording(state: AppState, refresh: () => void, message?: string): Promise<void> {
  const recording = state.voiceRecording
  const target = state.voiceRecordingTarget
  state.voiceRecording = undefined
  state.voiceRecordingStartedAt = undefined
  state.voiceRecordingTarget = undefined
  state.voiceLastCandidatePressAtMs = undefined
  state.voiceSuppressStartUntilMs = Date.now() + VOICE_RESTART_SUPPRESSION_MS
  if (recording) {
    await recording.stop().catch(() => undefined)
  }
  if (message) {
    appendVoiceNotice(state, message, refresh, target)
    return
  }
  refresh()
}

function applyVoiceTranscriptToGardenerInput(
  state: AppState,
  text: string,
  _provider: string,
  refresh: () => void,
): string | undefined {
  const trimmed = text.trim()
  if (!trimmed) {
    appendVoiceNotice(state, "voice: no speech detected", refresh, "gardener")
    return undefined
  }
  if (isLikelyJunkVoiceTranscript(trimmed)) {
    appendVoiceNotice(state, "voice: ignored filler — try again", refresh, "gardener")
    return undefined
  }
  const combined = state.gardenerInputBuffer.trim()
    ? `${state.gardenerInputBuffer.trim()} ${trimmed}`
    : trimmed
  state.gardenerInputBuffer = combined
  return combined
}

function applyVoiceTranscriptToMonitorInput(
  state: AppState,
  text: string,
  provider: string,
  refresh: () => void,
): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    appendVoiceNotice(state, "voice: no speech detected", refresh, "monitor")
    return false
  }
  if (isLikelyJunkVoiceTranscript(trimmed)) {
    appendVoiceNotice(state, "voice: ignored filler — try again", refresh, "monitor")
    return false
  }
  state.monitorInputBuffer = state.monitorInputBuffer.trim()
    ? `${state.monitorInputBuffer.trim()} ${trimmed}`
    : trimmed
  appendVoiceNotice(state, `voice ready · ${provider} · enter to send`, refresh, "monitor")
  return true
}

function applyVoiceTranscriptToWorkerInput(
  state: AppState,
  text: string,
  provider: string,
  refresh: () => void,
): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    appendVoiceNotice(state, "voice: no speech detected", refresh, "worker")
    return false
  }
  if (isLikelyJunkVoiceTranscript(trimmed)) {
    appendVoiceNotice(state, "voice: ignored filler — try again", refresh, "worker")
    return false
  }
  state.inputBuffer = state.inputBuffer.trim() ? `${state.inputBuffer.trim()} ${trimmed}` : trimmed
  appendVoiceNotice(state, `voice ready · ${provider} · enter to send`, refresh, "worker")
  return true
}

function startVoiceHold(options: StackAppOptions, state: AppState, refresh: () => void): void {
  startVoiceHoldForTarget(options, state, refresh, resolveVoiceInputTarget(state))
}

function startVoiceHoldToGardener(options: StackAppOptions, state: AppState, refresh: () => void): void {
  startVoiceHoldForTarget(options, state, refresh, "gardener")
}

function startVoiceHoldForTarget(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  target: VoiceInputTarget | undefined,
): void {
  if (state.voiceRecording || state.voiceTranscribing) return
  if (!target) return
  if (target === "gardener") state.gardenerNotice = undefined
  if (target === "monitor") state.monitorNotice = undefined
  state.voiceStatus = readVoiceStatus(options.config)
  if (state.voiceStatus.health === "OFF") {
    appendVoiceNotice(state, "voice disabled; set voice.enabled=true in stack.config.json or STACK_VOICE_ENABLED=1", refresh, target)
    return
  }
  if (state.voiceStatus.health === "BLOCKED") {
    appendVoiceNotice(state, `voice blocked: ${state.voiceStatus.message}`, refresh, target)
    return
  }
  try {
    state.voiceRecording = startVoiceRecording(options.config.stackDataRoot)
    state.voiceRecordingStartedAt = state.voiceRecording.startedAt
    state.voiceRecordingTarget = target
  } catch (error) {
    appendVoiceNotice(state, `voice recording failed: ${errorMessage(error)}`, refresh, target)
  }
  refresh()
}

async function finishVoiceHoldToGardener(ctx: VoiceKeyContext): Promise<void> {
  if (ctx.state.voiceRecordingTarget && ctx.state.voiceRecordingTarget !== "gardener") return
  ctx.state.voiceRecordingTarget = "gardener"
  await finishVoiceHold(ctx)
}

async function finishVoiceHold(ctx: VoiceKeyContext): Promise<void> {
  const { options, state, refresh } = ctx
  const recording = state.voiceRecording
  const target = state.voiceRecordingTarget ?? resolveVoiceInputTarget(state)
  if (!recording || !target || state.voiceTranscribing || state.voiceFinishInFlight) return
  state.voiceFinishInFlight = true
  state.voiceRecording = undefined
  state.voiceRecordingStartedAt = undefined
  state.voiceTranscribing = true
  refresh()
  try {
    const captured = await recording.stop()
    if (captured.durationMs < MIN_VOICE_HOLD_MS) {
      appendVoiceNotice(state, "voice: too short — hold Shift+V longer", refresh, target)
      return
    }
    const transcription = await transcribeAudio(captured.audio, {
      mime: "audio/wav",
      language: options.config.voice.language,
      config: voiceSttConfigFromStack(options.config.voice),
    })
    state.voiceStatus = readVoiceStatus(options.config)
    if (target === "gardener") {
      const message = applyVoiceTranscriptToGardenerInput(state, transcription.text, transcription.provider, refresh)
      if (message) {
        state.gardenerNotice = undefined
        refresh()
        void submitGardenerInputValue(
          message,
          options,
          state,
          ctx.codexSessionHandle,
          ctx.renderer,
          refresh,
          ctx.refreshHistory,
          ctx.refreshMetaEvents,
          { source: "voice" },
        )
      }
    } else if (target === "monitor") {
      applyVoiceTranscriptToMonitorInput(state, transcription.text, transcription.provider, refresh)
    } else if (state.evalModalOpen && state.evalVoiceInputEnabled) {
      appendVoiceTranscriptToEvalFeedback(state, transcription.text, transcription.provider, refresh)
    } else {
      applyVoiceTranscriptToWorkerInput(state, transcription.text, transcription.provider, refresh)
    }
  } catch (error) {
    appendVoiceNotice(state, `voice failed: ${errorMessage(error)}`, refresh, target)
  } finally {
    state.voiceTranscribing = false
    state.voiceFinishInFlight = false
    state.voiceRecordingTarget = undefined
    state.voiceLastCandidatePressAtMs = undefined
    state.voiceSuppressStartUntilMs = Date.now() + VOICE_RESTART_SUPPRESSION_MS
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

function activeInputIsExitCommand(state: AppState): boolean {
  return isExitCommandText(activeInputBuffer(state))
}

function isExitCommandText(value: string): boolean {
  return /^\/(?:exit|quit)\s*$/i.test(value.trim())
}

function consumeRawExitCommand(sequence: string, state: AppState): boolean {
  const text = sequence.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
  if (!text) return false

  if (text === "\u007f" || text === "\b") {
    state.rawCommandTail = state.rawCommandTail.slice(0, -1)
    return false
  }

  const combined = `${state.rawCommandTail}${text}`
  if (!/[\r\n]/.test(combined)) {
    if (/^[\x20-\x7e]+$/.test(text)) {
      state.rawCommandTail = combined.slice(-64)
    }
    return false
  }

  const parts = combined.split(/\r\n|\r|\n/)
  const submitted = parts.slice(0, -1).some(isExitCommandText)
  state.rawCommandTail = (parts.at(-1) ?? "").slice(-64)
  return submitted
}

function handleRawAgentInput(
  sequence: string,
  state: AppState,
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
    deferSequence: shouldDeferRawSequenceForVoiceHold,
    blockWhileRunning: true,
    isRunning: state.status === "running" && !state.agentChatPaused,
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
    deferSequence: shouldDeferRawSequenceForVoiceHold,
  })
}

function handleRawGardenerInput(
  sequence: string,
  state: AppState,
  submit: () => boolean,
  refresh: () => void,
): boolean {
  if (state.focusMode !== "gardener" && state.gardenerInputBuffer.trim().length === 0) return false
  if (state.focusMode !== "gardener" && state.gardenerInputBuffer.trim().length > 0) {
    state.focusMode = "gardener"
  }
  return handleRawTextInputSequence({
    sequence,
    readBuffer: () => state.gardenerInputBuffer,
    writeBuffer: (next) => {
      noteInputBufferEdit(state, state.gardenerInputBuffer, next)
      state.gardenerInputBuffer = next
      syncGardenerInputToLightsThreadFilter(state, next)
    },
    submit,
    refresh,
    deferSequence: shouldDeferRawSequenceForVoiceHold,
  })
}

function handleRawLightsFilterInput(
  sequence: string,
  state: AppState,
  refresh: () => void,
): boolean {
  if (state.focusMode !== "lights-filter") return false
  return handleRawTextInputSequence({
    sequence,
    readBuffer: () => state.lightsThreadFilter,
    writeBuffer: (next) => {
      state.lightsThreadFilter = next
      state.lightsThreadScrollOffset = 0
      state.lightsSelectedThreadId = undefined
    },
    submit: () => {
      state.focusMode = state.lightsFilterReturnFocus
      refresh()
      return true
    },
    refresh,
  })
}

function appendPasteToFocusedBuffer(state: AppState, paste: string, refresh: () => void): void {
  if (state.focusMode === "goal") {
    state.focusMode = isGoalMode(state) ? "monitor" : "agent"
  } else if (
    state.focusMode !== "agent" &&
    state.focusMode !== "monitor" &&
    state.focusMode !== "gardener" &&
    state.focusMode !== "lights-filter"
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
  exitStack: () => void,
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
        exitStack,
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
  exitStack: () => void,
): boolean {
  const telemetryKey = telemetryKeyFromRawSequence(sequence)
  if (telemetryKey && handlePermissionsKey(telemetryKey, options, state, refresh)) return true
  if (telemetryModalCapturesRawInput(state)) {
    const chunkKey = telemetryKeyFromRawModalChunk(sequence)
    if (chunkKey) handlePermissionsKey(chunkKey, options, state, refresh)
    return true
  }
  if (handleRawEvalFeedbackInput(sequence, options, state, refresh)) return true

  if (consumeRawExitCommand(sequence, state)) {
    exitStack()
    return true
  }

  if (sequence === "\x1b") {
    if (closeSelectorPanel(state)) {
      refresh()
      return true
    }
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
    if (showWorkerGoalTabs(state, state.metaEvents)) {
      if (returnToGoalView(state, refresh)) return true
      selectWorkerPanelView(state, "chat", refresh)
      return true
    }
    if (agentChatPauseEligible(state)) {
      if (state.agentChatPaused) {
        state.agentChatPaused = false
        if (codexSessionHandle.session) {
          appendStackBlock(state.blocks, "interrupt requested")
          void codexSessionHandle.session.interrupt().finally(refresh)
        }
      } else {
        state.agentChatPaused = true
        state.lastAgentScrollAt = Date.now()
        refresh()
      }
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

  if (
    state.workerPanelView === "goal" &&
    !isGoalMode(state) &&
    state.focusMode === "agent" &&
    goalNavigationShortcutsEnabled(state)
  ) {
    const navKey =
      sequence === "j"
        ? "j"
        : sequence === "k"
          ? "k"
          : sequence === " "
            ? "space"
            : isRawEnterSequence(sequence)
              ? "enter"
              : undefined
    if (
      navKey &&
      handlePreviousGoalsListKeys({ name: navKey }, state, state.metaEvents, options.session.metaThreadId, refresh)
    ) {
      return true
    }
  }

  if (showWorkerGoalTabs(state, state.metaEvents) && goalNavigationShortcutsEnabled(state)) {
    if (isGoalMode(state)) {
      if (sequence === "m") {
        focusGoalSidecarChat(options, state, refresh)
        return true
      }
      if (sequence === "t") {
        state.monitorPanelMode = "chat"
        state.focusMode = "monitor"
        refresh()
        return true
      }
      if (sequence === "e") {
        state.monitorPanelMode = "events"
        state.focusMode = "monitor"
        refresh()
        return true
      }
      if (sequence === "a") {
        state.agentViewEnabled = !state.agentViewEnabled
        refresh()
        return true
      }
      if (sequence === "1") {
        selectWorkerPanelView(state, "chat", refresh)
        return true
      }
      if (sequence === "2") {
        selectWorkerPanelView(state, "goal", refresh)
        return true
      }
    }
    if (sequence === "g") {
      selectWorkerPanelView(state, "goal", refresh)
      return true
    }
  }

  if (state.focusMode === "agent" && !focusedInputEditing(state) && (sequence === "]" || sequence === "[")) {
    void cycleStackEnvironmentFromUi(sequence === "]" ? 1 : -1)
    return true
  }

  if (shouldDeferRawSequenceForVoiceHold(sequence) && resolveVoiceInputTarget(state)) {
    return false
  }

  if (handleAgentScrollKey({ name: keyName }, state, renderer, options)) {
    refresh()
    return true
  }

  if (state.focusMode === "monitor" && handleMonitorScrollKey({ name: keyName }, state, renderer)) {
    refresh()
    return true
  }

  if (state.focusMode === "agent") {
    return handleRawAgentInput(sequence, state, submit, refresh)
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

  if (state.focusMode === "lights-filter") {
    return handleRawLightsFilterInput(sequence, state, refresh)
  }

  if (state.focusMode === "gardener" || state.gardenerInputBuffer.trim().length > 0) {
    if (shouldDeferRawSequenceForVoiceHold(sequence)) {
      return false
    }
    if (
      state.focusMode === "gardener" &&
      !state.gardenerInputBuffer &&
      (sequence === "w" || sequence === "j" || sequence === "k" || sequence === "d" || sequence === "a")
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
    if (state.rightPanelContent === "lights") {
      handleLightsKey({ name: keyName }, options, state, buildOpsPanelInput(options, state), rightPanelThreadRows(renderer), refresh)
    } else if (state.rightPanelContent === "efforts") {
      void handleEffortsKey({ name: keyName }, options, state, refresh)
    } else {
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
    }
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
    handleModelKey({ name: keyName }, options, state, refresh)
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
  if (/^[1-9]$/.test(sequence)) return sequence
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

function buildGardenerArchiveCandidates(
  options: StackAppOptions,
  state: AppState,
): GardenerThreadArchiveCandidate[] {
  return state.history
    .filter((summary) => summary.id !== state.gardenerThreadId)
    .flatMap((summary) => {
      const metaThreadId = state.threadMetaThreadIds.get(summary.id) ?? summary.metaThreadId
      if (!metaThreadId) return []
      return [
        {
          threadId: summary.id,
          metaThreadId,
          label: resolveThreadDisplayLabel(summary, { maxLength: 24, fallbackId: summary.id }),
          lifecycle: state.threadLifecycleStatus.get(summary.id) === "archived" ? "archived" : "live",
        },
      ]
    })
}

function buildGardenerArchiveFilterTargets(
  options: StackAppOptions,
  state: AppState,
  columns: number,
): GardenerThreadArchiveCandidate[] {
  const candidates = new Map(buildGardenerArchiveCandidates(options, state).map((candidate) => [candidate.threadId, candidate]))
  return lightsThreadSummariesForView(options, state, columns).flatMap((summary) => {
    const candidate = candidates.get(summary.id)
    return candidate ? [candidate] : []
  })
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

function gardenerPassCursorEvent(stackRoot: string, threadId: string): StackThreadMetaEvent | undefined {
  return readThreadMetaEvents(stackRoot, threadId)
    .filter((event) => event.actor_role !== "gardener" && event.actor_role !== "system")
    .at(-1)
}

async function refreshGardenerMaintenance(
  options: StackAppOptions,
  state: AppState,
  wakeReason: "inbox" | "turn_completed" | "idle" | "manual",
): Promise<void> {
  if (tuiSmokeAutomationDisabled()) return
  const cursorEvent = gardenerPassCursorEvent(options.config.stackDataRoot, options.session.id)
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
  try {
    await stackdGardenerPassComplete(options.session.id, "gardener_default", {
      ...(cursorEvent?.event_id ? { cursor_event_id: cursorEvent.event_id } : {}),
      wake_reason: wakeReason,
      ...(result.workspaceGardenPath ? { workspace_garden_path: result.workspaceGardenPath } : {}),
      ...(result.gardenerGardenPath ? { gardener_garden_path: result.gardenerGardenPath } : {}),
      inbox_pending: result.inboxPending,
    })
    state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  } catch (error) {
    appendStackBlock(state.blocks, `gardener cursor advance failed: ${errorMessage(error)}`)
  }
}

function tuiSmokeAutomationDisabled(): boolean {
  const value = process.env.STACK_TUI_SMOKE_NO_AUTOMATION?.trim().toLowerCase()
  return value === "1" || value === "true"
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
      Text({
        content: ` ${oneLine(connection.label, Math.max(24, columns - 32))} `,
        fg: accountSelected ? theme.fgOnAccent : connection.fg,
        bg: accountSelected ? theme.bgChipActive : theme.bgSubtle,
        onMouseDown(event) {
          event.preventDefault?.()
          event.stopPropagation?.()
          state.focusMode = "account"
          refresh()
        },
      }),
      ...(connection.detail
        ? [
            Text({
              content: oneLine(connection.detail, Math.max(28, columns - 32)),
              fg: connection.detailFg ?? theme.fgMuted,
              onMouseDown(event) {
                event.preventDefault?.()
                event.stopPropagation?.()
                state.focusMode = "account"
                refresh()
              },
            }),
          ]
        : []),
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
      stackVersionAndUpdateRow(options, state, refresh, columns),
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

function stackVersionAndUpdateRow(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  columns: number,
): ReturnType<typeof Box> {
  const versionLabel = oneLine(`stack ${stackVersion(options.config.appRoot)}`, Math.max(18, Math.min(40, columns - 24)))
  const updateChip = stackUpdateChip(options, state, refresh)
  return Box(
    {
      flexDirection: "row",
      gap: stackTuiLayout.panelGap,
      flexShrink: 0,
      alignItems: "center",
    },
    Text({
      content: versionLabel,
      fg: theme.fgMuted,
      flexShrink: 0,
    }),
    ...(updateChip ? [updateChip] : []),
  )
}

function stackUpdateChip(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): ReturnType<typeof Text> | undefined {
  if (state.updateApplying) {
    return Text({
      content: " updating ",
      fg: theme.fgOnAccent,
      bg: theme.synth.orange,
      flexShrink: 0,
    })
  }
  if (state.updateNotice) {
    return Text({
      content: " restart ",
      fg: theme.fgOnAccent,
      bg: theme.synth.gold,
      flexShrink: 0,
      onMouseDown(event: PanelMouseEvent) {
        event.preventDefault?.()
        event.stopPropagation?.()
        appendStackBlock(state.blocks, state.updateNotice ?? "Stack updated; restart to use the new version")
        refresh()
      },
    })
  }
  if (state.updateCheck?.status !== "available") return undefined
  const latest = state.updateCheck.latest_version ?? "latest"
  return Text({
    content: oneLine(` update ${shortUpdateVersion(latest)} `, 24),
    fg: theme.fgOnAccent,
    bg: theme.synth.orange,
    flexShrink: 0,
    onMouseDown(event: PanelMouseEvent) {
      event.preventDefault?.()
      event.stopPropagation?.()
      void applyStackUpdateFromUi(options, state, refresh)
    },
  })
}

function shortUpdateVersion(version: string): string {
  const match = version.match(/dev\.(\d{8}\.\d+)$/)
  return match ? match[1] : version
}

async function refreshStackUpdateStatus(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): Promise<void> {
  if (state.updateChecking || state.updateApplying) return
  state.updateChecking = true
  try {
    state.updateCheck = await checkUpdate(options.config)
  } catch (error) {
    state.updateCheck = {
      generated_at: new Date().toISOString(),
      current_version: stackVersion(options.config.appRoot),
      current_channel: "unknown",
      requested_channel: "nightly",
      manifest_source: "https://stack.usesynth.ai/releases/nightly.json",
      status: "unavailable",
      message: errorMessage(error),
      mutates: false,
    }
  } finally {
    state.updateChecking = false
    refresh()
  }
}

async function applyStackUpdateFromUi(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): Promise<void> {
  if (state.updateApplying) return
  state.updateApplying = true
  state.updateNotice = undefined
  appendStackBlock(state.blocks, "Stack update started")
  refresh()
  try {
    const report = await applyUpdate(options.config)
    state.updateNotice = report.message
    state.updateCheck = await checkUpdate(options.config)
    appendStackBlock(state.blocks, report.message)
  } catch (error) {
    state.updateNotice = undefined
    appendStackBlock(state.blocks, `Stack update failed: ${errorMessage(error)}`)
  } finally {
    state.updateApplying = false
    refresh()
  }
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
): { label: string; detail?: string; fg: string; detailFg?: string } {
  const env = config.environment.label
  const auth = environmentAuthStatus(config.environment)
  const snap = state.remoteAccountSnapshot
  const hint = snap.keyHint

  if (!auth.hasAuth) {
    return {
      label: "○ Local ready · Sign in to Synth for cloud",
      detail: `Synth ${env} · stack auth open signin`,
      fg: theme.synth.amber,
      detailFg: theme.fgMuted,
    }
  }
  if (snap.status === "invalid-auth") {
    return {
      label: `○ Synth ${env} · auth rejected`,
      detail: "Local ready · refresh the Synth key for cloud",
      fg: theme.synth.red,
      detailFg: theme.fgMuted,
    }
  }
  if (snap.status === "missing-auth") {
    return {
      label: "○ Local ready · Sign in to Synth for cloud",
      detail: `Synth ${env} · stack auth open signin`,
      fg: theme.synth.amber,
      detailFg: theme.fgMuted,
    }
  }
  if (snap.status === "offline") {
    return {
      label: `◐ Synth ${env} · ${hint ?? "key"} offline`,
      detail: "Local ready · cloud sync waits for API",
      fg: theme.synth.amber,
      detailFg: theme.fgMuted,
    }
  }
  if (snap.status === "connected") {
    return { label: `● Synth ${env} · ${hint ?? "key"}`, fg: theme.synth.gold }
  }
  return { label: `◐ Synth ${env} · ${hint ?? "key"}`, fg: theme.synth.warmMuted }
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

function applyStackProfile(
  profile: StackProfileName,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  writeStackProfile(options.config.stackDataRoot, profile)
  const defaults = STACK_PROFILE_DEFAULTS[profile]
  setCodexModel(options.config, defaults.codexModel)
  setCodexReasoningEffort(options.config, defaults.codexReasoningEffort)
  state.monitorSnapshot = emptyMonitorSnapshot(options.config.stackDataRoot)
  syncMonitorRightPanel(state)
  appendStackBlock(state.blocks, `profile ${profile}`)
  refresh()
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
  const pinned = state.gardenerScrollPinned || running
  state.gardenerScrollOffset = tailTranscriptScrollOffset(pinned, state.gardenerScrollOffset, maxOffset)
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

function tailGoalSidecarThreadScroll(
  state: AppState,
  turns: Parameters<typeof sidecarThreadRenderedLineCount>[0]["turns"],
  events: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
): void {
  const lineCount = sidecarThreadRenderedLineCount({
    turns,
    events,
    columns,
    options: sidecarTranscriptRenderOptions(state),
  })
  const maxOffset = Math.max(0, lineCount - visibleRows)
  if (state.goalShutterSidecarThreadScrollPinned) state.goalShutterSidecarThreadScrollOffset = 0
  else if (state.goalShutterSidecarThreadScrollOffset > maxOffset) state.goalShutterSidecarThreadScrollOffset = maxOffset
}

function handleGoalSidecarThreadMouseScroll(
  direction: "up" | "down",
  state: AppState,
  turns: Parameters<typeof sidecarThreadRenderedLineCount>[0]["turns"],
  events: StackThreadMetaEvent[],
  columns: number,
  visibleRows: number,
  refresh: () => void,
): void {
  const lineCount = sidecarThreadRenderedLineCount({
    turns,
    events,
    columns,
    options: sidecarTranscriptRenderOptions(state),
  })
  const maxOffset = Math.max(0, lineCount - visibleRows)
  const next = scrollTranscriptViewport(direction, state.goalShutterSidecarThreadScrollOffset, maxOffset)
  state.goalShutterSidecarThreadScrollOffset = next.offset
  state.goalShutterSidecarThreadScrollPinned = next.pinned
  refresh()
}

function monitorGoalViewInput(
  options: StackAppOptions,
  state: AppState,
  events: StackThreadMetaEvent[],
  columns: number,
  metaThreadTitle?: string,
): MonitorGoalViewInput {
  return {
    state,
    events,
    columns,
    metaThreadId: options.session.metaThreadId,
    metaThreadTitle,
    workerStatus: state.status,
    workerTurnStartedAt: state.currentTurnStartedAt,
  }
}

function handleWorkerGoalViewScroll(
  direction: "up" | "down",
  state: AppState,
  maxOffset: number,
  refresh: () => void,
): void {
  if (direction === "up") {
    state.goalShutterScrollOffset = Math.max(0, state.goalShutterScrollOffset - 3)
    state.goalShutterScrollPinned = state.goalShutterScrollOffset === 0
  } else {
    state.goalShutterScrollPinned = false
    state.goalShutterScrollOffset = Math.min(maxOffset, state.goalShutterScrollOffset + 3)
  }
  refresh()
}

function handleMonitorGoalViewScroll(
  direction: "up" | "down",
  state: AppState,
  input: MonitorGoalViewInput,
  visibleRows: number,
  refresh: () => void,
): void {
  const maxOffset = monitorGoalViewMaxScroll(input, visibleRows)
  if (direction === "up") {
    state.goalShutterScrollOffset = Math.max(0, state.goalShutterScrollOffset - 3)
    state.goalShutterScrollPinned = state.goalShutterScrollOffset === 0
  } else {
    state.goalShutterScrollPinned = false
    state.goalShutterScrollOffset = Math.min(maxOffset, state.goalShutterScrollOffset + 3)
  }
  refresh()
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
  const next = scrollTranscriptViewport(direction, state.gardenerScrollOffset, maxOffset)
  state.gardenerScrollOffset = next.offset
  state.gardenerScrollPinned = next.pinned
  refresh()
}

/** Transcript scroll: offset 0 = live tail (newest lines above input). */
function scrollTranscriptViewport(
  direction: "up" | "down",
  offset: number,
  maxOffset: number,
  step = 3,
): { offset: number; pinned: boolean } {
  if (direction === "up") {
    return { offset: Math.min(maxOffset, offset + step), pinned: false }
  }
  const next = Math.max(0, offset - step)
  return { offset: next, pinned: next === 0 }
}

function tailTranscriptScrollOffset(pinned: boolean, offset: number, maxOffset: number): number {
  if (pinned) return 0
  return Math.min(offset, maxOffset)
}

function handleMonitorChatScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  state: AppState,
  blocks: readonly TranscriptBlock[],
  tools: readonly ToolLog[],
  subagents: readonly SubagentLog[],
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
  const maxOffset = maxTranscriptScrollOffset(blocks, tools, subagents, columns, options, visibleRows)
  const next = scrollTranscriptViewport(direction, state.monitorScrollOffset, maxOffset)
  state.monitorScrollOffset = next.offset
  state.monitorScrollPinned = next.pinned
  refresh()
}

function handleGardenerNarrativeScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  options: StackAppOptions,
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
  scrollGardenerPane(event.scroll?.direction, options, state, events, context, columns, visibleRows, "narrative", refresh)
}

function handleGardenerEventScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  options: StackAppOptions,
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
  scrollGardenerPane(event.scroll?.direction, options, state, events, context, columns, visibleRows, "events", refresh)
}

function scrollGardenerPane(
  direction: string | undefined,
  options: StackAppOptions,
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
    const chat = buildGardenerChatTranscriptView(options, state, events)
    const renderOptions = gardenerTranscriptRenderOptions(
      transcriptRenderOptions(state),
      state.gardenerChatRunning,
      state.gardenerLiveThinking,
    )
    const maxOffset = maxTranscriptScrollOffset(
      chat.blocks,
      chat.tools,
      chat.subagents,
      columns,
      renderOptions,
      visibleRows,
    )
    const next = scrollTranscriptViewport(direction, state.gardenerScrollOffset, maxOffset)
    state.gardenerScrollOffset = next.offset
    state.gardenerScrollPinned = next.pinned
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
    threadMetaThreadTitles: state.threadMetaThreadTitles,
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
  const voiceHintRows = panelVoiceHintLine(state, "monitor", state.monitorNotice) ? 1 : 0
  const chromeLines = 8 + voiceHintRows
  const total = Math.max(14, renderer.terminalHeight - 10)
  const opsBlock = state.rightPanelOpsVisible ? Math.max(8, Math.floor(total * 0.32)) + 3 : 0
  return Math.max(10, total - opsBlock - chromeLines)
}

function rightPanelThreadRows(renderer: CliRenderer): number {
  return Math.max(8, renderer.terminalHeight - 12)
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
  return hasGoalContext(state) && state.workerPanelView === "chat"
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
  if (state.monitorWatchScrollPinned) state.monitorWatchScrollOffset = 0
  else if (state.monitorWatchScrollOffset > maxOffset) state.monitorWatchScrollOffset = maxOffset
}

function tailMonitorThreadScroll(
  state: AppState,
  blocks: readonly TranscriptBlock[],
  tools: readonly ToolLog[],
  subagents: readonly SubagentLog[],
  columns: number,
  visibleRows: number,
  options: TranscriptRenderOptions,
): void {
  const maxOffset = maxTranscriptScrollOffset(blocks, tools, subagents, columns, options, visibleRows)
  state.monitorScrollOffset = tailTranscriptScrollOffset(
    state.monitorScrollPinned,
    state.monitorScrollOffset,
    maxOffset,
  )
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
  const next = scrollTranscriptViewport(direction, state.monitorWatchScrollOffset, maxOffset)
  state.monitorWatchScrollOffset = next.offset
  state.monitorWatchScrollPinned = next.pinned
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
    const next = scrollTranscriptViewport(direction, state.monitorScrollOffset, maxOffset)
    state.monitorScrollOffset = next.offset
    state.monitorScrollPinned = next.pinned
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
  if (!state.rightPanelOpen) {
    return Math.max(24, Math.floor(renderer.terminalWidth * 0.72) - 8)
  }
  return monitorPanelColumns(renderer, state)
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

function handleLightsMouseScroll(
  event: { preventDefault?: () => void; stopPropagation?: () => void; scroll?: { direction?: string } },
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  visibleRows: number,
  refresh: () => void,
): void {
  event.preventDefault?.()
  event.stopPropagation?.()
  const direction = event.scroll?.direction
  if (direction !== "up" && direction !== "down") return
  scrollLightsPanel(options, state, input, visibleRows, direction)
  refresh()
}

function handleLightsKey(
  key: StackKeyEvent,
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  visibleRows: number,
  refresh: () => void,
): void {
  if (key.name === "j" || key.name === "down") {
    scrollLightsPanel(options, state, input, visibleRows, "down")
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    scrollLightsPanel(options, state, input, visibleRows, "up")
    refresh()
    return
  }
  if (key.name === "f") {
    focusLightsThreadFilter(state)
    refresh()
    return
  }
  if (key.name === "r") {
    appendStackBlock(state.blocks, "lights refresh uses current Stack snapshots")
    refresh()
  }
}

async function handleEffortsKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): Promise<void> {
  if (key.name === "j" || key.name === "down") {
    navigateEffortsPanelSelection(options, state, 1)
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    navigateEffortsPanelSelection(options, state, -1)
    refresh()
    return
  }
  if (key.name === "r") {
    appendStackBlock(state.blocks, "efforts refresh uses current Stack workspace state")
    refresh()
    return
  }
  if (key.name === "h") {
    refreshSelectedEffortHandoff(options, state, refresh)
    return
  }
  if (key.name === "a") {
    toggleSelectedEffortArchive(options, state, refresh)
    return
  }
  if (key.name === "n") {
    state.inputBuffer = "/efforts new "
    state.focusMode = "agent"
    refresh()
    return
  }
  if (key.name === "b") {
    await bindSelectedEffortToCurrentThread(options, state, refresh)
  }
}

function navigateEffortsPanelSelection(options: StackAppOptions, state: AppState, direction: number): void {
  try {
    const efforts = readEffortsPanelSummaries(options)
    state.selectedEffortIndex = clampIndex(state.selectedEffortIndex + direction, efforts.length)
  } catch {
    state.selectedEffortIndex = 0
  }
}

function selectedEffortPanelSummary(options: StackAppOptions, state: AppState): StackEffortSummary | undefined {
  try {
    const efforts = readEffortsPanelSummaries(options)
    state.selectedEffortIndex = clampIndex(state.selectedEffortIndex, efforts.length)
    return efforts[state.selectedEffortIndex]
  } catch {
    return undefined
  }
}

function readEffortsPanelSummaries(options: StackAppOptions): StackEffortSummary[] {
  return orderedEffortsForPanel(listEfforts({
    stackDataRoot: options.config.stackDataRoot,
    workspaceRoot: options.config.workspaceRoot,
  }))
}

function orderedEffortsForPanel(efforts: StackEffortSummary[]): StackEffortSummary[] {
  const active = efforts.filter((effort) => effort.status !== "archived")
  const archived = efforts.filter((effort) => effort.status === "archived")
  return [...active, ...archived]
}

function refreshSelectedEffortHandoff(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  const selected = selectedEffortPanelSummary(options, state)
  if (!selected) {
    appendStackBlock(state.blocks, "efforts handoff: no Effort selected")
    refresh()
    return
  }
  try {
    const result = writeEffortHandoff({
      stackDataRoot: options.config.stackDataRoot,
      workspaceRoot: options.config.workspaceRoot,
      effortRef: selected.id,
    })
    appendStackBlock(state.blocks, `effort handoff refreshed: ${selected.slug} - ${relative(options.config.workspaceRoot, result.path)}`)
  } catch (error) {
    appendStackBlock(state.blocks, `effort handoff failed: ${errorMessage(error)}`)
  }
  refresh()
}

function toggleSelectedEffortArchive(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  const selected = selectedEffortPanelSummary(options, state)
  if (!selected) {
    appendStackBlock(state.blocks, "efforts archive: no Effort selected")
    refresh()
    return
  }
  const nextStatus = selected.status === "archived" ? "active" : "archived"
  try {
    const effort = updateEffortStatus({
      stackDataRoot: options.config.stackDataRoot,
      workspaceRoot: options.config.workspaceRoot,
      effortRef: selected.id,
      status: nextStatus,
    })
    selectEffortPanelId(options, state, effort.manifest.id)
    appendStackBlock(state.blocks, `effort ${nextStatus}: ${effort.manifest.slug}`)
  } catch (error) {
    appendStackBlock(state.blocks, `efforts archive failed: ${errorMessage(error)}`)
  }
  refresh()
}

async function bindSelectedEffortToCurrentThread(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): Promise<void> {
  const selected = selectedEffortPanelSummary(options, state)
  if (!selected) {
    appendStackBlock(state.blocks, "efforts bind: no Effort selected")
    refresh()
    return
  }
  const metaThreadId = options.session.metaThreadId ?? state.metaThreadManifest?.id
  if (!metaThreadId) {
    appendStackBlock(state.blocks, "efforts bind: current session has no meta-thread id")
    refresh()
    return
  }
  const effort = readEffort({
    stackDataRoot: options.config.stackDataRoot,
    workspaceRoot: options.config.workspaceRoot,
  }, selected.id)
  if (!effort) {
    appendStackBlock(state.blocks, `efforts bind: Effort not found: ${selected.slug}`)
    refresh()
    return
  }
  try {
    const manifest = await stackdUpdateMetaThreadEffortRef(metaThreadId, {
      effort_ref: effort.manifest.id,
      actor_id: "operator",
      reason: "tui /efforts bind",
    })
    bindEffortMetaThread({
      stackDataRoot: options.config.stackDataRoot,
      workspaceRoot: options.config.workspaceRoot,
      effortRef: effort.manifest.id,
      metaThreadId: manifest.id,
    })
    if (state.metaThreadManifest?.id === manifest.id || options.session.metaThreadId === manifest.id) {
      state.metaThreadManifest = manifest
      options.session.metaThreadId = manifest.id
    }
    appendStackBlock(state.blocks, `bound current meta-thread ${manifest.id.slice(0, 8)} to effort ${effort.manifest.slug}`)
  } catch (error) {
    appendStackBlock(state.blocks, `efforts bind failed: ${errorMessage(error)}`)
  }
  refresh()
}

function lightsSectionExpanded(state: AppState, sectionId: LightsPanelSectionId): boolean {
  return !state.lightsCollapsedSections.has(sectionId)
}

function toggleLightsSection(
  options: StackAppOptions,
  state: AppState,
  sectionId: LightsPanelSectionId,
): void {
  if (state.lightsCollapsedSections.has(sectionId)) {
    state.lightsCollapsedSections.delete(sectionId)
  } else {
    state.lightsCollapsedSections.add(sectionId)
  }
  state.lightsThreadScrollOffset = 0
  state.opsScrollOffset = 0
  writeStackUxSettings(options.config.stackDataRoot, {
    lightsCollapsedSections: [...state.lightsCollapsedSections],
  })
}

function computeLightsThreadWindowRows(
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  columns: number,
  visibleRows: number,
): number {
  if (!lightsSectionExpanded(state, "threads")) return 0

  const width = Math.max(24, columns)
  const companionSections = lightsCompanionSections(options, state, input, width)
  const sectionCount = 1 + companionSections.length
  let used = sectionCount * 2

  for (const section of companionSections) {
    if (lightsSectionExpanded(state, section.id)) {
      used += section.lines.length
    }
  }
  used += 1

  const threadCount = buildLightsThreadPanelRows(options, state, columns).length
  const budget = visibleRows - used
  if (threadCount === 0) return 0
  if (state.lightsThreadsOnly) {
    if (budget <= 0) return Math.max(1, Math.min(3, threadCount))
    return Math.max(3, Math.min(threadCount, visibleRows - 3))
  }
  if (budget <= 0) return Math.max(1, Math.min(3, threadCount))
  return Math.max(3, Math.min(threadCount, budget))
}

function lightsCompanionSections(
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  width: number,
): LightsPanelSection[] {
  if (state.lightsThreadsOnly) return []
  return [
    lightsEffortsSection(options, state, width),
    lightsGardenersSection(options, state, width),
    lightsActorsSection(input, width),
    lightsCloudSection(state, input, width),
    lightsLocalSection(input, width),
    lightsUsageSection(input, width),
  ]
}

function scrollLightsPanel(
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  visibleRows: number,
  direction: "up" | "down",
): void {
  const threadMaxOffset = lightsThreadMaxScrollOffset(options, state, input, Number.MAX_SAFE_INTEGER, visibleRows)
  if (direction === "down" && state.lightsThreadScrollOffset < threadMaxOffset) {
    state.lightsThreadScrollOffset = Math.min(threadMaxOffset, state.lightsThreadScrollOffset + 3)
    return
  }
  if (direction === "up" && state.opsScrollOffset <= 0 && state.lightsThreadScrollOffset > 0) {
    state.lightsThreadScrollOffset = Math.max(0, state.lightsThreadScrollOffset - 3)
    return
  }
  const lineCount = buildLightsPanelRows(options, state, input, Number.MAX_SAFE_INTEGER, visibleRows).length
  const maxOffset = Math.max(0, lineCount - visibleRows)
  if (direction === "up") {
    state.opsScrollOffset = Math.max(0, state.opsScrollOffset - 3)
  } else {
    state.opsScrollOffset = Math.min(maxOffset, state.opsScrollOffset + 3)
  }
}

type LightsPanelRow = {
  text: string
  sectionId: LightsPanelSectionId
  isHeader: boolean
  isFilter?: boolean
  threadId?: string
  threadRowKind?: LightsThreadPanelRowKind
}

function focusLightsThreadFilter(state: AppState): void {
  if (state.focusMode !== "lights-filter") {
    state.lightsFilterReturnFocus = state.focusMode
  }
  state.focusMode = "lights-filter"
}

function parseGardenerLightsFilterSubmit(message: string): string | null {
  const trimmed = message.trim()
  const lower = trimmed.toLowerCase()
  if (!lower.startsWith("filter")) return null
  if (lower === "filter" || lower === "filter clear") return ""
  if (lower.startsWith("filter ")) return trimmed.slice(7)
  return null
}

function syncGardenerInputToLightsThreadFilter(state: AppState, input: string): void {
  if (!isLightsPanelOpen(state)) return
  const lower = input.toLowerCase()
  if (lower.startsWith("filter ")) {
    state.lightsThreadFilter = input.slice(7)
    state.lightsThreadScrollOffset = 0
    state.lightsSelectedThreadId = undefined
    return
  }
  if (lower === "filter") {
    state.lightsThreadFilter = ""
    state.lightsThreadScrollOffset = 0
    state.lightsSelectedThreadId = undefined
  }
}

function lightsThreadsViewIsCustom(state: AppState): boolean {
  if (state.lightsThreadFilter.trim().length > 0) return true
  return state.lightsCollapsedSections.size > 0
}

function formatLightsGoalElapsed(session: GoalSessionSnapshot | undefined): string | undefined {
  if (!session) return undefined
  if (session.spend.elapsed_s > 0) {
    return formatGoalCompute({ source: "none", timeUsedSeconds: session.spend.elapsed_s })
  }
  if (session.started_at) return lightsThreadRelativeAge(session.started_at)
  return undefined
}

function formatLightsGoalUsage(
  session: GoalSessionSnapshot | undefined,
  threadUsage: StackSessionUsageSummary | undefined,
): string | undefined {
  const parts: string[] = []
  const goalTokens = (session?.spend.worker_tokens ?? 0) + (session?.spend.monitor_tokens ?? 0)
  if (goalTokens > 0) {
    parts.push(`${formatTokenTotal(goalTokens)} tok`)
  } else if (threadUsage) {
    parts.push(`${formatTokenTotal(sessionTokenTotal(threadUsage.totals))} tok`)
  }
  const goalSpendUsd = (session?.spend.worker_usd ?? 0) + (session?.spend.monitor_usd ?? 0)
  const spendLabel =
    goalSpendUsd > 0 ? formatEstimatedSpend(goalSpendUsd) : formatEstimatedSpend(threadUsage?.estimatedSpendUsd)
  if (spendLabel) parts.push(spendLabel)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function lightsThreadGoalSuffix(state: AppState, summaryId: string): string {
  const metrics = state.threadGoalMetrics.get(summaryId)
  if (!metrics) return ""
  const parts: string[] = []
  if (metrics.elapsedLabel) parts.push(metrics.elapsedLabel)
  const usage = metrics.usageLabel?.split(" · ")[0]?.trim()
  if (usage) parts.push(usage)
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
}

function lightsThreadStatusLabel(
  options: StackAppOptions,
  state: AppState,
  summary: StackSessionSummary,
  activeIds: ReadonlySet<string>,
): string {
  if (summary.id === options.session.id) return "current"
  if (activeIds.has(summary.id)) return "active"
  const goal = state.threadGoalStatus.get(summary.id)
  if (goal && goal !== "done") return `goal ${goal}`
  return state.threadLifecycleStatus.get(summary.id) ?? "live"
}

function toggleLightsThreadSelection(state: AppState, threadId: string): void {
  state.lightsSelectedThreadId = state.lightsSelectedThreadId === threadId ? undefined : threadId
}

function lightsThreadIsViewed(state: AppState, threadId: string): boolean {
  return state.lightsViewedThreadIds.has(threadId)
}

function markLightsThreadViewedInState(
  stackRoot: string,
  state: AppState,
  threadIds: readonly string[],
): void {
  if (threadIds.length === 0) return
  state.lightsViewedThreadIds = markLightsThreadsViewed(stackRoot, state.lightsViewedThreadIds, threadIds)
  state.lightsSelectedThreadId = threadIds[threadIds.length - 1]
}

function markLightsThreadUnviewedInState(
  stackRoot: string,
  state: AppState,
  threadIds: readonly string[],
): void {
  if (threadIds.length === 0) return
  state.lightsViewedThreadIds = markLightsThreadsUnviewed(stackRoot, state.lightsViewedThreadIds, threadIds)
  const disk = readLightsThreadViewState(stackRoot)
  state.lightsSelectedThreadId = disk.selectedThreadId
}

function lightsThreadPrimaryLine(
  options: StackAppOptions,
  state: AppState,
  summary: StackSessionSummary,
  columns: number,
  expanded: boolean,
): string {
  const chevron = expanded ? "▾" : "▸"
  const current = summary.id === options.session.id ? "*" : " "
  const viewed = lightsThreadIsViewed(state, summary.id)
  const newMarker = viewed ? " " : "·"
  const titleMax = Math.max(8, columns - 8)
  const title = resolveThreadDisplayLabel(summary, {
    isGardener: summary.id === state.gardenerThreadId,
    maxLength: titleMax,
    fallbackId: summary.id,
    metaThreadTitle: state.threadMetaThreadTitles.get(summary.id),
  })
  return oneLine(`  ${chevron}${current}${newMarker} ${title}`, columns)
}

function lightsThreadDetailLines(
  options: StackAppOptions,
  state: AppState,
  summary: StackSessionSummary,
  columns: number,
): string[] {
  const lines: string[] = []
  const preview = state.threadLightsPreviews.get(summary.id)
  const headline = preview?.headline?.trim()
  const note = preview?.note?.trim()
  const objective =
    preview?.objective?.trim() ||
    state.threadMetaThreadTitles.get(summary.id)?.trim() ||
    summary.lastPrompt?.trim()

  if (headline) {
    lines.push(oneLine(`    ${headline}`, columns))
    if (note) lines.push(oneLine(`    ${note}`, columns))
  } else if (objective) {
    lines.push(oneLine(`    ${objective}`, columns))
  } else if (summary.lastPrompt?.trim()) {
    lines.push(oneLine(`    last · ${summary.lastPrompt.trim()}`, columns))
  }

  const statusLine = lightsThreadDetailStatusLine(options, state, summary, preview)
  if (statusLine) lines.push(oneLine(`    ${statusLine}`, columns))

  if (summary.id !== options.session.id) {
    const resume = threadResumeHint(summary)
    if (resume) lines.push(oneLine(`    ${resume}`, columns))
  }
  return lines
}

function lightsThreadDetailStatusLine(
  options: StackAppOptions,
  state: AppState,
  summary: StackSessionSummary,
  preview: ThreadLightsPreview | undefined,
): string | undefined {
  const activeIds = resolveActiveThreadIds(options.session.id, state.gardenerWorkerTargetId)
  const parts: string[] = []
  if (summary.id === options.session.id) parts.push("focused here")
  else if (activeIds.has(summary.id)) parts.push("active target")
  const workerState = preview?.workerState?.trim()
  if (workerState && workerState !== "idle") parts.push(`worker ${workerState}`)
  const goal = state.threadGoalStatus.get(summary.id)
  if (goal && goal !== "done") parts.push(`goal ${goal}`)
  else {
    const lifecycle = state.threadLifecycleStatus.get(summary.id)
    if (lifecycle === "archived") parts.push("archived")
  }
  parts.push(`updated ${lightsThreadRelativeAge(summary.updatedAt)} ago`)
  const usage = lightsThreadDetailUsageLabel(options, state, summary)
  if (usage) parts.push(usage)
  const metrics = state.threadGoalMetrics.get(summary.id)
  if (metrics?.elapsedLabel) parts.push(`on goal ${metrics.elapsedLabel}`)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function lightsThreadDetailUsageLabel(
  options: StackAppOptions,
  state: AppState,
  summary: StackSessionSummary,
): string | undefined {
  const metrics = state.threadGoalMetrics.get(summary.id)
  if (metrics?.usageLabel) return metrics.usageLabel
  const usage = threadUsageSummary(options, summary)
  if (usage) {
    const tokens = sessionTokenTotal(usage.totals)
    if (tokens > 0) return `${formatTokenTotal(tokens)} tok`
  }
  if (summary.turnCount > 0) return `${summary.turnCount} turn${summary.turnCount === 1 ? "" : "s"}`
  return undefined
}

type LightsThreadPanelRow = {
  kind: LightsThreadPanelRowKind
  threadId?: string
  text: string
}

function buildLightsThreadPanelRows(
  options: StackAppOptions,
  state: AppState,
  columns: number,
): LightsThreadPanelRow[] {
  const summaries = lightsThreadSummariesForView(options, state, columns)
  const rows: LightsThreadPanelRow[] = []
  for (const summary of summaries) {
    const expanded = state.lightsSelectedThreadId === summary.id
    rows.push({
      kind: "primary",
      threadId: summary.id,
      text: lightsThreadPrimaryLine(options, state, summary, columns, expanded),
    })
    if (!expanded) continue
    for (const line of lightsThreadDetailLines(options, state, summary, columns)) {
      rows.push({ kind: "detail", threadId: summary.id, text: line })
    }
    if (lightsThreadIsViewed(state, summary.id)) {
      rows.push({
        kind: "unview",
        threadId: summary.id,
        text: oneLine("    [ unview thread ]", columns),
      })
    } else {
      rows.push({
        kind: "view",
        threadId: summary.id,
        text: oneLine("    [ view thread ]", columns),
      })
    }
  }
  return rows
}

function lightsThreadRelativeAge(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return "--"
  const diffMs = Math.max(0, Date.now() - parsed)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function lightsThreadFilterLine(state: AppState, columns: number): string {
  const value = state.lightsThreadFilter.trim()
  const label = value ? oneLine(value, Math.max(12, columns - 32)) : "(all)"
  const view = lightsThreadsViewIsCustom(state) ? "custom" : "default"
  const cursor = state.focusMode === "lights-filter" ? "_" : ""
  return oneLine(`  filter · ${label}${cursor} · ${view}`, columns)
}

function lightsThreadFilterMatches(
  options: StackAppOptions,
  state: AppState,
  summary: StackSessionSummary,
  columns: number,
): boolean {
  const needle = state.lightsThreadFilter.trim().toLowerCase()
  if (!needle) return true
  const activeIds = resolveActiveThreadIds(options.session.id, state.gardenerWorkerTargetId)
  const lifecycle = state.threadLifecycleStatus.get(summary.id) ?? "live"
  const goal = state.threadGoalStatus.get(summary.id)
  const role = summary.id === state.gardenerThreadId ? "gardener" : "worker"
  const current = summary.id === options.session.id ? "current selected" : ""
  const active = activeIds.has(summary.id) ? "active target running" : "idle"
  if (needle === "all") return true
  if (needle === "live" || needle === "archived") return lifecycle === needle
  if (needle === "active" || needle === "running" || needle === "target") return activeIds.has(summary.id)
  if (needle === "current" || needle === "selected") return summary.id === options.session.id
  if (needle === "gardener" || needle === "gardeners" || needle === "gard") return summary.id === state.gardenerThreadId
  if (needle === "worker" || needle === "workers") return summary.id !== state.gardenerThreadId
  if (needle === "paused" || needle === "done" || needle === "blocked") return goal === needle
  if (needle === "unviewed" || needle === "new") return !state.lightsViewedThreadIds.has(summary.id)
  if (needle === "viewed") return state.lightsViewedThreadIds.has(summary.id)
  const title = resolveThreadDisplayLabel(summary, { maxLength: Math.max(12, columns - 26), fallbackId: summary.id })
  const viewedLabel = state.lightsViewedThreadIds.has(summary.id) ? "viewed" : "unviewed new"
  const haystack = `${summary.id} ${lifecycle} ${goal ?? ""} ${role} ${current} ${active} ${viewedLabel} ${title}`.toLowerCase()
  return haystack.includes(needle)
}

function lightsThreadSummariesForView(
  options: StackAppOptions,
  state: AppState,
  columns: number,
): StackSessionSummary[] {
  const filter = state.lightsThreadFilter.trim().toLowerCase()
  const liveIds = resolveVisibleThreadIds(options.session.id, state.gardenerWorkerTargetId, {
    lifecycle: "live",
    history: state.history,
    threadLifecycleStatus: state.threadLifecycleStatus,
  })
  return state.history
    .filter((summary) => filter === "all" || filter === "archived" || liveIds.has(summary.id) || summary.id === options.session.id)
    .filter((summary) => lightsThreadFilterMatches(options, state, summary, columns))
}

function buildLightsPanelRows(
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  columns: number,
  visibleRows: number,
): LightsPanelRow[] {
  const rows: LightsPanelRow[] = []
  for (const section of lightsPanelSections(options, state, input, columns, visibleRows)) {
    const expanded = lightsSectionExpanded(state, section.id)
    rows.push({
      text: `${expanded ? "▾" : "▸"} ${section.header}`,
      sectionId: section.id,
      isHeader: true,
    })
    if (expanded) {
      if (section.id === "threads") {
        rows.push({
          text: lightsThreadFilterLine(state, columns),
          sectionId: section.id,
          isHeader: false,
          isFilter: true,
        })
      }
      for (const [index, line] of section.lines.entries()) {
        rows.push({
          text: line,
          sectionId: section.id,
          isHeader: false,
          threadId: section.threadIds?.[index],
          threadRowKind: section.threadRowKinds?.[index],
        })
      }
    }
    rows.push({ text: "", sectionId: section.id, isHeader: false })
  }
  return rows
}

function renderLightsPanel(
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  columns: number,
  visibleRows: number,
  refresh: () => void,
  codexSessionHandle: { session?: HarnessSession },
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): ReturnType<typeof Box> {
  const rows = buildLightsPanelRows(options, state, input, columns, visibleRows)
  const maxOffset = Math.max(0, rows.length - visibleRows)
  const offset = Math.min(state.opsScrollOffset, maxOffset)
  const window = rows.slice(offset, offset + visibleRows)
  const children: Array<ReturnType<typeof Text>> = []
  if (maxOffset > 0) {
    children.push(
      Text({
        content: `scroll ${offset + 1}-${offset + window.length}/${rows.length}`,
        fg: theme.fgMuted,
        width: "100%",
        flexShrink: 0,
      }),
    )
  }
  for (const row of window) {
    const filterFocused = row.isFilter && state.focusMode === "lights-filter"
    const rowThreadId = row.threadId
    const isViewAction = row.threadRowKind === "view" || row.threadRowKind === "unview"
    const isPrimary = row.threadRowKind === "primary"
    const selectedPrimary =
      isPrimary && rowThreadId !== undefined && state.lightsSelectedThreadId === rowThreadId
    children.push(
      Text({
        content: row.text || " ",
        fg:
          row.isHeader || row.isFilter || isViewAction
            ? theme.synth.amber
            : row.threadRowKind === "detail"
              ? theme.fgMuted
              : theme.fgPrimary,
        bg: filterFocused || selectedPrimary ? theme.bgInputFocused : undefined,
        width: "100%",
        flexShrink: 0,
        ...(row.isHeader
          ? {
              onMouseDown(event: PanelMouseEvent) {
                event.preventDefault?.()
                event.stopPropagation?.()
                toggleLightsSection(options, state, row.sectionId)
                refresh()
              },
            }
          : row.isFilter
            ? {
                onMouseDown(event: PanelMouseEvent) {
                  event.preventDefault?.()
                  event.stopPropagation?.()
                  focusLightsThreadFilter(state)
                  refresh()
                },
              }
            : row.threadRowKind === "unview" && rowThreadId
              ? {
                  onMouseDown(event: PanelMouseEvent) {
                    event.preventDefault?.()
                    event.stopPropagation?.()
                    markLightsThreadUnviewedInState(options.config.stackDataRoot, state, [rowThreadId])
                    refresh()
                  },
                }
              : row.threadRowKind === "view" && rowThreadId
                ? {
                    onMouseDown(event: PanelMouseEvent) {
                      event.preventDefault?.()
                      event.stopPropagation?.()
                      void openLightsThreadRow(
                        options,
                        state,
                        rowThreadId,
                        codexSessionHandle,
                        refresh,
                        refreshHistory,
                        refreshMetaEvents,
                      )
                    },
                  }
                : isPrimary && rowThreadId
                  ? {
                      onMouseDown(event: PanelMouseEvent) {
                        event.preventDefault?.()
                        event.stopPropagation?.()
                        toggleLightsThreadSelection(state, rowThreadId)
                        refresh()
                      },
                    }
                  : {}),
      }),
    )
  }
  return Box(
    {
      flexDirection: "column",
      flexGrow: 1,
      minHeight: 0,
      width: "100%",
      gap: 0,
      overflow: "hidden",
    },
    ...children,
  )
}

async function openLightsThreadRow(
  options: StackAppOptions,
  state: AppState,
  threadId: string,
  codexSessionHandle: { session?: HarnessSession },
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
): Promise<void> {
  const historyIndex = state.history.findIndex((summary) => summary.id === threadId)
  if (threadId === state.gardenerThreadId) {
    openGardenerPanel(options, state, refresh, "lights")
    return
  }
  if (historyIndex < 0) return
  markLightsThreadViewedInState(options.config.stackDataRoot, state, [threadId])
  state.selectedHistoryIndex = historyIndex
  state.focusMode = "agent"
  state.workerPanelView = "chat"
  if (threadId === options.session.id) {
    state.agentScrollOffset = 0
    refresh()
    return
  }
  await loadSelectedSession(
    options,
    state,
    codexSessionHandle,
    refresh,
    refreshHistory,
    refreshMetaEvents,
    "resume",
  )
}

function lightsPanelLines(
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  columns: number,
  visibleRows: number,
): string[] {
  return buildLightsPanelRows(options, state, input, columns, visibleRows).map((row) => row.text)
}

function lightsPanelSections(
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  columns: number,
  visibleRows: number,
): LightsPanelSection[] {
  const width = Math.max(24, columns)
  const threadWindowRows = computeLightsThreadWindowRows(options, state, input, columns, visibleRows)
  return [
    lightsThreadsSection(options, state, width, threadWindowRows),
    ...lightsCompanionSections(options, state, input, width),
  ]
}

function lightsThreadUsageInline(options: StackAppOptions, summary: StackSessionSummary): string {
  const usage = threadUsageSummary(options, summary)
  if (!usage) return `${summary.turnCount}t`
  return `${formatTokenTotal(sessionTokenTotal(usage.totals))}tok`
}

function lightsThreadMaxScrollOffset(
  options: StackAppOptions,
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  columns: number,
  visibleRows: number,
): number {
  const windowRows = computeLightsThreadWindowRows(options, state, input, columns, visibleRows)
  return Math.max(0, buildLightsThreadPanelRows(options, state, columns).length - windowRows)
}

function lightsThreadsSection(
  options: StackAppOptions,
  state: AppState,
  columns: number,
  threadWindowRows: number,
): LightsPanelSection {
  const liveIds = resolveVisibleThreadIds(options.session.id, state.gardenerWorkerTargetId, {
    lifecycle: "live",
    history: state.history,
    threadLifecycleStatus: state.threadLifecycleStatus,
  })
  const activeIds = resolveActiveThreadIds(options.session.id, state.gardenerWorkerTargetId)
  const filteredSummaries = lightsThreadSummariesForView(options, state, columns)
  const panelRows = buildLightsThreadPanelRows(options, state, columns)
  const windowRows = threadWindowRows
  const maxOffset = Math.max(0, panelRows.length - windowRows)
  const offset = Math.min(state.lightsThreadScrollOffset, maxOffset)
  const filterActive = state.lightsThreadFilter.trim().length > 0
  const viewLabel = lightsThreadsViewIsCustom(state) ? "custom" : "default"
  const countLabel = filterActive ? `${filteredSummaries.length}/${state.history.length} shown` : `${liveIds.size} live`
  const header =
    maxOffset > 0
      ? `Threads · ${viewLabel} · ${countLabel} · ${activeIds.size} active · ${offset + 1}-${Math.min(panelRows.length, offset + windowRows)}/${panelRows.length}`
      : `Threads · ${viewLabel} · ${countLabel} · ${activeIds.size} active`
  if (panelRows.length === 0) {
    return {
      id: "threads",
      header,
      lines: [filterActive ? "  (no matches)" : "  (none)"],
    }
  }
  const window = panelRows.slice(offset, offset + windowRows)
  return {
    id: "threads",
    header,
    lines: window.map((row) => row.text),
    threadIds: window.map((row) => row.threadId),
    threadRowKinds: window.map((row) => row.kind),
  }
}

function lightsEffortsSection(options: StackAppOptions, state: AppState, columns: number): LightsPanelSection {
  let efforts: StackEffortSummary[]
  try {
    efforts = readEffortsPanelSummaries(options)
  } catch (error) {
    return {
      id: "efforts",
      header: "Efforts · unavailable",
      lines: [`  ${oneLine(errorMessage(error), Math.max(20, columns - 2))}`],
    }
  }

  const active = efforts.filter((effort) => effort.status !== "archived")
  const archived = efforts.filter((effort) => effort.status === "archived")
  const header = `Efforts · ${active.length} active · ${archived.length} archived`
  if (efforts.length === 0) {
    return { id: "efforts", header, lines: ["  (none)"] }
  }
  if (active.length === 0) {
    const latestArchived = archived[0]
    return {
      id: "efforts",
      header,
      lines: latestArchived
        ? [`  archived latest · ${oneLine(latestArchived.title || latestArchived.slug, Math.max(20, columns - 22))}`]
        : ["  (none)"],
    }
  }

  const lines: string[] = []
  for (const effort of active.slice(0, 3)) {
    const metaCount = effort.meta_thread_refs.length
    const metaLabel = `${metaCount} thread${metaCount === 1 ? "" : "s"}`
    const primary = `${effort.title || effort.slug} · ${effort.template} · ${metaLabel} · updated ${effortAgeLabel(effort)}`
    lines.push(`  ${oneLine(primary, Math.max(20, columns - 2))}`)

    for (const signal of effortLightsSignals(effort, options.config.workspaceRoot, options.config.stackDataRoot).slice(0, 2)) {
      lines.push(`  ${oneLine(signal, Math.max(20, columns - 2))}`)
    }
  }
  if (active.length > 3) lines.push(`  ... +${active.length - 3} active efforts`)
  return { id: "efforts", header, lines }
}

function effortLightsSignals(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string[] {
  const signals: string[] = []
  const goal = effortGoalContextLine(effort, stackDataRoot)
  if (goal) signals.push(`goal - ${goal}`)
  const acceptance = effortAcceptanceLine(effort, workspaceRoot, stackDataRoot)
  if (acceptance) signals.push(`acceptance - ${acceptance}`)
  const remaining = effortRemainingWorkLine(effort, workspaceRoot, stackDataRoot)
  if (remaining) signals.push(`remaining - ${remaining}`)
  const runEvidence = effortRunEvidenceLine(effort, workspaceRoot, stackDataRoot)
  if (runEvidence) signals.push(`run evidence - ${runEvidence}`)
  const candidate = effortOptimizerCandidateLine(effort, workspaceRoot, stackDataRoot)
  if (candidate) signals.push(`candidate - ${candidate}`)
  const progress = effortLatestProgressLine(effort, workspaceRoot)
  if (progress) signals.push(`progress - ${progress}`)
  const handoff = effortHandoffLine(effort, workspaceRoot)
  if (handoff) signals.push(`handoff - ${handoff}`)
  return signals
}

function lightsGardenersSection(options: StackAppOptions, state: AppState, columns: number): LightsPanelSection {
  const inboxCount = readGardenerInbox(options.config.stackDataRoot, state.gardenerThreadId).length
  const status = state.gardenerChatRunning ? "running" : inboxCount > 0 ? "queued" : "idle"
  const header = `Gardeners · ${status} · inbox ${inboxCount}`
  const lines = [
    `  default ${state.gardenerThreadId.slice(0, 8)} · target ${resolveGardenerWorkerTargetId(options, state).slice(0, 8)}`,
  ]
  if (state.gardenerWorkspacePath) lines.push(`  workspace ${oneLine(state.gardenerWorkspacePath, Math.max(20, columns - 12))}`)
  if (state.gardenerNotice) lines.push(`  notice ${oneLine(state.gardenerNotice, Math.max(20, columns - 10))}`)
  return { id: "gardeners", header, lines }
}

function lightsActorsSection(input: ReturnType<typeof buildOpsPanelInput>, columns: number): LightsPanelSection {
  const actors = input.actors
  const running = actors.subagents.filter((agent) => agent.status === "running" || agent.status === "spawning").length
  const failed = actors.subagents.filter((agent) => agent.status === "errored" || agent.status === "interrupted").length
  const header = `Actors · primary ${actors.primaryStatus} · workers ${actors.subagents.length} (${running} active, ${failed} failed)`
  const lines = [`  model ${oneLine(actors.primaryModel, Math.max(10, columns - 10))}`]
  for (const agent of actors.subagents.slice(0, 4)) {
    lines.push(`  ${oneLine(subagentDisplayName(agent), 16)} · ${subagentStatusLabel(agent.status)}`)
  }
  if (actors.subagents.length > 4) lines.push(`  ... +${actors.subagents.length - 4} workers`)
  return { id: "actors", header, lines }
}

function lightsCloudSection(
  state: AppState,
  input: ReturnType<typeof buildOpsPanelInput>,
  columns: number,
): LightsPanelSection {
  const projects = input.projects.projects
  const factories = projects.flatMap((project) => project.factories)
  const runs = projects.flatMap((project) => project.runs)
  const activeRuns = runs.filter((run) => !isTerminalLikeStatus(run.state)).length
  const activeFactories = factories.filter((factory) => factory.isRunning || (factory.activeEfforts ?? 0) > 0).length
  const deployments = input.projects.deployments
  const degradedDeployments = deployments.filter((deployment) => deployment.degradedReason || deployment.ready === false).length
  const hostedActive = input.hosted.runs.filter((run) => !isTerminalLikeStatus(run.status)).length
  const header = `Cloud · ${input.projects.status} · projects ${projects.length} · factories ${factories.length}/${activeFactories} active`
  const lines = [
    `  runs ${runs.length}/${activeRuns} active · deployments ${deployments.length}${degradedDeployments ? ` (${degradedDeployments} degraded)` : ""}`,
    `  hosted optimizers ${input.hosted.runs.length}/${hostedActive} active · ${input.hosted.status}`,
  ]
  for (const project of projects.slice(0, 3)) {
    const run = project.runs[0]
    const factory = project.factories[0]
    const suffix = [
      factory ? `f ${oneLine(factory.status ?? "unknown", 10)}` : "",
      run ? `r ${oneLine(run.state, 10)}` : "",
    ].filter(Boolean).join(" · ")
    lines.push(`  ${oneLine(project.name, Math.max(12, columns - 18))}${suffix ? ` · ${suffix}` : ""}`)
  }
  if (input.projects.message) lines.push(`  ${oneLine(input.projects.message, Math.max(20, columns - 4))}`)
  if (state.remoteActionMessage) lines.push(`  action ${oneLine(state.remoteActionMessage, Math.max(20, columns - 10))}`)
  return { id: "cloud", header, lines }
}

function lightsLocalSection(input: ReturnType<typeof buildOpsPanelInput>, columns: number): LightsPanelSection {
  const containers = input.containers.containers
  const optimizerRuns = input.localOptimizers.runs
  const activeOptimizers = optimizerRuns.filter((run) => !isTerminalLikeStatus(run.status)).length
  const header = `Local · containers ${containers.length} · optimizers ${optimizerRuns.length}/${activeOptimizers} active`
  const lines = [
    `  optimizer service ${input.localOptimizers.status} · ${oneLine(input.localOptimizers.serviceUrl, Math.max(12, columns - 24))}`,
  ]
  for (const container of containers.slice(0, 3)) {
    lines.push(`  ${oneLine(container.name, 18)} · ${oneLine(container.status, 10)}`)
  }
  if (input.containers.message) lines.push(`  ${oneLine(input.containers.message, Math.max(20, columns - 4))}`)
  return { id: "local", header, lines }
}

function lightsUsageSection(input: ReturnType<typeof buildOpsPanelInput>, columns: number): LightsPanelSection {
  const usage = input.usage
  const parts = [`Usage · Synth ${usage.environmentName} ${usage.status}`]
  if (usage.planTier) parts.push(usage.planTier)
  if (usage.spendTodayUsd !== undefined) parts.push(`today ${formatUsd(usage.spendTodayUsd)}`)
  if (usage.usage7dUsd !== undefined) parts.push(`7d ${formatUsd(usage.usage7dUsd)}`)
  if (usage.walletUsd !== undefined) parts.push(`wallet ${formatUsd(usage.walletUsd)}`)
  const header = oneLine(parts.join(" · "), columns)
  const lines = [
    `  agent ${oneLine(input.agentUsage.codexAuthPlan, 18)}${input.agentUsage.codexBudget ? ` · ${oneLine(input.agentUsage.codexBudget, 24)}` : ""}`,
  ]
  if (input.agentUsage.sessionSummary) lines.push(`  session ${oneLine(input.agentUsage.sessionSummary, Math.max(20, columns - 10))}`)
  if (usage.message) lines.push(`  ${oneLine(usage.message, Math.max(20, columns - 4))}`)
  return { id: "usage", header, lines }
}

function toggleRightPanelMode(state: AppState): void {
  state.rightPanelContent = "default"
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

function latestLocalArtifact(config: StackConfig): StackArtifactManifestEntry | undefined {
  try {
    return readLatestArtifacts(config)[0]
  } catch {
    return undefined
  }
}

function artifactDisplayUrl(artifact: StackArtifactManifestEntry): string {
  return artifact.public_url ?? artifact.hosted_url ?? artifact.local_url
}

async function openLatestLocalArtifact(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): Promise<void> {
  const artifact = latestLocalArtifact(options.config)
  if (!artifact) {
    appendStackBlock(state.blocks, "no local artifact page yet")
    refresh()
    return
  }
  const url = artifactDisplayUrl(artifact)
  const result = await openUrlInSystemBrowser(url)
  appendStackBlock(state.blocks, result.ok ? `opened artifact ${artifact.slug}: ${url}` : `artifact open failed: ${result.message}`)
  refresh()
}

function footerHint(config: StackConfig, state: AppState, _sessionId: string): string {
  const parts: string[] = []
  const artifact = latestLocalArtifact(config)
  if (artifact) {
    parts.push(`artifact Ctrl+] ${artifactDisplayUrl(artifact)}`)
  }
  if (permissionsNeedsReminder(state.telemetryStatus?.tiers)) {
    parts.push("/permissions review telemetry")
  }
  if (agentChatPauseEligible(state)) {
    parts.push(state.agentChatPaused ? "Esc stop turn · Enter steer · ctrl+enter queue" : "Esc pause")
  }
  if (evalFeedbackEnabled(state)) {
    parts.push("Ctrl+E eval feedback")
  }
  parts.push("/exit quit")
  return parts.join(" · ")
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
      primaryModel: options.config.synthWorkerInferenceEnabled
        ? options.config.synthWorkerInferenceModel
        : harnessModel(options.config),
      primaryStatus: state.status,
      turnCount: options.session.turns.length + (state.status === "running" ? 1 : 0),
      currentTurnStartedAt: state.currentTurnStartedAt,
      cursorHarness: isCursorHarness(options.config),
      codexSubagentsEnabled: options.config.codexSubagentsEnabled,
      codexSubagentModel: options.config.codexSubagentModel,
      codexSubagentReasoningEffort: options.config.codexSubagentReasoningEffort,
      codexArgsLocked: options.config.codexArgsLocked,
      synthWorkerInferenceEnabled: options.config.synthWorkerInferenceEnabled,
      synthWorkerInferenceModel: options.config.synthWorkerInferenceModel,
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

// The monitor sidecar renders through the same transcript renderer as the worker, but its turns are
// post-hoc (no live-thinking stream) and it carries a "monitor" speaker label, not the worker's.
function sidecarTranscriptRenderOptions(state: AppState): TranscriptRenderOptions {
  return {
    expandedBlockIds: state.expandedBlockIds,
    showDetails: state.showDetails,
    liveThinkingText: undefined,
    running: state.monitorSnapshot.status === "running",
    spinnerFrame: state.spinnerFrame,
    agentSpeakerLabel: "monitor",
    showAgentSpeakerLabel: false,
  }
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
  if (state.agentChatPaused && agentChatPauseEligible(state)) return theme.bgSubtle
  if (state.focusMode === "agent" || state.inputBuffer.length > 0) return theme.bgInputFocused
  return theme.bgPanel
}

function monitorInputBackground(state: AppState): string {
  if (state.focusMode === "monitor" || state.monitorInputBuffer.length > 0) return theme.bgInputFocused
  return theme.bgPanel
}

function renderMonitorInputStyled(state: AppState): StyledText {
  const sidecarUi = {
    monitorSnapshot: state.monitorSnapshot,
    sidecarChatInFlight: state.sidecarChatInFlight,
    sidecarQueuedMessages: state.sidecarQueuedMessages,
    spinnerFrame: state.spinnerFrame,
    status: state.status,
    monitorInputBuffer: state.monitorInputBuffer,
    focusMode: state.focusMode,
  }
  const preview = state.monitorInputBuffer.replace(/\n/g, " ↵ ")
  const sidecarBusy =
    isGoalMode(state) ||
    sidecarAgentActive(sidecarUi) ||
    state.status === "running" ||
    (state.sidecarQueuedMessages?.length ?? 0) > 0

  if (sidecarBusy) {
    return renderSidecarChatInputStyled(sidecarUi)
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

function renderAgentInputStyled(options: StackAppOptions, state: AppState, columns?: number): StyledText {
  const onGardenerSession = isGardenerSession(options, state)
  return renderWorkerAgentInputStyled(
    {
      status: state.status,
      focusMode: state.focusMode,
      agentChatPaused: state.agentChatPaused,
      inputBuffer: state.inputBuffer,
      queuedMessages: state.queuedMessages,
      spinnerFrame: state.spinnerFrame,
      toolLogs: state.toolLogs,
      currentTurnStartedAt: state.currentTurnStartedAt,
      columns,
      showRecentToolActivity: !isGoalMode(state),
    },
    {
      idleHint: onGardenerSession ? "Message gardener · /help" : "Build anything · /help",
      promptColor: onGardenerSession ? "#3fb950" : theme.synth.amber,
    },
  )
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
    `synth=${synthHeaderAuthLabel(state.remoteAccountSnapshot)}`,
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
    state.focusMode === "remote" ? "remote: o output | O artifact | t target | m message | a attach | d download | v remote | l saved" : "tab remote for live actions",
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

function renderEffortsPanelStyled(options: StackAppOptions, state: AppState, columns: number, visibleRows: number): StyledText {
  const chunks: TextChunk[] = []
  let efforts: StackEffortSummary[]
  try {
    efforts = readEffortsPanelSummaries(options)
    state.selectedEffortIndex = clampIndex(state.selectedEffortIndex, efforts.length)
  } catch (error) {
    return new StyledText([
      fg(theme.synth.red)("Efforts could not be read"),
      fg(theme.fgPrimary)("\n"),
      fg(theme.fgMuted)(oneLine(errorMessage(error), Math.max(24, columns))),
    ])
  }

  const selected = efforts[state.selectedEffortIndex]
  const active = efforts.filter((effort) => effort.status !== "archived")
  const archived = efforts.filter((effort) => effort.status === "archived")
  const lines: Array<{ text: string; color: string }> = []
  lines.push({
    text: oneLine(`Efforts ${active.length} active - ${archived.length} archived`, columns),
    color: theme.synth.amber,
  })
  const templates = effortTemplatesPanelLine(options.config.stackDataRoot, options.config.appRoot, columns)
  if (templates) {
    lines.push({
      text: oneLine(`templates - ${templates}`, columns),
      color: theme.fgSecondary,
    })
  }
  lines.push({
    text: oneLine("new - /efforts new <slug> --template <id>", columns),
    color: theme.fgMuted,
  })
  if (selected) {
    const metaThreadId = options.session.metaThreadId ?? state.metaThreadManifest?.id
    const actions = [
      "j/k select",
      "n new",
      "h handoff",
      selected.status === "archived" ? "a activate" : "a archive",
      metaThreadId ? "b bind thread" : "",
      "r refresh",
    ].filter(Boolean).join(" - ")
    lines.push({
      text: oneLine(`selected - ${selected.slug} - ${actions}`, columns),
      color: theme.fgSecondary,
    })
  }
  lines.push({ text: "", color: theme.fgPrimary })

  if (efforts.length === 0) {
    lines.push({ text: "No Efforts yet.", color: theme.fgMuted })
  } else {
    pushEffortSectionLines(lines, "Active", active, columns, options.config, selected?.id)
    pushEffortSectionLines(lines, "Archived", archived, columns, options.config, selected?.id)
  }

  const rendered = lines.slice(0, Math.max(1, visibleRows))
  const hidden = Math.max(0, lines.length - rendered.length)
  rendered.forEach((line, index) => {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(fg(line.color)(line.text))
  })
  if (hidden > 0) {
    chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(fg(theme.fgMuted)(`... ${hidden} more`))
  }
  return new StyledText(chunks)
}

function effortTemplatesPanelLine(stackDataRoot: string, appRoot: string, columns: number): string {
  try {
    const templates = listEffortTemplates({ stackDataRoot, appRoot })
    const preferred = ["research", "engineering", "system-optimizer", "task-classifier"]
    const ids = [
      ...preferred.filter((id) => templates.some((template) => template.id === id)),
      ...templates.map((template) => template.id).filter((id) => !preferred.includes(id)),
    ]
    if (ids.length === 0) return ""
    const shown: string[] = []
    let remaining = ids.length
    for (const id of ids) {
      const suffix = remaining > 1 ? ` +${remaining - 1}` : ""
      const candidate = [...shown, id].join(", ") + suffix
      if (candidate.length > Math.max(12, columns - 12)) break
      shown.push(id)
      remaining -= 1
    }
    if (shown.length === 0) return `${ids.length} available`
    return `${shown.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`
  } catch {
    return ""
  }
}

function pushEffortSectionLines(
  lines: Array<{ text: string; color: string }>,
  title: string,
  efforts: StackEffortSummary[],
  columns: number,
  config: StackConfig,
  selectedEffortId?: string,
): void {
  if (efforts.length === 0) return
  const { workspaceRoot, stackDataRoot } = config
  if (lines.length > 2) lines.push({ text: "", color: theme.fgPrimary })
  lines.push({ text: `${title} (${efforts.length})`, color: theme.fgSecondary })
  for (const effort of efforts) {
    const selected = effort.id === selectedEffortId
    lines.push({
      text: oneLine(`${selected ? ">" : " "} ${effort.title || effort.slug}`, columns),
      color: selected ? theme.synth.amber : theme.fgPrimary,
    })
    const metaCount = effort.meta_thread_refs.length
    const metaLabel = `${metaCount} thread${metaCount === 1 ? "" : "s"}`
    const refs = effortSummaryRefs(effort)
    lines.push({
      text: oneLine(`  ${effort.status} - ${effort.template} - ${metaLabel} - updated ${effortAgeLabel(effort)}`, columns),
      color: theme.fgMuted,
    })
    if (refs) {
      lines.push({
        text: oneLine(`  ${refs}`, columns),
        color: theme.fgMuted,
      })
    }
    const artifacts = effortArtifactInventoryLine(effort, workspaceRoot, stackDataRoot)
    if (artifacts) {
      lines.push({
        text: oneLine(`  artifacts - ${artifacts}`, columns),
        color: theme.fgMuted,
      })
    }
    const artifactPage = latestArtifactForEffort(config, effort)
    if (artifactPage) {
      lines.push({
        text: oneLine(`  artifact page - ${artifactPage.slug} - ${artifactDisplayUrl(artifactPage)}`, columns),
        color: theme.fgSecondary,
      })
    }
    const audit = effortAuditLine(effort, workspaceRoot, stackDataRoot)
    if (audit) {
      lines.push({
        text: oneLine(`  audit - ${audit.text}`, columns),
        color: audit.color,
      })
    }
    const goal = effortGoalContextLine(effort, stackDataRoot)
    if (goal) {
      lines.push({
        text: oneLine(`  goal - ${goal}`, columns),
        color: theme.fgSecondary,
      })
    }
    const progress = effortLatestProgressLine(effort, workspaceRoot)
    if (progress) {
      lines.push({
        text: oneLine(`  progress - ${progress}`, columns),
        color: theme.fgSecondary,
      })
    }
    const activity = effortLatestActivityLine(effort, workspaceRoot)
    if (activity) {
      lines.push({
        text: oneLine(`  activity - ${activity}`, columns),
        color: theme.fgSecondary,
      })
    }
    const blocker = effortLatestBlockerLine(effort, workspaceRoot, stackDataRoot)
    if (blocker) {
      lines.push({
        text: oneLine(`  blocker - ${blocker}`, columns),
        color: theme.synth.amber,
      })
    }
    const handoff = effortHandoffLine(effort, workspaceRoot)
    if (handoff) {
      lines.push({
        text: oneLine(`  handoff - ${handoff}`, columns),
        color: theme.fgSecondary,
      })
    }
    const acceptance = effortAcceptanceLine(effort, workspaceRoot, stackDataRoot)
    if (acceptance) {
      lines.push({
        text: oneLine(`  acceptance - ${acceptance}`, columns),
        color: theme.fgSecondary,
      })
    }
    const candidate = effortOptimizerCandidateLine(effort, workspaceRoot, stackDataRoot)
    if (candidate) {
      lines.push({
        text: oneLine(`  candidate - ${candidate}`, columns),
        color: theme.fgSecondary,
      })
    }
    const runEvidence = effortRunEvidenceLine(effort, workspaceRoot, stackDataRoot)
    if (runEvidence) {
      lines.push({
        text: oneLine(`  run evidence - ${runEvidence}`, columns),
        color: theme.fgSecondary,
      })
    }
    const benchmark = effortBenchmarkLine(effort, workspaceRoot, stackDataRoot)
    if (benchmark) {
      lines.push({
        text: oneLine(`  benchmark - ${benchmark}`, columns),
        color: theme.fgSecondary,
      })
    }
    if (selected) {
      const detailLines = effortEvidenceDetailLines(effort, workspaceRoot, stackDataRoot)
      if (detailLines.length > 0) {
        lines.push({
          text: oneLine("  evidence detail", columns),
          color: theme.synth.amber,
        })
        for (const detail of detailLines) {
          lines.push({
            text: oneLine(`    ${detail}`, columns),
            color: theme.fgSecondary,
          })
        }
      }
    }
    const remaining = effortRemainingWorkLine(effort, workspaceRoot, stackDataRoot)
    if (remaining) {
      lines.push({
        text: oneLine(`  remaining - ${remaining}`, columns),
        color: theme.synth.amber,
      })
    }
    const engineering = effortEngineeringPacketLine(effort, workspaceRoot)
    if (engineering) {
      lines.push({
        text: oneLine(`  engineering - ${engineering}`, columns),
        color: theme.fgSecondary,
      })
    }
    lines.push({
      text: oneLine(`  ${effort.folder_ref}`, columns),
      color: theme.fgMuted,
    })
  }
}

function latestArtifactForEffort(config: StackConfig, effort: StackEffortSummary): StackArtifactManifestEntry | undefined {
  try {
    return readLatestArtifacts(config).find((artifact) => artifact.effort === effort.id || artifact.effort === effort.slug)
  } catch {
    return undefined
  }
}

function effortEvidenceDetailLines(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string[] {
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    if (!current) return []
    const lines: string[] = []
    for (const candidate of readEffortOptimizerCandidateSummaries(current, 3).slice().reverse()) {
      lines.push(`cand - ${formatEffortCandidateDetail(candidate)}`)
    }
    for (const evidence of readEffortRunEvidenceSummaries(current, 3).slice().reverse()) {
      lines.push(`run - ${formatEffortRunEvidenceDetail(evidence)}`)
    }
    for (const benchmark of readEffortBenchmarkSummaries(current, 3).slice().reverse()) {
      lines.push(`bench - ${formatEffortBenchmarkDetail(benchmark)}`)
    }
    return lines.slice(0, 8)
  } catch {
    return []
  }
}

function formatEffortCandidateDetail(candidate: StackEffortOptimizerCandidateSummary): string {
  const parts = [
    candidate.path ? `file ${effortEvidenceFileRef(candidate.path)}` : "",
    candidate.score ? `${candidate.score_label || "score"} ${candidate.score}` : "",
    candidate.split ?? "",
    candidate.source_receipt_path ? `receipt ${effortEvidenceFileRef(candidate.source_receipt_path)}` : "",
    candidate.candidate_id,
    `run ${candidate.optimizer_run_id}`,
  ].filter(Boolean)
  return parts.join(" - ")
}

function formatEffortRunEvidenceDetail(evidence: StackEffortRunEvidenceSummary): string {
  const parts = [
    evidence.path ? `file ${effortEvidenceFileRef(evidence.path)}` : "",
    evidence.metric ?? "",
    evidence.source_receipt_path ? `receipt ${effortEvidenceFileRef(evidence.source_receipt_path)}` : "",
    evidence.run_kind,
    `run ${evidence.run_id}`,
    evidence.acceptance_level ?? "",
  ].filter(Boolean)
  return parts.join(" - ")
}

function formatEffortBenchmarkDetail(benchmark: StackEffortBenchmarkSummary): string {
  const id = benchmark.benchmark_id ? `${benchmark.benchmark_id} - ` : ""
  const version = benchmark.version ? ` - ${benchmark.version}` : ""
  const metrics = benchmark.metrics.length > 0 ? ` - metrics ${benchmark.metrics.join(", ")}` : ""
  const file = benchmark.path ? `file ${effortEvidenceFileRef(benchmark.path)} - ` : ""
  const receipt = benchmark.source_receipt_path ? ` - receipt ${effortEvidenceFileRef(benchmark.source_receipt_path)}` : ""
  return `${file}${id}${benchmark.name}${version}${metrics}${receipt}`
}

function effortEvidenceFileRef(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return path
  const file = parts[parts.length - 1] ?? path
  const dir = parts.slice(Math.max(0, parts.length - 3), -1).join("/")
  return dir ? `${file} @ ${dir}` : file
}

function effortAgeLabel(effort: StackEffortSummary): string {
  if (!effort.updated_at) return "unknown"
  return `${lightsThreadRelativeAge(effort.updated_at)} ago`
}

function effortSummaryRefs(effort: StackEffortSummary): string {
  const counts = new Map<string, number>()
  for (const ref of effort.refs) {
    counts.set(ref.system, (counts.get(ref.system) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([system, count]) => (count === 1 ? system : `${count} ${system}`))
    .join(" - ")
}

function effortArtifactInventoryLine(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string {
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    if (!current) return ""
    const inventory = effortArtifactInventory(current)
    const findingCount = Object.values(inventory.counts.findings).reduce((sum, count) => sum + count, 0)
    const parts = [
      `${inventory.counts.total} total`,
      `${findingCount} findings`,
    ]
    if (inventory.counts.ideas > 0) parts.push(`${inventory.counts.ideas} idea${inventory.counts.ideas === 1 ? "" : "s"}`)
    if (inventory.counts.human > 0) parts.push(`${inventory.counts.human} human`)
    if (inventory.counts.generated > 0) parts.push(`${inventory.counts.generated} generated`)
    if (inventory.counts.repos > 0) parts.push(`${inventory.counts.repos} repos`)
    if (inventory.counts.receipt_sidecars > 0) {
      const sourceSummary = effortReceiptSourceSummary(inventory.receipt_sources)
      const label = `${inventory.counts.receipt_sidecars} receipt${inventory.counts.receipt_sidecars === 1 ? "" : "s"}`
      parts.push(sourceSummary ? `${label} ${sourceSummary}` : label)
    }
    return parts.join(" - ")
  } catch {
    return ""
  }
}

function effortReceiptSourceSummary(sources: ReturnType<typeof effortArtifactInventory>["receipt_sources"]): string {
  if (sources.length === 0) return ""
  const counts = new Map<string, number>()
  for (const source of sources) {
    const key = source.receipt.source_kind?.trim() || "source"
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([kind, count]) => `${count} ${kind}`)
  const hidden = Math.max(0, counts.size - parts.length)
  return `(${parts.join(", ")}${hidden > 0 ? ` +${hidden}` : ""})`
}

function effortAuditLine(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): { text: string; color: string } | undefined {
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    if (!current) return { text: "fail - missing folder or manifest", color: theme.synth.red }
    const audit = auditEffort(current)
    const failures = audit.checks.filter((check) => check.status === "fail").length
    const warnings = audit.checks.filter((check) => check.status === "warn").length
    if (audit.status === "pass") return { text: "pass", color: theme.fgSecondary }
    if (audit.status === "warn") return { text: `warn - ${warnings} warning${warnings === 1 ? "" : "s"}`, color: theme.synth.amber }
    return { text: `fail - ${failures} failure${failures === 1 ? "" : "s"}`, color: theme.synth.red }
  } catch {
    return { text: "fail - audit unavailable", color: theme.synth.red }
  }
}

function effortGoalContextLine(effort: StackEffortSummary, stackDataRoot: string): string {
  for (const metaThreadId of effort.meta_thread_refs) {
    const manifest = readEffortMetaThreadManifestSync(stackDataRoot, metaThreadId)
    const objective = manifest?.active_goal?.objective?.trim()
    if (!objective) continue
    const status = normalizeThreadGoalStatus(manifest?.active_goal?.status) ?? "active"
    const parts = [status, objective]
    const usage = manifest?.usage_summary
    const tokens = usage ? sessionTokenTotal(usage.totals) : 0
    if (tokens > 0) parts.push(`${formatTokenTotal(tokens)} tok`)
    if (manifest?.updated_at) parts.push(`updated ${lightsThreadRelativeAge(manifest.updated_at)} ago`)
    return parts.join(" - ")
  }
  return ""
}

function readEffortMetaThreadManifestSync(stackDataRoot: string, metaThreadId: string): StackdMetaThreadManifest | undefined {
  const root = resolve(stackDataRoot)
  const path = resolve(root, ".stack", "meta-threads", metaThreadId, "manifest.json")
  const rel = relative(root, path)
  if (/^\.\.(?:[\\/]|$)/.test(rel)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StackdMetaThreadManifest
  } catch {
    return undefined
  }
}

function effortLatestProgressLine(effort: StackEffortSummary, workspaceRoot: string): string {
  const root = resolve(workspaceRoot)
  const folder = resolve(root, effort.folder_ref)
  const rel = relative(root, folder)
  if (!rel || /^\.\.(?:[\\/]|$)/.test(rel)) return ""
  const progressPath = join(folder, "PROGRESS.md")
  if (!existsSync(progressPath)) return ""
  try {
    const lines = readFileSync(progressPath, "utf8").split(/\r?\n/)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim()
      if (!line) continue
      const match = line.match(/^- (\d{4}-\d{2}-\d{2}T[^ ]+) - (.+)$/)
      if (match?.[2]) return match[2].trim()
    }
  } catch {
    return ""
  }
  return ""
}

function effortLatestActivityLine(effort: StackEffortSummary, workspaceRoot: string): string {
  const root = resolve(workspaceRoot)
  const folder = resolve(root, effort.folder_ref)
  const rel = relative(root, folder)
  if (!rel || /^\.\.(?:[\\/]|$)/.test(rel)) return ""
  const activityPath = join(folder, "ACTIVITY.jsonl")
  if (!existsSync(activityPath)) return ""
  try {
    const lines = readFileSync(activityPath, "utf8").split(/\r?\n/)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim()
      if (!line) continue
      const entry = JSON.parse(line) as { type?: unknown; summary?: unknown }
      const type = typeof entry.type === "string" ? entry.type.trim() : ""
      const summary = typeof entry.summary === "string" ? entry.summary.trim() : ""
      if (type || summary) return [type, summary].filter(Boolean).join(" - ")
    }
  } catch {
    return ""
  }
  return ""
}

function effortLatestBlockerLine(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string {
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    if (!current) return ""
    const blockers = readEffortOpenBlockerTail(current, 1)
    const blocker = blockers[blockers.length - 1]
    if (!blocker) return ""
    return [blocker.blocker, blocker.owner ? `owner ${blocker.owner}` : "", blocker.next ? `next ${blocker.next}` : ""].filter(Boolean).join(" - ")
  } catch {
    return ""
  }
}

function effortHandoffLine(effort: StackEffortSummary, workspaceRoot: string): string {
  const root = resolve(workspaceRoot)
  const folder = resolve(root, effort.folder_ref)
  const rel = relative(root, folder)
  if (!rel || /^\.\.(?:[\\/]|$)/.test(rel)) return ""
  const handoffPath = join(folder, "HANDOFF.md")
  if (!existsSync(handoffPath)) return ""
  try {
    const stat = statSync(handoffPath)
    return `HANDOFF.md - updated ${lightsThreadRelativeAge(stat.mtime.toISOString())} ago`
  } catch {
    return "HANDOFF.md"
  }
}

function effortAcceptanceLine(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string {
  const root = resolve(workspaceRoot)
  const folder = resolve(root, effort.folder_ref)
  const rel = relative(root, folder)
  if (!rel || /^\.\.(?:[\\/]|$)/.test(rel)) return ""
  const acceptancePath = join(folder, "findings", "results", "acceptance-summary.md")
  if (!existsSync(acceptancePath)) return ""
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    const packet = current ? readEffortAcceptancePacket(current) : undefined
    const stat = statSync(acceptancePath)
    const openGraduation = packet?.open_levels.filter((level) => ["A2", "A3", "A4"].includes(level)) ?? []
    const status = packet
      ? `${packet.v1_status}${packet.graduation_status !== "not_applicable" ? ` - grad ${packet.graduation_status}${openGraduation.length > 0 ? ` ${openGraduation.join("/")}` : ""}` : ""}`
      : "acceptance-summary.md"
    return `${status} - updated ${lightsThreadRelativeAge(stat.mtime.toISOString())} ago`
  } catch {
    return "acceptance-summary.md"
  }
}

function effortOptimizerCandidateLine(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string {
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    if (!current) return ""
    const candidates = readEffortOptimizerCandidateSummaries(current, 1)
    const candidate = candidates[candidates.length - 1]
    if (!candidate) return ""
    const parts = [
      candidate.score ? `${candidate.score_label || "score"} ${candidate.score}` : "",
      candidate.split ?? "",
      candidate.candidate_id,
      `run ${candidate.optimizer_run_id}`,
      `updated ${lightsThreadRelativeAge(candidate.observed_at)} ago`,
    ].filter(Boolean)
    return parts.join(" - ")
  } catch {
    return ""
  }
}

function effortRunEvidenceLine(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string {
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    if (!current) return ""
    const records = readEffortRunEvidenceSummaries(current, 1)
    const evidence = records[records.length - 1]
    if (!evidence) return ""
    const metric = evidence.metric ? `${evidence.metric} - ` : ""
    const level = evidence.acceptance_level ? ` - ${evidence.acceptance_level}` : ""
    return `${metric}${evidence.run_kind} - run ${evidence.run_id}${level} - updated ${lightsThreadRelativeAge(evidence.observed_at)} ago`
  } catch {
    return ""
  }
}

function effortBenchmarkLine(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string {
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    if (!current) return ""
    const records = readEffortBenchmarkSummaries(current, 1)
    const benchmark = records[records.length - 1]
    if (!benchmark) return ""
    const id = benchmark.benchmark_id ? `${benchmark.benchmark_id} - ` : ""
    const metrics = benchmark.metrics.length > 0 ? ` - ${benchmark.metrics.join(", ")}` : ""
    return `${id}${benchmark.name}${metrics} - updated ${lightsThreadRelativeAge(benchmark.observed_at)} ago`
  } catch {
    return ""
  }
}

function effortRemainingWorkLine(effort: StackEffortSummary, workspaceRoot: string, stackDataRoot: string): string {
  try {
    const current = readEffort({ workspaceRoot, stackDataRoot }, effort.id)
    if (!current) return ""
    const remaining = readEffortRemainingWork(current)
    if (remaining.state !== "open") return ""
    const next = remaining.next_actions[0] ? ` - next ${remaining.next_actions[0]}` : ""
    return `${remaining.summary}${next}`
  } catch {
    return ""
  }
}

function effortEngineeringPacketLine(effort: StackEffortSummary, workspaceRoot: string): string {
  const root = resolve(workspaceRoot)
  const folder = resolve(root, effort.folder_ref)
  const rel = relative(root, folder)
  if (!rel || /^\.\.(?:[\\/]|$)/.test(rel)) return ""
  const packetPath = join(folder, "findings", "results", "engineering-change-summary.md")
  if (!existsSync(packetPath)) return ""
  try {
    const text = readFileSync(packetPath, "utf8")
    const changedFiles = markdownListCount(markdownSection(text, "Changed Files"))
    const validations = markdownListCount(markdownSection(text, "Validation"))
    const skippedGates = markdownListCount(markdownSection(text, "Skipped Gates"))
    const risks = markdownListCount(markdownSection(text, "Risks"))
    const stat = statSync(packetPath)
    const parts = [
      changedFiles > 0 ? `${changedFiles} file${changedFiles === 1 ? "" : "s"}` : "files unrecorded",
      validations > 0 ? `${validations} validation${validations === 1 ? "" : "s"}` : "validation unrecorded",
    ]
    if (skippedGates > 0) parts.push(`${skippedGates} skipped`)
    if (risks > 0) parts.push(`${risks} risk${risks === 1 ? "" : "s"}`)
    parts.push(`updated ${lightsThreadRelativeAge(stat.mtime.toISOString())} ago`)
    return parts.join(" - ")
  } catch {
    return "engineering-change-summary.md"
  }
}

function markdownSection(text: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "im")
  const match = pattern.exec(text)
  if (!match) return ""
  const start = (match.index ?? 0) + match[0].length
  const rest = text.slice(start)
  const next = /^##\s+/m.exec(rest)
  return next ? rest.slice(0, next.index) : rest
}

function markdownListCount(section: string): number {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !line.includes("No ") && !line.includes("unrecorded"))
    .length
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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

function synthHeaderAuthLabel(snapshot: RemoteAccountSnapshot): string {
  switch (snapshot.status) {
    case "connected":
      return snapshot.userEmail ? `connected ${inlineText(snapshot.userEmail, 24)}` : "connected"
    case "invalid-auth":
      return "auth rejected"
    case "offline":
      return snapshot.hasAuth ? "api offline" : "connect optional"
    case "missing-auth":
      return "connect optional"
    case "unknown":
      return snapshot.hasAuth ? "checking" : "connect optional"
  }
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
    state.focusMode === "remote" ? "r refresh | j/k jobs | f factory | o output | O open-artifact | t target" : "tab here for remote SMR",
    state.focusMode === "remote" ? "m message | a attach | p pause | u resume | s stop | w wake | d download | v remote | l saved" : "",
    state.focusMode === "remote" ? "attach draft: local/path -> optional/remote/path" : "",
    state.pendingRemoteAction ? `pending: ${remoteActionLabel(state.pendingRemoteAction)}` : "",
    state.remoteActionMessage ? `action: ${oneLine(state.remoteActionMessage, 40)}` : "",
    "",
    ...remoteResearchSyncLines(snapshot),
    ...(snapshot.sync ? [""] : []),
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
    `deployments: ${snapshot.deployments.length}`,
    ...remoteDeploymentRows(snapshot, 3),
    "",
    "Selected Factory",
    ...(selectedFactory ? selectedRemoteFactoryText(selectedFactory) : ["none"]),
  ].filter((line) => line.length > 0)
}

function remoteResearchSyncLines(snapshot: RemoteResearchSnapshot): string[] {
  const sync = snapshot.sync
  if (!sync) return []
  const lines = [
    `sync: push ${sync.pendingPush.length} · pull ${sync.pendingPull.length} · bind ${sync.linkedSmrRuns.length} · pass ${sync.recentRemoteGardenerPasses.length} · events ${sync.recentRunEvents.length}`,
  ]
  const request = sync.pendingPush[0] ?? sync.pendingPull[0]
  if (request) {
    lines.push(`  ${request.direction} ${oneLine(request.intent, 18)} · ${remoteSyncRequestTarget(request)}`)
  }
  const binding = sync.linkedSmrRuns[0]
  if (binding) {
    const meta = binding.metaThreadId ? ` · meta ${binding.metaThreadId.slice(0, 8)}` : ""
    lines.push(`  bind ${binding.runId.slice(0, 8)}${meta}`)
  }
  const pass = sync.recentRemoteGardenerPasses[0]
  if (pass) {
    lines.push(`  pass ${oneLine(pass.narration ?? pass.nextAction ?? pass.subjectId, 38)}`)
  }
  const runEvent = sync.recentRunEvents[0]
  if (runEvent) {
    lines.push(`  event ${remoteRunEventLabel(runEvent)}`)
  }
  return lines
}

function remoteSyncRequestTarget(request: RemoteSyncSnapshot["pendingPush"][number]): string {
  if (request.runId) return `run ${request.runId.slice(0, 8)}`
  if (request.projectId) return `proj ${request.projectId.slice(0, 8)}`
  if (request.factoryId) return `fac ${request.factoryId.slice(0, 8)}`
  if (request.deploymentId) return `dep ${request.deploymentId.slice(0, 8)}`
  if (request.metaThreadId) return `meta ${request.metaThreadId.slice(0, 8)}`
  return `${request.subjectKind} ${request.subjectId.slice(0, 8)}`
}

function remoteRunEventLabel(event: RemoteSyncSnapshot["recentRunEvents"][number]): string {
  const verb = event.action ?? event.status ?? event.mode ?? event.sender ?? "message"
  const body = event.body ? ` · ${oneLine(event.body, 28)}` : ""
  return `${event.runId.slice(0, 8)} · ${oneLine(verb, 14)}${body}`
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
    "Watch",
    ...hostedOptimizerWatchLines(snapshot, state.selectedHostedOptimizerRunIndex, state.remoteUsageSnapshot),
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
    detail.phase ? `phase ${detail.phase}` : "",
    detail.backendUpdatedAt ? `backend ${formatRemoteTimestamp(detail.backendUpdatedAt)}` : "",
    detail.generation !== undefined ? `generation ${detail.generation}` : "",
    detail.rolloutCount !== undefined ? `rollouts ${formatUsageNumber(detail.rolloutCount)}` : "",
    detail.heldoutReward !== undefined ? `heldout ${detail.heldoutReward}` : "",
    detail.trainReward !== undefined ? `train ${detail.trainReward}` : "",
    detail.bestCandidateId ? `best ${inlineText(detail.bestCandidateId, 30)}` : "",
    detail.costUsd !== undefined ? `cost $${detail.costUsd.toFixed(4)}` : "",
    detail.totalTokens !== undefined ? `tokens ${formatUsageNumber(detail.totalTokens)}` : "",
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

function remoteDeploymentRows(snapshot: RemoteResearchSnapshot, limit: number): string[] {
  const deployments = snapshot.deployments
  if (deployments.length === 0) return ["  no deployments"]
  return deployments.slice(0, limit).map((deployment) => {
    const status = inlineText(deployment.status ?? "-", 8).padEnd(8)
    const health = deployment.degradedReason
      ? ` issue ${inlineText(deployment.degradedReason, 18)}`
      : deployment.ready === false
        ? " not-ready"
        : ""
    const project = deployment.projectId ? ` proj ${deployment.projectId.slice(0, 8)}` : ""
    const at = formatRemoteShortTime(deployment.updatedAt)
    return `  ${status} ${at} ${inlineText(deployment.name || deployment.deploymentId, 20)}${project}${health}`
  })
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

function buildAgentTranscriptViewport(renderer: CliRenderer, options: StackAppOptions, state: AppState): TranscriptViewport {
  const widthShare = state.railsVisible ? 0.5 : 0.72
  const columns = Math.max(40, Math.floor(renderer.terminalWidth * widthShare) - 8)
  if (state.focusMode === "gardener") {
    const gardenerChromeRows =
      4 +
      (panelVoiceHintLine(state, "gardener", state.gardenerNotice) ? 1 : 0) +
      (slashMenuVisible(state.gardenerInputBuffer) ? 1 : 0) +
      Math.max(0, agentInputRenderedLineCount({
        status: state.gardenerChatRunning ? "running" : "idle",
        focusMode: state.focusMode,
        agentChatPaused: false,
        inputBuffer: state.gardenerInputBuffer,
        queuedMessages: state.gardenerQueuedMessages,
        spinnerFrame: state.spinnerFrame,
        toolLogs: state.gardenerLiveTools,
        currentTurnStartedAt: state.gardenerChatStartedAt,
        columns,
        showRecentToolActivity: true,
      }) - 1)
    const lines = Math.max(8, renderer.terminalHeight - (state.railsVisible ? 12 : 10) - gardenerChromeRows)
    return {
      lines,
      columns,
      pageLines: Math.max(3, Math.floor(lines * 0.8)),
    }
  }
  const goalPreviewLineCount = agentGoalPreviewLineCount(
    state.metaThreadManifest,
    state.goalContext,
    columns,
  )
  const workerGoalTabRows = showWorkerGoalTabs(state, state.metaEvents) ? 1 : 0
  const workerVoiceHintRows = panelVoiceHintLine(state, "worker") ? 1 : 0
  const chromeRows =
    agentPanelChromeRows({
      goalPreviewLineCount,
      inputLineCount: agentInputRenderedLineCount({
        status: state.status,
        focusMode: state.focusMode,
        agentChatPaused: state.agentChatPaused,
        inputBuffer: state.inputBuffer,
        queuedMessages: state.queuedMessages,
        spinnerFrame: state.spinnerFrame,
        toolLogs: state.toolLogs,
        currentTurnStartedAt: state.currentTurnStartedAt,
        columns,
        showRecentToolActivity: !isGoalMode(state),
      }),
      slashMenuOpen: slashMenuVisible(state.inputBuffer),
      goalMode: isGoalMode(state),
      gardenerSession: isGardenerSession(options, state),
      railsVisible: state.railsVisible,
    }) + workerGoalTabRows + workerVoiceHintRows
  const lines = Math.max(8, renderer.terminalHeight - (state.railsVisible ? 12 : 10) - chromeRows)
  return {
    lines,
    columns,
    pageLines: Math.max(3, Math.floor(lines * 0.8)),
  }
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

function agentTranscriptViewport(renderer: CliRenderer, state: AppState, options: StackAppOptions): TranscriptViewport {
  return buildAgentTranscriptViewport(renderer, options, state)
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

function handleAgentScrollKey(
  key: { name?: string; ctrl?: boolean },
  state: AppState,
  renderer?: CliRenderer,
  options?: StackAppOptions,
): boolean {
  const viewport =
    renderer && options ? agentTranscriptViewport(renderer, state, options) : undefined
  const direction = key.name === "pageup" || (key.ctrl && key.name === "u")
    ? "up"
    : key.name === "pagedown" || (key.ctrl && key.name === "d")
      ? "down"
      : undefined
  if (direction && showWorkerGoalTabs(state, state.metaEvents) && state.workerPanelView === "goal" && options) {
    const metaThreadTitle =
      state.metaThreadManifest?.title?.trim() ||
      state.metaThreadManifest?.active_goal?.objective?.trim() ||
      state.goalContext.objective?.trim()
    const events = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
    const maxOffset = isGoalMode(state)
      ? monitorGoalViewMaxScroll(
          monitorGoalViewInput(options, state, events, viewport?.columns ?? 80, metaThreadTitle),
          viewport?.lines ?? 12,
        )
      : previousGoalsListMaxScroll({
          state,
          events,
          metaThreadId: options.session.metaThreadId,
          columns: viewport?.columns ?? 80,
          expandedKeys: state.previousGoalExpandedKeys,
          selectedIndex: state.previousGoalSelectedIndex,
          visibleRows: viewport?.lines ?? 12,
        })
    handleWorkerGoalViewScroll(direction, state, maxOffset, () => undefined)
    state.lastAgentScrollAt = Date.now()
    return true
  }
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

function isTranscriptSpinnerActive(state: AppState): boolean {
  return state.status === "running"
    || state.gardenerChatRunning
    || state.monitorSnapshot.status === "running"
}

function seedGardenerLiveThinkingBlock(state: AppState): void {
  const startedAt = state.gardenerChatStartedAt ?? new Date().toISOString()
  state.gardenerLiveBlocks.push({
    id: randomUUID(),
    kind: "thinking",
    text: state.gardenerLiveThinking ?? "starting…",
    live: true,
    startedAt,
  })
}

function syncGardenerLiveThinkingBlock(state: AppState): void {
  const block = state.gardenerLiveBlocks.find(
    (entry): entry is Extract<TranscriptBlock, { kind: "thinking" }> =>
      entry.kind === "thinking" && entry.live === true,
  )
  if (!block) return
  const startedAt = block.startedAt ?? state.gardenerChatStartedAt
  const elapsedSec = startedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000))
    : 0
  const detail = state.gardenerLiveThinking?.trim()
  block.text = detail && detail !== "starting…"
    ? detail
    : elapsedSec > 15
      ? `working · ${elapsedSec}s`
      : "starting…"
}

function createGardenerLiveSink(
  state: AppState,
  refresh: () => void,
): {
  write: (chunk: string) => void
  flush: () => void
} {
  let buffer = ""
  const seededThinking = state.gardenerLiveBlocks.find(
    (block): block is Extract<TranscriptBlock, { kind: "thinking" }> =>
      block.kind === "thinking" && block.live === true,
  )
  const liveThinkingId: { current?: string } = { current: seededThinking?.id }
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
  const read = await readMetaThreadManifest(options.config.stackDataRoot, metaThreadId)
  // Sync codex thread goal → meta goal: the agent marks completion on its own thread goal, which
  // would otherwise leave this manifest stuck "active". Persists divergence so all readers agree.
  const manifest = await reconcileMetaThreadGoalFromCodex(metaThreadId, options.session.codexThreadId, read)
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
    await refreshMetaThreadGoal(options, state)
    await openHarnessSession(options, state, codexSessionHandle, options.session.codexThreadId)
    await refreshAgentContextFromSession(options, state, refresh, (limits) => {
      void observeCodexAuthState(options.config, options.session.id, limits, state)
    })
    await hydrateTranscriptFromRollout(options, state)
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
  trackActiveTurn(
    state,
    submitPrompt(
      routeMessages[0],
      options,
      state,
      codexSessionHandle,
      renderer,
      refresh,
      refreshHistory,
      refreshMetaEvents,
    ),
  )
  void refreshGardenerMaintenance(options, state, "inbox")
}

function handleGardenerChatScrollKey(
  key: { name?: string; ctrl?: boolean },
  options: StackAppOptions,
  state: AppState,
  renderer: CliRenderer,
  refresh: () => void,
): boolean {
  const events = readThreadMetaEvents(options.config.stackDataRoot, gardenerThreadId(state))
  const chat = buildGardenerChatTranscriptView(options, state, events)
  const viewport = buildAgentTranscriptViewport(renderer, options, state)
  const renderOptions = gardenerTranscriptRenderOptions(
    transcriptRenderOptions(state),
    state.gardenerChatRunning,
    state.gardenerLiveThinking,
  )
  const maxOffset = maxTranscriptScrollOffset(
    chat.blocks,
    chat.tools,
    chat.subagents,
    viewport.columns,
    renderOptions,
    viewport.lines,
  )
  if (key.name === "pageup" || (key.ctrl && key.name === "u")) {
    const next = scrollTranscriptViewport("up", state.gardenerScrollOffset, maxOffset)
    state.gardenerScrollOffset = next.offset
    state.gardenerScrollPinned = next.pinned
    refresh()
    return true
  }
  if (key.name === "pagedown" || (key.ctrl && key.name === "d")) {
    const next = scrollTranscriptViewport("down", state.gardenerScrollOffset, maxOffset)
    state.gardenerScrollOffset = next.offset
    state.gardenerScrollPinned = next.pinned
    refresh()
    return true
  }
  if (key.name === "home") {
    state.gardenerScrollOffset = maxOffset
    state.gardenerScrollPinned = false
    refresh()
    return true
  }
  if (key.name === "end") {
    state.gardenerScrollOffset = 0
    state.gardenerScrollPinned = true
    refresh()
    return true
  }
  return false
}

async function handleGardenerKey(
  key: { name?: string; ctrl?: boolean },
  options: StackAppOptions,
  state: AppState,
  codexSessionHandle: { session?: HarnessSession },
  renderer: CliRenderer,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  refreshMetaEvents: () => void,
  visibleRows: number,
): Promise<void> {
  if (state.gardenerInputBuffer.length > 0) return
  if (handleGardenerChatScrollKey(key, options, state, renderer, refresh)) return
  if (key.name === "p") {
    toggleLeftPanelRails(state)
    refresh()
    return
  }
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
      scrollGardenerPane("down", options, state, readThreadMetaEvents(options.config.stackDataRoot, gardenerThreadId(state)), buildGardenerThreadContext(options, state), 24, visibleRows, "narrative", refresh)
      return
    }
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    if (inbox.length > 0) {
      state.gardenerInboxSelectedIndex = Math.max(0, state.gardenerInboxSelectedIndex - 1)
    } else {
      scrollGardenerPane("up", options, state, readThreadMetaEvents(options.config.stackDataRoot, gardenerThreadId(state)), buildGardenerThreadContext(options, state), 24, visibleRows, "narrative", refresh)
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
    setPendingRemoteAction(state, state.mediationTargetKind === "factory" ? "pause-factory" : "pause-run")
    refresh()
    return
  }
  if (key.name === "u") {
    setPendingRemoteAction(state, state.mediationTargetKind === "factory" ? "resume-factory" : "resume-run")
    refresh()
    return
  }
  if (key.name === "s") {
    setPendingRemoteAction(state, "stop-run")
    refresh()
    return
  }
  if (key.name === "w") {
    setPendingRemoteAction(state, "wake-factory")
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

  const result = await executeRemoteActionResult(options, action, { run, factory, output, download, draft })
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

async function capturePapercutFromUi(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  note?: string,
): Promise<void> {
  try {
    const result = await captureStackPapercut(
      options.config.stackDataRoot,
      {
        ...papercutContextFromUi(options, state),
        ...(note?.trim() ? { summary: note.trim() } : {}),
      },
    )
    appendStackBlock(
      state.blocks,
      `papercut captured · ${result.contextLabel} · ${displayCwd(result.path)}`,
    )
  } catch (error) {
    appendStackBlock(state.blocks, `papercut capture failed: ${errorMessage(error)}`)
  } finally {
    refresh()
  }
}

function papercutContextFromUi(options: StackAppOptions, state: AppState): StackPapercutContext {
  const context = selectedPapercutRunContext(state)
  return {
    source: "tui",
    environmentName: options.config.environmentName,
    profile: activeProfileForPapercut(options),
    focusMode: state.focusMode,
    threadId: options.session.id,
    metaThreadId: options.session.metaThreadId ?? state.metaThreadManifest?.id,
    ...context,
  }
}

function selectedPapercutRunContext(state: AppState): Omit<StackPapercutContext, "source"> {
  const byFocus = selectedPapercutRunContextForFocus(state, state.focusMode)
  if (byFocus) return byFocus

  const activeRemote = state.remoteResearchSnapshot.jobs.find((run) => !isTerminalLikeStatus(run.state))
  if (activeRemote) return remoteRunPapercutContext(activeRemote, selectedRemoteOutput(state))

  const activeHosted = state.hostedOptimizerSnapshot.runs.find((run) => !isTerminalLikeStatus(run.status))
  if (activeHosted) return hostedOptimizerPapercutContext(state, activeHosted)

  const activeLocal = state.optimizerSnapshot.runs.find((run) => !isTerminalLikeStatus(run.status))
  if (activeLocal) return localOptimizerPapercutContext(activeLocal)

  const selectedRemote = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
  if (selectedRemote) return remoteRunPapercutContext(selectedRemote, selectedRemoteOutput(state))

  const selectedHosted = state.hostedOptimizerSnapshot.runs[state.selectedHostedOptimizerRunIndex]
  if (selectedHosted) return hostedOptimizerPapercutContext(state, selectedHosted)

  const selectedLocal = state.optimizerSnapshot.runs[state.selectedOptimizerRunIndex]
  if (selectedLocal) return localOptimizerPapercutContext(selectedLocal)

  const selectedFactory = state.remoteResearchSnapshot.factories[state.selectedRemoteFactoryIndex]
  if (selectedFactory) return factoryPapercutContext(selectedFactory)

  return {}
}

function selectedPapercutRunContextForFocus(
  state: AppState,
  focusMode: FocusMode,
): Omit<StackPapercutContext, "source"> | undefined {
  if (focusMode === "remote") {
    const run = state.remoteResearchSnapshot.jobs[state.selectedRemoteJobIndex]
    const factory = state.remoteResearchSnapshot.factories[state.selectedRemoteFactoryIndex]
    if (state.mediationTargetKind === "factory" && factory) return factoryPapercutContext(factory)
    if (run) return remoteRunPapercutContext(run, selectedRemoteOutput(state))
    if (factory) return factoryPapercutContext(factory)
  }
  if (focusMode === "hosted") {
    const run = state.hostedOptimizerSnapshot.runs[state.selectedHostedOptimizerRunIndex]
    if (run) return hostedOptimizerPapercutContext(state, run)
  }
  if (focusMode === "optimizers") {
    const run = state.optimizerSnapshot.runs[state.selectedOptimizerRunIndex]
    if (run) return localOptimizerPapercutContext(run)
  }
  return undefined
}

function remoteRunPapercutContext(
  run: RemoteSmrRunSummary,
  output?: RemoteOutputSelection,
): Omit<StackPapercutContext, "source"> {
  return {
    taskId: run.runbook,
    runId: run.runId,
    projectId: run.projectId,
    artifactId: output
      ? output.kind === "work-product"
        ? output.item.workProductId
        : output.item.artifactId
      : undefined,
    summary: `Operator papercut captured from Stack TUI. Context: remote SMR run ${run.runId}.`,
  }
}

function hostedOptimizerPapercutContext(
  state: AppState,
  run: HostedOptimizerRunSummary,
): Omit<StackPapercutContext, "source"> {
  return {
    taskId: run.algorithm,
    runId: run.runId,
    optimizerRunId: run.runId,
    projectId: run.projectId,
    artifactId: selectedHostedOptimizerArtifactName(state),
    summary: `Operator papercut captured from Stack TUI. Context: hosted optimizer run ${run.runId}.`,
  }
}

function localOptimizerPapercutContext(run: OptimizerRunSummary): Omit<StackPapercutContext, "source"> {
  return {
    taskId: run.configPath ? basename(run.configPath) : run.requestId,
    runId: run.runId,
    optimizerRunId: run.runId,
    summary: `Operator papercut captured from Stack TUI. Context: local optimizer run ${run.runId}.`,
  }
}

function factoryPapercutContext(factory: RemoteFactorySummary): Omit<StackPapercutContext, "source"> {
  return {
    taskId: factory.name,
    runId: factory.latestRunId,
    projectId: factory.latestProjectId ?? factory.canonicalProjectId,
    factoryId: factory.factoryId,
    summary: `Operator papercut captured from Stack TUI. Context: factory ${factory.factoryId}.`,
  }
}

function activeProfileForPapercut(options: StackAppOptions): string | undefined {
  try {
    return readStackProfile(options.config.stackDataRoot).active
  } catch {
    return undefined
  }
}

function isTerminalLikeStatus(status: string | undefined): boolean {
  const normalized = status?.trim().toLowerCase()
  if (!normalized) return false
  return new Set([
    "cancelled",
    "canceled",
    "complete",
    "completed",
    "done",
    "error",
    "failed",
    "finished",
    "stopped",
    "succeeded",
    "success",
    "terminal",
    "timed_out",
  ]).has(normalized)
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
    case "wake-factory":
      return context.factory
        ? await wakeRemoteFactoryDue(options.config, context.factory)
        : { ok: false, status: 0, message: "no factory selected" }
    case "pause-factory":
    case "resume-factory":
      return context.factory
        ? await executeRemoteFactoryAction(options.config, context.factory, action)
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
    case "wake-factory":
      if (!context.factory) return
      await recordTuiRuntimeLeverEvent({
        event_type: "lever.remote_factory.wake_requested",
        source: "lever.stack_tui",
        subject: { kind: "remote_factory", id: context.factory.factoryId },
        correlation: {
          factory_id: context.factory.factoryId,
          project_id: context.factory.canonicalProjectId ?? context.factory.latestProjectId,
        },
        payload: {
          environment: config.environmentName,
          api_base_url: config.environment.apiBaseUrl,
          action,
          dry_run: false,
          ok: context.result.ok,
          status: context.result.status,
          message: context.result.message,
          factory_name: context.factory.name,
        },
      })
      return
    case "pause-factory":
    case "resume-factory":
      if (!context.factory) return
      await recordTuiRuntimeLeverEvent({
        event_type: `lever.remote_factory.${action === "pause-factory" ? "paused" : "resumed"}` as `lever.${string}`,
        source: "lever.stack_tui",
        subject: { kind: "remote_factory", id: context.factory.factoryId },
        correlation: {
          factory_id: context.factory.factoryId,
          project_id: context.factory.canonicalProjectId ?? context.factory.latestProjectId,
        },
        payload: {
          environment: config.environmentName,
          api_base_url: config.environment.apiBaseUrl,
          action,
          ok: context.result.ok,
          status: context.result.status,
          message: context.result.message,
          factory_name: context.factory.name,
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


function remoteActionLabel(action: LiveActionKind): string {
  switch (action) {
    case "pause-run":
      return "pause selected run"
    case "resume-run":
      return "resume selected run"
    case "stop-run":
      return "stop selected run"
    case "preview-factory-wake":
      return "preview factory wake-due"
    case "wake-factory":
      return "wake selected factory"
    case "pause-factory":
      return "pause selected factory"
    case "resume-factory":
      return "resume selected factory"
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

function handleModelKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  const action = modelPickerActionForKey(key.name, options.config)
  if (action) {
    applyModelPickerAction(action, options, state, refresh)
    return
  }
  if (!isCycleKey(key)) return
  cycleModel(options.config, key.name === "k" || key.name === "left" ? -1 : 1)
  appendStackBlock(state.blocks, `model ${harnessModel(options.config)}`)
  persistStackConfig(options, state, refresh)
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
  if (state.monitorInputBuffer.length > 0) return false

  if (key.name === "p") {
    toggleRightPanelOps(state)
    refresh()
    return true
  }
  if (key.name === "W") {
    cycleMonitorWorkerTarget(state)
    refresh()
    return true
  }
  if (
    (key.name === "return" || key.name === "enter") &&
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
  const next = scrollTranscriptViewport(direction, state.monitorWatchScrollOffset, maxOffset)
  state.monitorWatchScrollOffset = next.offset
  state.monitorWatchScrollPinned = next.pinned
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
    deployments: [],
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
    deployments: [],
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
    const message = isGoalMode(state)
      ? "goal worker is running; keeping it active instead of starting a new thread"
      : "interrupt or wait for the current turn before starting a new thread"
    appendStackBlock(state.blocks, message)
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
  state.monitorFeedDeliveredEventIds = existingMonitorInterventionEventIds(state.metaEvents)
  state.queuedMessages = []
  state.gardenerWorkerQueue = []
  state.gardenerQueuedMessages = []
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

export function remoteResearchSnapshotFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
  fallback?: RemoteResearchSnapshot,
): RemoteResearchSnapshot | undefined {
  const remote = snapshot?.remote_synth
  if (!snapshot || !remote) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  const deployments = remote.deployments ?? []
  const deploymentCount = remote.deployment_count ?? deployments.length
  const sync = remoteSyncSnapshotFromRuntime(remote)
  const hasRemoteState =
    remote.runs.length > 0 ||
    remote.factories.length > 0 ||
    deployments.length > 0 ||
    Boolean(sync) ||
    remote.active_run_count > 0 ||
    remote.active_factory_count > 0 ||
    deploymentCount > 0
  if (!hasRemoteState) return undefined

  const fallbackRunsById = new Map((fallback?.jobs ?? []).map((run) => [run.runId, run]))
  const fallbackFactoriesById = new Map((fallback?.factories ?? []).map((factory) => [factory.factoryId, factory]))
  const fallbackDeploymentsById = new Map((fallback?.deployments ?? []).map((deployment) => [deployment.deploymentId, deployment]))
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
  const runtimeDeployments = deployments
    .slice()
    .sort(compareRuntimeDeploymentRecency)
    .map((deployment) => {
      const fallbackDeployment = fallbackDeploymentsById.get(deployment.deployment_id)
      return {
        ...fallbackDeployment,
        deploymentId: deployment.deployment_id,
        name: deployment.name,
        status: deployment.status ?? fallbackDeployment?.status,
        preflightStatus: deployment.preflight_status ?? fallbackDeployment?.preflightStatus,
        degradedReason: deployment.degraded_reason ?? fallbackDeployment?.degradedReason,
        projectId: deployment.project_id ?? fallbackDeployment?.projectId,
        factoryId: deployment.factory_id ?? fallbackDeployment?.factoryId,
        topology: deployment.topology ?? fallbackDeployment?.topology,
        substrate: deployment.substrate ?? fallbackDeployment?.substrate,
        updatedAt: deployment.updated_at ?? fallbackDeployment?.updatedAt,
        ready: deployment.ready ?? fallbackDeployment?.ready,
      }
    })

  return {
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    environmentName: runtimeEnvironment.environmentName,
    apiBaseUrl: runtimeEnvironment.apiBaseUrl,
    checkedAt: snapshot.updated_at,
    message: `runtime ${jobs.length} SMR runs, ${factories.length} factories, ${deploymentCount} deployments${sync ? `, ${remoteSyncSummaryLabel(sync)}` : ""}`,
    jobs,
    factories,
    deployments: runtimeDeployments,
    runDetails: fallback?.runDetails ?? {},
    hostedArtifacts: fallback?.hostedArtifacts ?? {},
    ...(sync ? { sync } : {}),
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

function compareRuntimeDeploymentRecency(
  left: NonNullable<StackdFactorySnapshot["remote_synth"]["deployments"]>[number],
  right: NonNullable<StackdFactorySnapshot["remote_synth"]["deployments"]>[number],
): number {
  const leftDegraded = Boolean(left.degraded_reason) || (left.ready === false)
  const rightDegraded = Boolean(right.degraded_reason) || (right.ready === false)
  if (leftDegraded !== rightDegraded) return leftDegraded ? -1 : 1
  return compareOptionalIsoDesc(left.updated_at, right.updated_at) || left.deployment_id.localeCompare(right.deployment_id)
}

function compareOptionalIsoDesc(left: string | null | undefined, right: string | null | undefined): number {
  const leftMs = left ? Date.parse(left) : 0
  const rightMs = right ? Date.parse(right) : 0
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0
  return safeRight - safeLeft
}

export function remoteProjectsPanelFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
): RemoteProjectsPanelSnapshot | undefined {
  const remote = snapshot?.remote_synth
  const projects = remote?.projects ?? []
  const runtimeRuns = remote?.runs ?? []
  const runtimeFactories = remote?.factories ?? []
  const runtimeDeployments = remote?.deployments ?? []
  const sync = remote ? remoteSyncSnapshotFromRuntime(remote) : undefined
  if (!remote || (projects.length === 0 && runtimeDeployments.length === 0 && !sync)) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  const runsById = new Map(runtimeRuns.map((run) => [run.run_id, run]))
  const factoriesById = new Map(runtimeFactories.map((factory) => [factory.factory_id, factory]))
  const deploymentRows = runtimeDeployments.slice().sort(compareRuntimeDeploymentRecency).map((deployment) => ({
    deploymentId: deployment.deployment_id,
    name: deployment.name,
    status: deployment.status ?? undefined,
    preflightStatus: deployment.preflight_status ?? undefined,
    degradedReason: deployment.degraded_reason ?? undefined,
    projectId: deployment.project_id ?? undefined,
    factoryId: deployment.factory_id ?? undefined,
    topology: deployment.topology ?? undefined,
    substrate: deployment.substrate ?? undefined,
    updatedAt: deployment.updated_at ?? undefined,
    ready: deployment.ready ?? undefined,
  }))
  return {
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    environmentName: runtimeEnvironment.environmentName,
    apiBaseUrl: runtimeEnvironment.apiBaseUrl,
    checkedAt: snapshot.updated_at,
    message: `runtime ${projects.length} projects, ${deploymentRows.length} deployments${sync ? `, ${remoteSyncSummaryLabel(sync)}` : ""}`,
    ...(sync ? { sync } : {}),
    deployments: deploymentRows,
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
      const projectDeployments = deploymentRows.filter((deployment) => deployment.projectId === project.project_id)
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
        deployments: projectDeployments,
      }
    }),
  }
}

function remoteSyncSnapshotFromRuntime(
  remote: StackdFactorySnapshot["remote_synth"],
): RemoteSyncSnapshot | undefined {
  const pendingPush = remote.pending_push ?? []
  const pendingPull = remote.pending_pull ?? []
  const recentRemoteGardenerPasses = remote.recent_remote_gardener_passes ?? []
  const linkedSmrRuns = remote.linked_smr_runs ?? []
  const recentRunEvents = remote.recent_run_events ?? []
  if (
    pendingPush.length === 0 &&
    pendingPull.length === 0 &&
    recentRemoteGardenerPasses.length === 0 &&
    linkedSmrRuns.length === 0 &&
    recentRunEvents.length === 0
  ) {
    return undefined
  }
  return {
    pendingPush: pendingPush.map((item) => ({
      eventId: item.event_id,
      observedAt: item.observed_at,
      direction: item.direction,
      intent: item.intent,
      subjectKind: item.subject_kind,
      subjectId: item.subject_id,
      projectId: item.project_id ?? undefined,
      runId: item.run_id ?? undefined,
      factoryId: item.factory_id ?? undefined,
      deploymentId: item.deployment_id ?? undefined,
      metaThreadId: item.meta_thread_id ?? undefined,
      threadId: item.thread_id ?? undefined,
      actorRole: item.actor_role ?? undefined,
      actorId: item.actor_id ?? undefined,
      note: item.note ?? undefined,
    })),
    pendingPull: pendingPull.map((item) => ({
      eventId: item.event_id,
      observedAt: item.observed_at,
      direction: item.direction,
      intent: item.intent,
      subjectKind: item.subject_kind,
      subjectId: item.subject_id,
      projectId: item.project_id ?? undefined,
      runId: item.run_id ?? undefined,
      factoryId: item.factory_id ?? undefined,
      deploymentId: item.deployment_id ?? undefined,
      metaThreadId: item.meta_thread_id ?? undefined,
      threadId: item.thread_id ?? undefined,
      actorRole: item.actor_role ?? undefined,
      actorId: item.actor_id ?? undefined,
      note: item.note ?? undefined,
    })),
    recentRemoteGardenerPasses: recentRemoteGardenerPasses.map((item) => ({
      eventId: item.event_id,
      observedAt: item.observed_at,
      subjectKind: item.subject_kind,
      subjectId: item.subject_id,
      projectId: item.project_id ?? undefined,
      runId: item.run_id ?? undefined,
      factoryId: item.factory_id ?? undefined,
      deploymentId: item.deployment_id ?? undefined,
      metaThreadId: item.meta_thread_id ?? undefined,
      threadId: item.thread_id ?? undefined,
      actorRole: item.actor_role ?? undefined,
      actorId: item.actor_id ?? undefined,
      narration: item.narration ?? undefined,
      nextAction: item.next_action ?? undefined,
      runtimeStatus: item.runtime_status ?? undefined,
      authStatus: item.auth_status ?? undefined,
    })),
    linkedSmrRuns: linkedSmrRuns.map((item) => ({
      eventId: item.event_id,
      observedAt: item.observed_at,
      metaThreadId: item.meta_thread_id ?? undefined,
      threadId: item.thread_id ?? undefined,
      projectId: item.project_id ?? undefined,
      runId: item.run_id,
      factoryId: item.factory_id ?? undefined,
      deploymentId: item.deployment_id ?? undefined,
      bindingId: item.binding_id ?? undefined,
      objective: item.objective ?? undefined,
      remoteStatus: item.remote_status ?? undefined,
      actorRole: item.actor_role ?? undefined,
      actorId: item.actor_id ?? undefined,
    })),
    recentRunEvents: recentRunEvents.map((item) => ({
      eventId: item.event_id,
      observedAt: item.observed_at,
      messageId: item.message_id,
      projectId: item.project_id ?? undefined,
      runId: item.run_id,
      status: item.status ?? undefined,
      mode: item.mode ?? undefined,
      sender: item.sender ?? undefined,
      target: item.target ?? undefined,
      action: item.action ?? undefined,
      body: item.body ?? undefined,
      createdAt: item.created_at ?? undefined,
    })),
  }
}

function remoteSyncSummaryLabel(sync: RemoteSyncSnapshot): string {
  const parts = []
  if (sync.pendingPush.length > 0) parts.push(`push ${sync.pendingPush.length}`)
  if (sync.pendingPull.length > 0) parts.push(`pull ${sync.pendingPull.length}`)
  if (sync.linkedSmrRuns.length > 0) parts.push(`bind ${sync.linkedSmrRuns.length}`)
  if (sync.recentRemoteGardenerPasses.length > 0) parts.push(`pass ${sync.recentRemoteGardenerPasses.length}`)
  if (sync.recentRunEvents.length > 0) parts.push(`events ${sync.recentRunEvents.length}`)
  return parts.length > 0 ? `sync ${parts.join("/")}` : "sync clear"
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
    syncLightsThreadViewFromDisk(options, state)
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
      await refreshMetaThreadGoal(options, state)
      await refreshAgentContextFromSession(options, state, refresh, (limits) => {
        void observeCodexAuthState(options.config, options.session.id, limits, state)
      })
      await hydrateTranscriptFromRollout(options, state)
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

/**
 * Replaces the visible transcript with the real Codex thread, read from its rollout on disk. The
 * local session-log turns are an incomplete shadow (often empty for workers driven elsewhere), so
 * on resume the chat must be a view over the canonical thread, not that shadow. No-op when the
 * thread has no resolvable rollout (e.g. exec-mode threads) — the local render is kept in that case.
 */
async function hydrateTranscriptFromRollout(options: StackAppOptions, state: AppState): Promise<void> {
  const threadId = options.session.codexThreadId
  if (!threadId) return
  // Only app-server threads persist a rollout jsonl; exec/acp-mode threads legitimately have
  // none, so for those a missing rollout is expected — keep the local render. For a rollout-backed
  // (app-server) thread, a missing/unreadable rollout on resume is a real defect: surface it in
  // the transcript instead of silently rendering an empty chat.
  if (state.codexTransport === "app-server") {
    const rollout = await readRolloutTranscriptWithRetry(threadId)
    if (rollout && rollout.blocks.length > 0) {
      state.blocks = rollout.blocks
      state.toolLogs = rollout.tools
      state.subagentLogs = rollout.subagents
      state.selectedToolIndex = clampIndex(rollout.tools.length - 1, rollout.tools.length)
      state.agentScrollOffset = 0
      return
    }
    if (state.blocks.length === 0) {
      appendStackBlock(
        state.blocks,
        `thread ${threadId.slice(0, 8)} · no transcript yet — send a prompt to start`,
      )
    }
    return
  }
  const rollout = await readRolloutTranscript(threadId)
  if (!rollout || rollout.blocks.length === 0) return
  state.blocks = rollout.blocks
  state.toolLogs = rollout.tools
  state.subagentLogs = rollout.subagents
  state.selectedToolIndex = clampIndex(rollout.tools.length - 1, rollout.tools.length)
  state.agentScrollOffset = 0
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

function workerPanelViewFromCheckpoint(checkpoint?: StackResumeCheckpoint): WorkerPanelView {
  const saved = checkpoint?.workerPanelView
  if (saved === "goal" || saved === "chat") return saved
  if (saved === "status") return "chat"
  if (checkpoint?.goalShutterWorkerPeek) return "chat"
  return "chat"
}

function applyGoalUiAfterSessionResume(
  state: AppState,
  checkpoint?: StackResumeCheckpoint,
  _session?: StackLocalSession,
): void {
  if (!showWorkerGoalTabs(state, state.metaEvents)) {
    state.workerPanelView = "chat"
    state.goalShutterSidecarView = "events"
    state.goalShutterSidecarThreadScrollOffset = 0
    state.goalShutterSidecarThreadScrollPinned = true
    return
  }
  state.workerPanelView = workerPanelViewFromCheckpoint(checkpoint)
  state.goalShutterSidecarView =
    checkpoint?.goalShutterSidecarView === "thread" ? "thread" : "events"
  state.goalShutterSidecarThreadScrollOffset = 0
  state.goalShutterSidecarThreadScrollPinned = true
  state.goalShutterScrollOffset = 0
  state.goalShutterScrollPinned = true
  state.monitorPanelMode = "chat"
  if (checkpoint?.focusMode === "agent" || checkpoint?.focusMode === "monitor" || checkpoint?.focusMode === "goal") {
    state.focusMode = checkpoint.focusMode
  } else {
    state.focusMode = "agent"
  }
  state.talkToMonitor = state.focusMode === "monitor"
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
  // Scope the goal to the resumed thread's OWN metathread. Without this the previously
  // foregrounded thread's goal leaks onto the resumed thread — e.g. resuming the gardener showed
  // the worker's goal. resumeManifest is the launch-time checkpoint, so it only applies to the
  // thread it actually belongs to; every other thread reloads its own manifest (or none).
  state.metaThreadManifest = undefined
  state.goalContext = emptyGoalContext()
  if (options.resumeManifest && options.resumeManifest.id === options.session.metaThreadId) {
    state.metaThreadManifest = options.resumeManifest
    state.goalContext = mergeMetaThreadGoalContext(state.goalContext, options.resumeManifest)
  } else {
    await refreshMetaThreadGoal(options, state)
  }
  restoreHarnessFromSession(options, state)
  const backendSessionId =
    harnessBackendSessionId(checkpoint) ?? options.session.codexThreadId
  if (
    !isCursorHarness(options.config) &&
    backendSessionId &&
    checkpoint?.codexTransport === "exec" &&
    resolveCodexTransport() === "app-server"
  ) {
    state.codexTransport = "app-server"
  }
  await openHarnessSession(options, state, codexSessionHandle, backendSessionId, { probe: true })
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
  await hydrateTranscriptFromRollout(options, state)
  state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
  refreshMetaEvents()
  state.monitorSnapshot = refreshMonitorSnapshot(options.config.stackDataRoot, options.session.id)
  syncMonitorRightPanel(state)
  await refreshThreadGoalStatus(options, state)
  applyGoalUiAfterSessionResume(state, checkpoint, options.session)
  if (checkpoint) {
    applyStackCliResumeUi(options, state, options.session.id)
  }
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

function shouldContinueInterruptedTurnAfterResume(
  checkpoint: StackResumeCheckpoint | undefined,
  state: AppState,
): boolean {
  if (!checkpoint) return false
  if (state.status !== "idle") return false
  const explicitInterruptedTurn =
    checkpoint.resumeIntent?.action === "continue_interrupted_turn" &&
    checkpoint.workerStatus === "running"
  const legacyActiveGoalCheckpoint =
    checkpoint.workerStatus === undefined &&
    checkpoint.metaThreadState?.phase === "goal_active"
  if (!explicitInterruptedTurn && !legacyActiveGoalCheckpoint) return false
  if (!isGoalMode(state)) return explicitInterruptedTurn
  const goal = activeGoalModeSnapshot(state)
  const status = (goal.status ?? "active").trim().toLowerCase()
  return status !== "paused" && status !== "done" && status !== "completed" && status !== "cleared"
}

function interruptedTurnResumePrompt(
  checkpoint: StackResumeCheckpoint | undefined,
  state: AppState,
): string {
  const goal = activeGoalModeSnapshot(state)
  const objective =
    checkpoint?.resumeIntent?.objective?.trim() ||
    checkpoint?.metaThreadState?.goalObjective?.trim() ||
    goal.objective?.trim()
  const lines = [
    "Continue the interrupted Stack worker turn after a Stack resume.",
    "Inspect the current worktree and runtime state before relying on prior transcript text.",
    "Continue the same thread; do not restart from scratch unless the current state proves that is necessary.",
  ]
  if (objective) {
    lines.push(`Active objective: ${objective}`)
    lines.push("Make concrete progress toward this objective and keep it active unless current evidence proves it is complete.")
  }
  return lines.join("\n")
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
      workerPanelView: state.workerPanelView,
      focusMode: state.focusMode,
      displayName: options.session.displayName,
      workerStatus: state.status,
      resumeIntent: state.status === "running"
        ? {
            action: "continue_interrupted_turn",
            reason: "worker_running_on_exit",
            createdAt: new Date().toISOString(),
            objective:
              state.metaThreadManifest?.active_goal?.objective?.trim() ||
              state.goalContext.objective?.trim() ||
              undefined,
          }
        : undefined,
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
  state.agentChatPaused = false
  state.liveThinkingText = undefined
  state.liveThinkingId = undefined
  state.turnStartedAt = undefined
  // Goal state belongs to a specific thread/metathread; swapping the foreground session must not
  // carry the previous thread's goal across. Callers reload this session's own goal afterward.
  state.goalContext = emptyGoalContext()
  state.metaThreadManifest = undefined
  state.focusMode = "agent"
  state.workerPanelView = "chat"
  state.previousGoalExpandedKeys = new Set<string>()
  state.previousGoalSelectedIndex = 0
  state.goalShutterSidecarView = "events"
  state.goalShutterSidecarThreadScrollOffset = 0
  state.goalShutterSidecarThreadScrollPinned = true
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
  const renderWindow = turns.slice(-24)
  const omittedTurnCount = turns.length - renderWindow.length
  if (omittedTurnCount > 0) {
    appendStackBlock(blocks, `restored transcript: ${omittedTurnCount} older turns hidden from TUI render`)
  }
  for (const turn of renderWindow) {
    const rendered = blocksFromTurnStdout(
      boundedTextForRender(turn.prompt, "restored prompt"),
      boundedTurnStdoutForRender(turn.stdout),
    )
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

function syncRenderedTurnsFromSession(options: StackAppOptions, state: AppState): void {
  const rendered = renderTurns(options.session.turns)
  state.blocks = rendered.blocks
  state.toolLogs = rendered.tools
  state.subagentLogs = rendered.subagents
  state.selectedToolIndex = clampIndex(rendered.tools.length - 1, rendered.tools.length)
  state.lastUsage = options.session.turns.at(-1)?.usage ?? rendered.usage ?? state.lastUsage
}

async function yieldToRenderer(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function boundedTurnStdoutForRender(stdout: string): string {
  const maxChars = 180_000
  if (stdout.length <= maxChars) return stdout
  const bounded = stdout.slice(0, maxChars)
  const lastLineBreak = bounded.lastIndexOf("\n")
  const safePrefix = lastLineBreak > 0 ? bounded.slice(0, lastLineBreak) : bounded
  return [
    safePrefix,
    JSON.stringify({
      type: "stack",
      message: `restored turn output truncated for TUI render (${stdout.length - safePrefix.length} chars hidden)`,
    }),
  ].join("\n")
}

function boundedTextForRender(text: string, label: string): string {
  const maxChars = 40_000
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[${label} truncated for TUI render: ${text.length - maxChars} chars hidden]`
}

function trackActiveTurn(state: AppState, turn: Promise<void>): void {
  state.activeTurnPromise = turn
  void turn.finally(() => {
    if (state.activeTurnPromise === turn) state.activeTurnPromise = undefined
  })
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
  submitOpts?: { transcriptPrompt?: string; imagePaths?: string[] },
): Promise<void> {
  state.status = "running"
  state.agentChatPaused = false
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
        const postRunEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
        const { steers: newSteers, queued: newQueued } = undeliveredMonitorInterventions(
          postRunEvents,
          state.monitorFeedDeliveredEventIds,
        )
        for (const event of newQueued) {
          state.monitorFeedDeliveredEventIds.add(event.event_id)
          appendStackBlock(state.blocks, formatMonitorQueuedFeedText(event.payload as Record<string, unknown>))
          refreshIfScrollStable()
        }
        for (const event of newSteers) {
          state.monitorFeedDeliveredEventIds.add(event.event_id)
          const payload = event.payload as Record<string, unknown>
          const feedText = formatMonitorSteerFeedText(payload)
          const steerMessage = typeof payload.message === "string" ? payload.message.trim() : ""
          if (!steerMessage) {
            appendStackBlock(state.blocks, feedText)
            refreshIfScrollStable()
            continue
          }
          const session = codexSessionHandle.session
          if (!session) {
            appendStackBlock(state.blocks, `${feedText}\n(queued — worker offline)`)
            refreshIfScrollStable()
            continue
          }
          void session.trySteer(steerMessage).then((steered) => {
            if (steered) {
              state.lastSteerHint = "monitor-steer"
              appendStackBlock(state.blocks, feedText)
            } else {
              session.enqueue(steerMessage)
              state.queuedMessages = [...state.queuedMessages, steerMessage]
              state.lastSteerHint = `queued (${state.queuedMessages.length})`
              appendStackBlock(state.blocks, `${feedText}\n(queued for next turn)`)
            }
            refreshIfScrollStable()
          })
        }
        // C4 — pause_before_action: honor an unanswered monitor.worker_pause_requested receipt by
        // interrupting the in-flight worker turn, then answer with monitor.worker_paused.
        const pauseRequest = postRunEvents.filter((event) => event.type === "monitor.worker_pause_requested").at(-1)
        const pauseAnswered =
          pauseRequest &&
          postRunEvents.some(
            (event) =>
              event.type === "monitor.worker_paused" &&
              (event.payload as Record<string, unknown>).request_event_id === pauseRequest.event_id,
          )
        if (pauseRequest && !pauseAnswered && codexSessionHandle.session) {
          const pauseMessage =
            typeof pauseRequest.payload.message === "string" ? pauseRequest.payload.message : "risky action pending"
          void codexSessionHandle.session
            .interrupt()
            .catch(() => undefined)
            .finally(() => {
              try {
                appendThreadMetaEvent(options.config.stackDataRoot, {
                  event_id: stackEventId("monitor_worker_paused"),
                  type: "monitor.worker_paused",
                  thread_id: options.session.id,
                  observed_at: new Date().toISOString(),
                  actor_id: "operator",
                  actor_role: "primary",
                  payload: {
                    request_event_id: pauseRequest.event_id,
                    reason: pauseMessage,
                    source: "tui",
                  },
                })
                state.metaEvents = readThreadMetaEvents(options.config.stackDataRoot, options.session.id)
              } catch {
                // receipt append is best-effort; the interrupt already landed
              }
              appendStackBlock(state.blocks, `monitor paused worker before risky action: ${pauseMessage}`)
              refreshIfScrollStable()
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
        goalContext: mergeMetaThreadGoalContext(state.goalContext, state.metaThreadManifest),
        wakeReason: triggerEvents.some((event) => event.type === "agent.tool.failed")
          ? "tool_failed"
          : triggerEvents.some((event) => event.type === "agent.error")
            ? "error"
          : "tool_completed",
        triggerEventIds: triggerEvents.map((event) => event.event_id),
      })
    },
  )

  const runOneTurn = async (turnPrompt: string, imagePaths: string[] = submitOpts?.imagePaths ?? []): Promise<StackCodexTurn> => {
    const goalContext = mergeMetaThreadGoalContext(state.goalContext, state.metaThreadManifest)
    const harnessSession = codexSessionHandle.session
    const parsedTurn = parseChannelInput(turnPrompt)
    const effectiveImagePaths = imagePaths.length > 0 ? imagePaths : parsedTurn.imagePaths
    const effectivePrompt = parsedTurn.text || parsedTurn.displayText
    if (harnessSession && state.codexTransport === "acp") {
      harnessSession.setOutputHandler(outputSink.write)
      return harnessSession.runTurn({
        config: options.config,
        userPrompt: effectivePrompt,
        selectedFiles,
        priorTurns: options.session.turns,
        goalContext,
        imagePaths: effectiveImagePaths,
      })
    }
    if (harnessSession && state.codexTransport === "app-server") {
      try {
        harnessSession.setOutputHandler(outputSink.write)
        return await runCodexAppServerTurn(
          {
            config: options.config,
            userPrompt: effectivePrompt,
            selectedFiles,
            priorTurns: options.session.turns,
            goalContext,
            imagePaths: effectiveImagePaths,
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
        prompt: effectivePrompt,
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
      userPrompt: effectivePrompt,
      selectedFiles,
      priorTurns: options.session.turns,
      goalContext,
      imagePaths: effectiveImagePaths,
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
    syncRenderedTurnsFromSession(options, state)
    refresh()
    await yieldToRenderer()
    if (codexSessionHandle.session?.codexThreadId) {
      options.session.codexThreadId = codexSessionHandle.session.codexThreadId
    }
    refreshSessionThroughput(state, options.session.turns)
    await monitorQueue.catch(() => undefined)
    if (!isGardenerSession(options, state) && !tuiSmokeAutomationDisabled()) {
      state.monitorSnapshot = await runMonitorAfterTurn({
        config: options.config,
        session: options.session,
        turn,
        agentContext: state.agentContext,
        goalContext: mergeMetaThreadGoalContext(state.goalContext, state.metaThreadManifest),
      })
    }
    if (!tuiSmokeAutomationDisabled()) {
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
    }
    refreshMetaEvents()
    if (!tuiSmokeAutomationDisabled()) {
      void refreshGardenerMaintenance(options, state, "turn_completed")
    }

    while (!state.abortTurnLoop && codexSessionHandle.session && codexSessionHandle.session.queueLength > 0) {
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
      syncRenderedTurnsFromSession(options, state)
      refresh()
      await yieldToRenderer()
      refreshSessionThroughput(state, options.session.turns)
      await monitorQueue.catch(() => undefined)
      if (!isGardenerSession(options, state) && !tuiSmokeAutomationDisabled()) {
        state.monitorSnapshot = await runMonitorAfterTurn({
          config: options.config,
          session: options.session,
          turn,
          agentContext: state.agentContext,
          goalContext: mergeMetaThreadGoalContext(state.goalContext, state.metaThreadManifest),
        })
      }
      if (!tuiSmokeAutomationDisabled()) {
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
      }
      refreshMetaEvents()
    }

    while (!state.abortTurnLoop && state.gardenerWorkerQueue.length > 0) {
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
      syncRenderedTurnsFromSession(options, state)
      refresh()
      await yieldToRenderer()
      refreshSessionThroughput(state, options.session.turns)
      await monitorQueue.catch(() => undefined)
      if (!tuiSmokeAutomationDisabled()) {
        state.monitorSnapshot = await runMonitorAfterTurn({
          config: options.config,
          session: options.session,
          turn,
          agentContext: state.agentContext,
          goalContext: mergeMetaThreadGoalContext(state.goalContext, state.metaThreadManifest),
        })
      }
      if (!tuiSmokeAutomationDisabled()) {
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
      }
      refreshMetaEvents()
    }

    state.status = turnExitIdle(turn.exitCode) ? "idle" : "error"
    state.agentChatPaused = false
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
    state.agentChatPaused = false
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
