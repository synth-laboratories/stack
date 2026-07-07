#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, resolve } from "node:path"
import {
  environmentAuthStatus,
  harnessModel,
  harnessSessionCommand,
  loadConfig,
  setStackEnvironment,
  type StackConfig,
  type StackEnvironmentName,
} from "../config.js"
import {
  discoverStackSkills,
  pushSkillContext,
  readStackSkill,
  searchStackSkills,
  skillToJson,
} from "../codex/skills.js"
import {
  discoverStackGuidance,
  guidanceToJson,
  readStackGuidance,
  searchStackGuidance,
  type StackGuidanceScope,
  type StackStyleLayer,
} from "../codex/guidance.js"
import {
  guidanceEventToJson,
  listStackGuidanceEvents,
  recordStackGuidanceEvent,
  type StackGuidanceEventType,
  type StackGuidanceImpact,
} from "../codex/guidance-events.js"
import { appendThreadMetaEvent, readThreadMetaEvents, stackEventId } from "../thread-events.js"
import { emitOperatorSessionEvent, readActiveOperatorSession } from "../operator-session.js"
import { applyLightsThreadViewUpdate, readLightsThreadViewState } from "../lights-thread-view.js"
import { readMetaThreadManifest } from "../meta-thread-goal.js"
import {
  appendEffortProgress as appendStackEffortProgress,
  appendEffortResearchLog as appendStackEffortResearchLog,
  auditEffort as auditStackEffort,
  bindEffortMetaThread as bindStackEffortMetaThread,
  createEffort as createStackEffort,
  effortArtifactInventory as stackEffortArtifactInventory,
  effortPathRefs as stackEffortPathRefs,
  listEfforts as listStackEfforts,
  listEffortTemplates as listStackEffortTemplates,
  readEffort as readStackEffort,
  readEffortAcceptancePacket as readStackEffortAcceptancePacket,
  readEffortActivityTail as readStackEffortActivityTail,
  readEffortBenchmarkSummaries as readStackEffortBenchmarkSummaries,
  readEffortBlockerTail as readStackEffortBlockerTail,
  readEffortOpenBlockerTail as readStackEffortOpenBlockerTail,
  readEffortOptimizerCandidateSummaries as readStackEffortOptimizerCandidateSummaries,
  readEffortProgressTail as readStackEffortProgressTail,
  readEffortReleaseArtifactSummaries as readStackEffortReleaseArtifactSummaries,
  readEffortRemainingWork as readStackEffortRemainingWork,
  readEffortRunEvidenceSummaries as readStackEffortRunEvidenceSummaries,
  refreshEffortReceiptDigests as refreshStackEffortReceiptDigests,
  recordEffortAcceptance as recordStackEffortAcceptance,
  recordEffortArtifact as recordStackEffortArtifact,
  recordEffortBenchmark as recordStackEffortBenchmark,
  recordEffortBlocker as recordStackEffortBlocker,
  recordEffortCapture as recordStackEffortCapture,
  recordEffortFinding as recordStackEffortFinding,
  recordEffortIdea as recordStackEffortIdea,
  recordEffortNote as recordStackEffortNote,
  recordEffortOptimizerCandidate as recordStackEffortOptimizerCandidate,
  recordEffortReleaseArtifact as recordStackEffortReleaseArtifact,
  recordEffortRepo as recordStackEffortRepo,
  recordEffortRunEvidence as recordStackEffortRunEvidence,
  recordEffortSession as recordStackEffortSession,
  resolveEffortBlocker as resolveStackEffortBlocker,
  EFFORT_LAUNCH_CAPABILITIES,
  parseEffortLaunchCapability,
  STACK_EFFORT_CAPTURE_KINDS,
  STACK_EFFORT_FINDING_KINDS,
  STACK_EFFORT_IDEA_ORIGINS,
  STACK_EFFORT_NOTE_KINDS,
  STACK_EFFORT_STATUSES,
  updateEffortRefs as updateStackEffortRefs,
  updateEffortStatus as updateStackEffortStatus,
  writeEffortEngineeringPacket as writeStackEffortEngineeringPacket,
  writeEffortHandoff as writeStackEffortHandoff,
  type StackEffort,
  type StackEffortCaptureKind,
  type StackEffortFindingKind,
  type StackEffortFindingSourceReceipt,
  type StackEffortIdeaOrigin,
  type StackEffortNoteKind,
  type StackEffortStatus,
} from "../effort.js"
import {
  artifactGalleryUrl,
  artifactLocalUrl,
  artifactsRoot as stackArtifactsRoot,
  lintArtifact as lintStackArtifact,
  publishArtifact as publishStackArtifact,
  readArtifactStatus as readStackArtifactStatus,
  readLatestArtifacts as readLatestStackArtifacts,
  shareArtifact as shareStackArtifact,
  writeArtifactPage as writeStackArtifactPage,
} from "../artifacts.js"
import {
  EFFORT_LAUNCH_KINDS,
  launchEffortRun as launchStackEffortRun,
  type EffortLaunchKind,
} from "../effort-launch.js"
import {
  readTaggedEffortSlug,
  writeTaggedEffortSlug,
  taggedEffortDisplayLabel,
} from "../tagged-effort.js"
import { isUiPanelId, panelOpenAllowed, panelViewAllowed, UI_PANEL_IDS, UI_PANELS, type UiPanelOpener } from "../ui/vocabulary.js"
import {
  stackdExport,
  stackdAssemblyCreate,
  stackdAssemblyGet,
  stackdAssemblyList,
  stackdAssemblyTransition,
  stackdBindMetaThreadRemoteSmrRun,
  stackdAssertMetaThreadEffortRefRoute,
  stackdCreateMetaThread,
  stackdCreateWorkerMetaThread,
  stackdListMemories,
  stackdMemoryKinds,
  stackdMissingEffortRefRouteMessage,
  stackdMetaThread,
  stackdMetaThreads,
  stackdRecordMemory,
  stackdRuntimeAppendEvent,
  stackdRuntimeEvents,
  stackdRuntimeFactory,
  stackdRuntimeTick,
  stackdTelemetryStatus,
  stackdThread,
  stackdThreads,
  stackdTrace,
  stackdUpdateMetaThreadEffortRef,
  stackdUpdateMetaThreadGoal,
  stackdUpdateMetaThreadLifecycle,
  stackdUpdateMetaThreadTitle,
  stackdWorkerContinue,
  stackdWorkerPause,
  stackdWorkerRun,
  stackdWorkerRunStatus,
  type StackdAssemblyBindings,
  type StackdAssemblyPreset,
  type StackdAssemblyTransitionRequest,
  type StackdFactorySnapshot,
  type StackdMemorySeverity,
  type StackdMemorySource,
  type StackdMetaThreadManifest,
  type StackdMetaThreadLifecycleStatus,
  type StackdRuntimeEventAppendRequest,
  type StackdRuntimeFactoryResponse,
} from "../client/stackd.js"
import { projectLogDocumentToVictoriaLogs, queryStackLogs } from "../observability/victorialogs.js"
import { readCrashReportsView } from "../crash-reports.js"
import { launchLocalGepaRun, readOptimizerSnapshot } from "../local/optimizers.js"
import { loadGardenerConfig } from "../gardener-config.js"
import {
  claimRemoteLaunchPromo,
  createRemoteFactory,
  createRemoteLaunch,
  createRemoteRunnableProject,
  decideRemoteRunApproval,
  downloadRemoteOutput,
  executeRemoteFactoryAction,
  executeRemoteRunAction,
  getRemoteLaunch,
  getRemoteLaunchPromoStatus,
  listRemoteRunApprovals,
  listRemoteRunQuestions,
  openUrlInSystemBrowser,
  previewRemoteOutput,
  previewSavedRemoteDownload,
  readRemoteDownloadHistory,
  respondRemoteRunQuestion,
  sendRemoteFactoryMessage,
  sendRemoteRunMessage,
  terminateRemoteLaunch,
  uploadRemoteRunFile,
  wakeRemoteFactoryDue,
  type RemoteActionResult,
  type RemoteDownloadRecord,
  type RemoteFactoryCreateRequest,
  type RemoteOutputSelection,
  type RemoteProjectCreateRequest,
} from "../remote/actions.js"
import {
  auditOnlineReflexionReceipt,
  auditOnlineReflexionReceiptSet,
  buildOnlineReflexionEvidencePacket,
  cancelHostedOptimizerRun,
  downloadHostedOptimizerArtifact,
  previewHostedOptimizerArtifact,
  submitHostedGepaRun,
  submitHostedOptimizerRun,
  type HostedGepaTunnelProvider,
} from "../remote/optimizers.js"
import { readHostedOptimizerSnapshot } from "../remote/optimizers.js"
import {
  ROUND_TRIP_ARTIFACT_KINDS,
  applyRoundTripArtifact,
  isRoundTripArtifactKind,
  pullRoundTripArtifact,
  pushRoundTripArtifact,
  readRoundTripPullReceipt,
  type RoundTripApplyMode,
  type RoundTripSourceKind,
} from "../roundtrip.js"
import {
  deployContainerPoolRuntimeImage,
  executeContainerPoolRollout,
  readContainerPoolHealth,
  readContainerPools,
  type ContainerPoolRuntimeImageReleaseRequest,
} from "../remote/containers.js"
import { readRemoteInferenceCatalog } from "../remote/inference.js"
import { readRemoteInferenceUsage } from "../remote/inference-usage.js"
import {
  headUrlStatus,
  readHostedArtifacts,
  readRemoteResearchSnapshot,
  readRemoteProjectsPanelSnapshot,
  readRemoteRunDetail,
  readRunHostedArtifactStatus,
  type HostedArtifactStatus,
  type HostedArtifactSummary,
  type RemoteFactorySummary,
  type RemoteRunDetail,
  type RemoteSmrRunSummary,
} from "../remote/research.js"
import { emitFeatureUsed } from "../telemetry/funnel.js"
import { STACK_MCP_SERVER_NAME, printStackVersion, stackVersion, wantsVersionFlag } from "../version.js"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }
type RpcId = string | number | null
type Framing = "content-length" | "jsonl"
type StackBridgeMode = "local" | "remote" | "all"

type ToolDefinition = {
  name: string
  description: string
  inputSchema: JsonObject
  handler: (args: JsonObject) => Promise<JsonValue>
}

type ParsedMessage = {
  payload: JsonObject
  framing: Framing
}

const PROTOCOL_VERSION = "2024-11-05"
const SERVER_NAME = STACK_MCP_SERVER_NAME
const MCP_TOOL_ALLOW_ENV = "STACK_MCP_TOOL_ALLOW"
const MCP_TOOL_DENY_ENV = "STACK_MCP_TOOL_DENY"
const MCP_TOOL_ALLOWED_TOOLS_ENV = "STACK_MCP_ALLOWED_TOOLS"
const MCP_TOOL_DENIED_TOOLS_ENV = "STACK_MCP_DENIED_TOOLS"

type McpToolFilter = {
  allow?: Set<string>
  deny: Set<string>
}

export class StackMcpServer {
  private readonly tools: Map<string, ToolDefinition>
  private httpMode = false

  constructor(private readonly appRoot: string) {
    const filter = mcpToolFilterFromEnv()
    this.tools = new Map(
      buildTools(this)
        .filter((tool) => mcpToolAllowed(tool.name, filter))
        .map((tool) => [tool.name, tool]),
    )
  }

  async handleJsonRpc(request: JsonObject): Promise<JsonObject | undefined> {
    return this.handleMessage({ payload: request, framing: "jsonl" })
  }

  async serveHttp(options: {
    bind?: string
    port: number
    path?: string
  }): Promise<{ url: string; stop: () => void }> {
    this.httpMode = true
    const bind = options.bind ?? "127.0.0.1"
    const path = normalizeMcpHttpPath(options.path ?? "/mcp")
    let messageChain = Promise.resolve()

    const server = Bun.serve({
      hostname: bind,
      port: options.port,
      fetch: (req) => {
        const url = new URL(req.url)
        if (!url.pathname.startsWith(path)) {
          return new Response("Not Found", { status: 404 })
        }
        return handleHttpRequest(this.appRoot, this, req, path, () => messageChain, (next) => {
          messageChain = next
        })
      },
    })

    const url = `http://${bind}:${server.port}${path}`
    return {
      url,
      stop: () => server.stop(),
    }
  }

  async serveStdio(): Promise<void> {
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let chain = Promise.resolve()
    process.stdin.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (true) {
        const parsed = readMessage(buffer)
        if (!parsed) break
        buffer = parsed.remaining
        const message = parsed.message
        chain = chain.then(async () => {
          const response = await this.handleMessage(message)
          if (response) writeMessage(response, message.framing)
        })
      }
    })
  }

  async callTool(name: string, args: JsonObject = {}): Promise<JsonValue> {
    const tool = this.tools.get(name)
    if (!tool) throw new RpcError(-32601, `Unknown tool: ${name}`)
    return await tool.handler(args)
  }

  toolPayload(): JsonObject[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  }

  private async config(args: JsonObject): Promise<StackConfig> {
    const config = await loadConfig(this.appRoot)
    const environment = optionalString(args, "environment")
    if (environment) setStackEnvironment(config, readEnvironmentName(environment))
    return config
  }

  async sidecarPauseForRestart(args: JsonObject): Promise<JsonObject> {
    const config = await this.config(args)
    const threadId = requiredString(args, "thread_id")
    const actorId = optionalString(args, "actor_id") ?? "monitor"
    const reason = optionalString(args, "reason") ?? "sidecar finished current monitoring round"
    const nextWakeOn = optionalStringArray(args, "next_wake_on") ?? []
    const event = {
      event_id: stackEventId("monitor_pause_for_restart"),
      type: "monitor.pause_for_restart",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor" as const,
      payload: {
        reason,
        next_wake_on: nextWakeOn.length > 0 ? nextWakeOn : ["worker_event", "operator_message", "goal_change"],
        source: "sidecar_codex_tool",
      },
    }
    const path = appendThreadMetaEvent(config.stackDataRoot, event)
    return {
      ok: true,
      event_id: event.event_id,
      thread_id: threadId,
      actor_id: actorId,
      path,
    }
  }

  async monitorGoalStatus(args: JsonObject): Promise<JsonObject> {
    const config = await this.config(args)
    const threadId = requiredString(args, "thread_id")
    const actorId = optionalString(args, "actor_id") ?? "monitor"
    const status = requiredString(args, "status")
    const note = optionalString(args, "note") ?? ""
    const headline = optionalString(args, "headline") ?? ""
    const forHuman = optionalBoolean(args, "for_human") ?? false
    const metric =
      args.metric && typeof args.metric === "object" && !Array.isArray(args.metric)
        ? (args.metric as JsonObject)
        : undefined
    const evidence = optionalStringArray(args, "evidence_event_ids") ?? []
    const event = {
      event_id: stackEventId("monitor_goal_status"),
      type: "monitor.goal_status",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: actorId,
      actor_role: "monitor" as const,
      payload: {
        status,
        headline,
        note,
        for_human: forHuman,
        metric: metric ?? null,
        evidence_event_ids: evidence,
        source: "sidecar_codex_tool",
      },
    }
    const path = appendThreadMetaEvent(config.stackDataRoot, event)
    return { ok: true, event_id: event.event_id, status, thread_id: threadId, path }
  }

  // B1 — agents pull UI in front of the operator only at review moments. Authority
  // comes from the vocabulary registry; every open is an audited ui.panel_opened.
  async uiOpenPanel(args: JsonObject): Promise<JsonObject> {
    const config = await this.config(args)
    const rawThreadId = requiredString(args, "thread_id")
    const panel = requiredString(args, "panel")
    if (!isUiPanelId(panel)) {
      throw new RpcError(-32602, `unknown panel '${panel}' — registered panels: ${UI_PANEL_IDS.join(", ")}`)
    }
    const threadId =
      panel === "lights" ? await resolveLightsThreadTargetId(config.stackDataRoot, rawThreadId) : rawThreadId
    const openedBy = (optionalString(args, "actor_role") ?? "operator") as UiPanelOpener
    if (!["monitor", "gardener", "remote_gardener", "operator"].includes(openedBy)) {
      throw new RpcError(-32602, `actor_role must be monitor, gardener, remote_gardener, or operator; got '${openedBy}'`)
    }
    if (!panelOpenAllowed(panel, openedBy)) {
      return { ok: false, status: 0, message: `panel '${panel}' is not openable by ${openedBy}` }
    }
    const view = optionalString(args, "view")
    if (view && !panelViewAllowed(panel, view)) {
      throw new RpcError(-32602, `panel '${panel}' has no view '${view}'`)
    }
    const reason = requiredString(args, "reason")
    const event = {
      event_id: stackEventId("ui_panel_opened"),
      type: "ui.panel_opened",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: optionalString(args, "actor_id") ?? openedBy,
      actor_role: openedBy === "operator" ? ("primary" as const) : openedBy,
      payload: {
        panel,
        view: view ?? null,
        opened_by: openedBy,
        reason,
        source: "stack_ui_tool",
      },
    }
    const path = appendThreadMetaEvent(config.stackDataRoot, event)
    const activeSession = readActiveOperatorSession(config.stackDataRoot)
    if (activeSession) {
      emitOperatorSessionEvent(config.stackDataRoot, activeSession, {
        type: "operator_session.panel_opened",
        thread_id: threadId,
        payload: {
          panel,
          view: view ?? null,
          reason,
          source: "stack_ui_tool",
        },
      })
    }
    if (panel === "lights") {
      applyLightsThreadViewUpdate(
        config.stackDataRoot,
        readLightsThreadViewState(config.stackDataRoot),
        [threadId],
        true,
      )
    }
    return {
      ok: true,
      event_id: event.event_id,
      panel,
      view: view ?? null,
      thread_id: threadId,
      path,
      ...(activeSession ? { operator_session_id: activeSession.operator_session_id } : {}),
    }
  }

  // B2 — bounded close: monitor/gardener may close only panels they opened; the
  // operator (Esc or slash) closes anything.
  async uiClosePanel(args: JsonObject): Promise<JsonObject> {
    const config = await this.config(args)
    const threadId = requiredString(args, "thread_id")
    const panel = requiredString(args, "panel")
    if (!isUiPanelId(panel)) {
      throw new RpcError(-32602, `unknown panel '${panel}' — registered panels: ${UI_PANEL_IDS.join(", ")}`)
    }
    const closer = (optionalString(args, "actor_role") ?? "operator") as UiPanelOpener
    if (closer !== "operator") {
      const events = readThreadMetaEvents(config.stackDataRoot, threadId)
      let openPanel: { panel: string; openedBy: string } | undefined
      for (const event of events) {
        if (event.type === "ui.panel_opened") {
          const payload = event.payload as Record<string, unknown>
          openPanel = { panel: String(payload.panel ?? ""), openedBy: String(payload.opened_by ?? "operator") }
        } else if (event.type === "ui.panel_closed") {
          openPanel = undefined
        }
      }
      if (!openPanel || openPanel.panel !== panel) {
        return { ok: false, status: 0, message: `panel '${panel}' is not open` }
      }
      if (openPanel.openedBy !== closer) {
        return { ok: false, status: 0, message: `${closer} may only close panels it opened; '${panel}' was opened by ${openPanel.openedBy}` }
      }
    }
    const event = {
      event_id: stackEventId("ui_panel_closed"),
      type: "ui.panel_closed",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: optionalString(args, "actor_id") ?? closer,
      actor_role: closer === "operator" ? ("primary" as const) : closer,
      payload: {
        panel,
        closed_by: closer,
        reason: optionalString(args, "reason") ?? null,
        source: "stack_ui_tool",
      },
    }
    const path = appendThreadMetaEvent(config.stackDataRoot, event)
    return { ok: true, event_id: event.event_id, panel, thread_id: threadId, path }
  }

  async uiLightsThreadView(args: JsonObject): Promise<JsonObject> {
    const config = await this.config(args)
    const rawThreadId = requiredString(args, "thread_id")
    const threadId = await resolveLightsThreadTargetId(config.stackDataRoot, rawThreadId)
    const viewed = optionalBoolean(args, "viewed") ?? true
    const openedBy = (optionalString(args, "actor_role") ?? "operator") as UiPanelOpener
    if (!["monitor", "gardener", "remote_gardener", "operator"].includes(openedBy)) {
      throw new RpcError(-32602, `actor_role must be monitor, gardener, remote_gardener, or operator; got '${openedBy}'`)
    }
    const reason = optionalString(args, "reason") ?? (viewed ? "mark thread viewed in lights" : "mark thread unviewed in lights")
    const current = readLightsThreadViewState(config.stackDataRoot)
    const next = applyLightsThreadViewUpdate(config.stackDataRoot, current, [threadId], viewed)
    const panelEvent = viewed
      ? {
          event_id: stackEventId("ui_panel_opened"),
          type: "ui.panel_opened",
          thread_id: threadId,
          observed_at: new Date().toISOString(),
          actor_id: optionalString(args, "actor_id") ?? openedBy,
          actor_role: openedBy === "operator" ? ("primary" as const) : openedBy,
          payload: {
            panel: "lights",
            view: "threads",
            opened_by: openedBy,
            reason,
            source: "stack_lights_thread_view",
          },
        }
      : undefined
    const viewEvent = {
      event_id: stackEventId("ui_lights_thread_view"),
      type: "ui.lights_thread_view",
      thread_id: threadId,
      observed_at: new Date().toISOString(),
      actor_id: optionalString(args, "actor_id") ?? openedBy,
      actor_role: openedBy === "operator" ? ("primary" as const) : openedBy,
      payload: {
        target_thread_id: threadId,
        viewed,
        reason,
        source: "stack_lights_thread_view",
      },
    }
    const viewPath = appendThreadMetaEvent(config.stackDataRoot, viewEvent)
    const panelPath = panelEvent ? appendThreadMetaEvent(config.stackDataRoot, panelEvent) : undefined
    return {
      ok: true,
      thread_id: threadId,
      ...(rawThreadId !== threadId ? { resolved_from: rawThreadId } : {}),
      viewed,
      selected_thread_id: next.selectedThreadId ?? null,
      viewed_thread_ids: next.viewedThreadIds,
      view_event_path: viewPath,
      panel_event_path: panelPath ?? null,
    }
  }

  private async handleMessage(message: ParsedMessage): Promise<JsonObject | undefined> {
    const request = message.payload
    const method = readString(request.method)
    const id = readRpcId(request.id)
    try {
      if (method === "initialize") {
        return response(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name: SERVER_NAME, version: stackVersion(this.appRoot) },
          capabilities: { tools: {} },
        })
      }
      if (method === "ping") return response(id, {})
      if (method === "tools/list") return response(id, { tools: this.toolPayload() })
      if (method === "tools/call") {
        const params = asRecord(request.params)
        if (!params) throw new RpcError(-32602, "tools/call requires object params")
        const name = readString(params.name)
        if (!name) throw new RpcError(-32602, "tools/call requires string name")
        const argumentsValue = asRecord(params.arguments) ?? {}
        const result = await this.callTool(name, toJsonObject(argumentsValue))
        return response(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        })
      }
      if (method === "initialized" || method === "notifications/initialized") return undefined
      if (method === "shutdown") return response(id, {})
      if (method === "exit") {
        if (!this.httpMode) setTimeout(() => process.exit(0), 0)
        return undefined
      }
      throw new RpcError(-32601, `Unknown method: ${method ?? "<missing>"}`)
    } catch (error) {
      return errorResponse(id, error)
    }
  }

  async liveStatus(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const auth = environmentAuthStatus(config.environment)
    const [research, hosted] = await Promise.all([
      readRemoteResearchSnapshot(config),
      readHostedOptimizerSnapshot(config),
    ])
    return {
      environment: config.environmentName,
      apiBaseUrl: config.environment.apiBaseUrl,
      authEnv: config.environment.authEnv,
      auth,
      hasAuth: auth.hasAuth,
      remoteResearch: research,
      hostedOptimizers: hosted,
    } satisfies JsonObject
  }

  async listMetaThreads(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const lifecycle = optionalMetaThreadLifecycle(args, "lifecycle") ?? "live"
    const limit = optionalInteger(args, "limit") ?? 50
    const manifests = await stackdMetaThreads({ lifecycle })
    return toJsonValue({
      lifecycle,
      count: manifests.length,
      meta_threads: manifests.slice(0, Math.max(1, Math.min(limit, 200))).map((manifest) =>
        metaThreadListItem(config.stackDataRoot, manifest)
      ),
    }) ?? null
  }

  async getMetaThread(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const metaThreadId = requiredString(args, "meta_thread_id")
    const manifest = await stackdMetaThread(metaThreadId)
    return toJsonValue({
      manifest,
      derived: metaThreadListItem(config.stackDataRoot, manifest),
    }) ?? null
  }

  async listEfforts(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const status = optionalEffortStatusOrAll(args, "status") ?? "all"
    const lookup = {
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }
    const efforts = listStackEfforts(lookup)
      .filter((effort) => status === "all" || effort.status === status)
      .map((summary) => {
        const effort = readStackEffort(lookup, summary.id)
        if (!effort) {
          return {
            ...summary,
            paths: null,
            latest_progress: "",
            latest_activity: null,
            latest_blocker: null,
            audit_status: "fail",
            audit_counts: {
              failures: 1,
              warnings: 0,
            },
            ref_counts: {
              meta_threads: summary.meta_thread_refs.length,
              repos: 0,
              external_refs: summary.refs.length,
            },
            artifact_counts: {
              total: 0,
              findings: 0,
              receipt_sidecars: 0,
            },
            has_handoff: false,
            has_acceptance_summary: false,
            latest_optimizer_candidate: null,
            latest_run_evidence: null,
            latest_benchmark: null,
            latest_release_artifact: null,
            remaining_work: {
              state: "untracked",
              summary: "effort folder or manifest missing",
              open_acceptance: [],
              out_of_scope: [],
              latest_blocker: null,
              next_actions: [],
            },
          }
        }
        const paths = stackEffortPathRefs(effort)
        const artifactInventory = stackEffortArtifactInventory(effort)
        const acceptancePacket = readStackEffortAcceptancePacket(effort) ?? null
        const progressTail = readStackEffortProgressTail(effort, 1)
        const activityTail = readStackEffortActivityTail(effort, 1)
        const blockerTail = readStackEffortOpenBlockerTail(effort, 1)
        const optimizerCandidates = readStackEffortOptimizerCandidateSummaries(effort, 1)
        const runEvidence = readStackEffortRunEvidenceSummaries(effort, 1)
        const benchmarks = readStackEffortBenchmarkSummaries(effort, 1)
        const releaseArtifacts = readStackEffortReleaseArtifactSummaries(effort, 1)
        const remainingWork = readStackEffortRemainingWork(effort)
        const audit = auditStackEffort(effort)
        return {
          ...summary,
          paths,
          latest_progress: progressTail[progressTail.length - 1] ?? "",
          latest_activity: activityTail[activityTail.length - 1] ?? null,
          latest_blocker: blockerTail[blockerTail.length - 1] ?? null,
          audit_status: audit.status,
          audit_counts: {
            failures: audit.checks.filter((check) => check.status === "fail").length,
            warnings: audit.checks.filter((check) => check.status === "warn").length,
          },
          ref_counts: {
            meta_threads: effort.manifest.links.meta_thread_refs.length,
            repos: effort.manifest.links.repo_refs.length,
            external_refs: effort.manifest.refs.length,
          },
          artifact_counts: {
            total: artifactInventory.counts.total,
            findings: Object.values(artifactInventory.counts.findings).reduce((sum, count) => sum + count, 0),
            receipt_sidecars: artifactInventory.counts.receipt_sidecars,
          },
          has_handoff: existsSync(join(effort.folder_path, "HANDOFF.md")),
          has_acceptance_summary: Boolean(paths.acceptance_summary),
          acceptance_packet: acceptancePacket,
          latest_optimizer_candidate: optimizerCandidates[optimizerCandidates.length - 1] ?? null,
          latest_run_evidence: runEvidence[runEvidence.length - 1] ?? null,
          latest_benchmark: benchmarks[benchmarks.length - 1] ?? null,
          latest_release_artifact: releaseArtifacts[releaseArtifacts.length - 1] ?? null,
          remaining_work: remainingWork,
        }
      })
    return toJsonValue({
      status,
      count: efforts.length,
      efforts,
    }) ?? null
  }

  async listEffortTemplates(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const templates = listStackEffortTemplates({
      stackDataRoot: config.stackDataRoot,
      appRoot: config.appRoot,
    })
    return toJsonValue({
      count: templates.length,
      templates,
    }) ?? null
  }

  private async effortPayload(
    config: StackConfig,
    effort: StackEffort,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const progressTail = readStackEffortProgressTail(effort, 5)
    const activityTail = readStackEffortActivityTail(effort, 5)
    const blockerTail = readStackEffortBlockerTail(effort, 5)
    const openBlockerTail = readStackEffortOpenBlockerTail(effort, 5)
    const optimizerCandidates = readStackEffortOptimizerCandidateSummaries(effort, 5)
    const runEvidence = readStackEffortRunEvidenceSummaries(effort, 5)
    const benchmarks = readStackEffortBenchmarkSummaries(effort, 5)
    const releaseArtifacts = readStackEffortReleaseArtifactSummaries(effort, 5)
    const remainingWork = readStackEffortRemainingWork(effort)
    const boundMetaThreads = await Promise.all(
      effort.manifest.links.meta_thread_refs.map(async (metaThreadId): Promise<JsonObject> => {
        const manifest = await readMetaThreadManifest(config.stackDataRoot, metaThreadId)
        if (!manifest) return { id: metaThreadId, missing: true }
        return metaThreadListItem(config.stackDataRoot, manifest)
      }),
    )
    return {
      ok: true,
      effort_id: effort.manifest.id,
      slug: effort.manifest.slug,
      status: effort.manifest.status,
      folder_ref: effort.registry.folder_ref,
      folder_path: effort.folder_path,
      paths: stackEffortPathRefs(effort),
      artifact_inventory: stackEffortArtifactInventory(effort),
      acceptance_packet: readStackEffortAcceptancePacket(effort) ?? null,
      optimizer_candidates: optimizerCandidates,
      run_evidence: runEvidence,
      benchmarks,
      release_artifacts: releaseArtifacts,
      remaining_work: remainingWork,
      latest_progress: progressTail[progressTail.length - 1] ?? "",
      progress_tail: progressTail,
      latest_activity: activityTail[activityTail.length - 1] ?? null,
      activity_tail: activityTail,
      latest_blocker: openBlockerTail[openBlockerTail.length - 1] ?? null,
      blocker_tail: blockerTail,
      open_blocker_tail: openBlockerTail,
      bound_meta_threads: boundMetaThreads,
      manifest: effort.manifest,
      registry: effort.registry,
      ...extra,
    }
  }

  private optionalEffort(config: StackConfig, effortRef: string | undefined): StackEffort | undefined {
    if (!effortRef) return undefined
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    return effort
  }

  private recordOptionalCloudActionEffortRef(
    config: StackConfig,
    effortRef: string | undefined,
    ref: { system: string; id?: string | null; lane?: string; role?: string },
  ): Record<string, unknown> | null {
    if (!effortRef || !ref.id) return null
    const effort = updateStackEffortRefs({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      refs: [{
        system: ref.system,
        id: ref.id,
        lane: ref.lane ?? "hosted",
        role: ref.role ?? "cloud-action",
      }],
    })
    return {
      effort_id: effort.manifest.id,
      slug: effort.manifest.slug,
      ref: {
        system: ref.system,
        id: ref.id,
        lane: ref.lane ?? "hosted",
        role: ref.role ?? "cloud-action",
      },
    }
  }

  private recordOptionalRunInteractionEffortRef(
    config: StackConfig,
    effortRef: string | undefined,
    runId: string,
    role: string,
    projectId?: string,
  ): Record<string, unknown> | null {
    if (!effortRef) return null
    const refs = [
      { system: "smr", id: runId, lane: "hosted", role },
      ...(projectId ? [{ system: "project", id: projectId, lane: "hosted", role: "linked" }] : []),
    ]
    const effort = updateStackEffortRefs({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      refs,
    })
    return {
      effort_id: effort.manifest.id,
      slug: effort.manifest.slug,
      refs,
    }
  }

  private recordOptionalFactoryActionEffortRef(
    config: StackConfig,
    effortRef: string | undefined,
    factoryId: string,
    role: string,
    projectId?: string,
  ): Record<string, unknown> | null {
    if (!effortRef) return null
    const refs = [
      { system: "factory", id: factoryId, lane: "hosted", role },
      ...(projectId ? [{ system: "project", id: projectId, lane: "hosted", role: "linked" }] : []),
    ]
    const effort = updateStackEffortRefs({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      refs,
    })
    return {
      effort_id: effort.manifest.id,
      slug: effort.manifest.slug,
      refs,
    }
  }

  private async ensureMetaThreadEffortRef(
    effortId: string,
    metaThreadId: string,
    manifest?: StackdMetaThreadManifest,
  ): Promise<StackdMetaThreadManifest> {
    if (manifest?.effort_ref === effortId) return manifest
    try {
      return await stackdUpdateMetaThreadEffortRef(metaThreadId, {
        effort_ref: effortId,
        actor_id: "operator",
        reason: "bind Stack Effort to meta-thread",
      })
    } catch (error) {
      const routeMessage = stackdMissingEffortRefRouteMessage(error)
      if (routeMessage) {
        throw new RpcError(-32000, `${routeMessage}; Effort reverse index was not updated`)
      }
      throw error
    }
  }

  private async bindCreatedThreadToEffort(config: StackConfig, effortRef: string, metaThreadId: string): Promise<Record<string, unknown>> {
    const effort = bindStackEffortMetaThread({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      metaThreadId,
    })
    return this.effortPayload(config, effort, {
      meta_thread_id: metaThreadId,
      receipt: "lever.stack_mcp effort.thread_bound",
    })
  }

  private async preflightEffortBoundMetaThreadCreate(effortId: string): Promise<void> {
    try {
      await stackdAssertMetaThreadEffortRefRoute()
    } catch (error) {
      const message = errorMessage(error)
      throw new RpcError(-32000, `${message}; meta-thread/session was not created; Effort reverse index was not updated for ${effortId}`)
    }
  }

  async getEffort(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    return toJsonValue(await this.effortPayload(config, effort)) ?? null
  }

  async getTaggedEffort(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const slug = readTaggedEffortSlug(config.stackDataRoot)
    if (!slug) {
      return toJsonValue({
        ok: true,
        active: false,
        active_effort: null,
        tagged_effort: null,
        label: "none",
        display_label: "none",
      }) ?? null
    }
    const effort = readStackEffort(
      {
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
      },
      slug,
    )
    if (!effort) {
      return toJsonValue({
        ok: true,
        tagged_effort: slug,
        label: slug,
        display_label: slug,
        missing: true,
        message: "Tagged effort slug is set but the Effort folder was not found.",
      }) ?? null
    }
    return toJsonValue({
      ok: true,
      active: true,
      active_effort: effort.registry.slug,
      tagged_effort: effort.registry.slug,
      label: taggedEffortDisplayLabel(config, effort.registry.slug),
      display_label: taggedEffortDisplayLabel(config, effort.registry.slug),
      effort_id: effort.manifest.id,
      status: effort.manifest.status,
      title: effort.manifest.title,
      folder_ref: effort.registry.folder_ref,
    }) ?? null
  }

  async setTaggedEffort(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")?.trim()
    if (!effortRef || effortRef === "none" || effortRef === "null") {
      writeTaggedEffortSlug(config.stackDataRoot, null)
      return toJsonValue({
        ok: true,
        tagged_effort: null,
        label: "none",
        display_label: "no effort",
        cleared: true,
      }) ?? null
    }
    const effort = readStackEffort(
      {
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
      },
      effortRef,
    )
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    writeTaggedEffortSlug(config.stackDataRoot, effort.registry.slug)
    return toJsonValue({
      ok: true,
      tagged_effort: effort.registry.slug,
      label: taggedEffortDisplayLabel(config, effort.registry.slug),
      display_label: taggedEffortDisplayLabel(config, effort.registry.slug),
      effort_id: effort.manifest.id,
      status: effort.manifest.status,
      title: effort.manifest.title,
    }) ?? null
  }

  async getEffortRemaining(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const openBlockerTail = readStackEffortOpenBlockerTail(effort, 1)
    return toJsonValue({
      ok: true,
      effort_id: effort.manifest.id,
      slug: effort.manifest.slug,
      status: effort.manifest.status,
      folder_ref: effort.registry.folder_ref,
      paths: stackEffortPathRefs(effort),
      acceptance_packet: readStackEffortAcceptancePacket(effort) ?? null,
      remaining_work: readStackEffortRemainingWork(effort),
      latest_blocker: openBlockerTail[openBlockerTail.length - 1] ?? null,
    }) ?? null
  }

  async auditEffort(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    return toJsonValue(auditStackEffort(effort)) ?? null
  }

  async getEffortActivity(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const limit = optionalInteger(args, "limit") ?? 20
    if (limit < 1 || limit > 200) throw new RpcError(-32602, "limit must be between 1 and 200")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const activity = readStackEffortActivityTail(effort, limit)
    return toJsonValue({
      ok: true,
      effort_id: effort.manifest.id,
      slug: effort.manifest.slug,
      status: effort.manifest.status,
      folder_ref: effort.registry.folder_ref,
      paths: stackEffortPathRefs(effort),
      count: activity.length,
      activity,
    }) ?? null
  }

  async refreshEffortReceiptDigests(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const result = refreshStackEffortReceiptDigests({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      receipt_refresh: {
        checked: result.checked,
        updated: result.updated,
        skipped: result.skipped,
        refreshed: result.refreshed,
      },
      receipt: "lever.stack_mcp effort.receipt_digests_refreshed",
    })) ?? null
  }

  async createEffort(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const title = requiredString(args, "title")
    const effort = createStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      appRoot: config.appRoot,
      slug: optionalString(args, "slug"),
      title,
      shortTitle: optionalString(args, "short_title"),
      template: optionalString(args, "template"),
      topic: optionalString(args, "topic"),
      folderRef: optionalString(args, "folder_ref"),
      acceptanceCriteria: optionalStringArray(args, "acceptance_criteria") ?? [],
    })
    return toJsonValue(await this.effortPayload(config, effort, {
      receipt: "lever.stack_mcp effort.created",
    })) ?? null
  }

  async bindEffortThread(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const metaThreadId = requiredString(args, "meta_thread_id")
    const actorId = optionalString(args, "actor_id") ?? "operator"
    const reason = optionalString(args, "reason")
    const current = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!current) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    let manifest: StackdMetaThreadManifest
    try {
      manifest = await stackdUpdateMetaThreadEffortRef(metaThreadId, {
        effort_ref: current.manifest.id,
        reason,
        actor_id: actorId,
      })
    } catch (error) {
      const routeMessage = stackdMissingEffortRefRouteMessage(error)
      if (routeMessage) {
        throw new RpcError(-32000, `${routeMessage}; Effort reverse index was not updated`)
      }
      throw error
    }
    const effort = bindStackEffortMetaThread({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: current.manifest.id,
      metaThreadId,
    })
    return toJsonValue(await this.effortPayload(config, effort, {
      meta_thread_id: manifest.id,
      effort,
      meta_thread: manifest,
      receipt: "lever.stack_mcp effort.thread_bound",
    })) ?? null
  }

  async updateEffortProgress(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const message = requiredString(args, "message")
    const effort = appendStackEffortProgress({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      message,
    })
    return toJsonValue(await this.effortPayload(config, effort, {
      receipt: "lever.stack_mcp effort.progress_updated",
    })) ?? null
  }

  async recordEffortSession(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const result = recordStackEffortSession({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      sessionId: optionalString(args, "session_id"),
      title: requiredString(args, "title"),
      actor: optionalString(args, "actor"),
      kind: optionalString(args, "kind"),
      summary: optionalString(args, "summary"),
      parentSessionId: optionalString(args, "parent_session_id"),
      tags: optionalStringArray(args, "tags"),
      payload: optionalJsonObject(args, "payload"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      session: result.session,
      session_id: result.session.session_id,
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      receipt: "lever.stack_mcp effort_session.recorded",
    })) ?? null
  }

  async recordEffortBlocker(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = recordStackEffortBlocker({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      blocker: requiredString(args, "blocker"),
      evidence: requiredString(args, "evidence"),
      owner: requiredString(args, "owner"),
      next: requiredString(args, "next"),
    })
    return toJsonValue(await this.effortPayload(config, effort, {
      receipt: "lever.stack_mcp effort.blocker_recorded",
    })) ?? null
  }

  async resolveEffortBlocker(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = resolveStackEffortBlocker({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      blockerActivityId: optionalString(args, "activity_id"),
      resolution: requiredString(args, "resolution"),
      evidence: optionalString(args, "evidence"),
      owner: optionalString(args, "owner"),
    })
    return toJsonValue(await this.effortPayload(config, effort, {
      receipt: "lever.stack_mcp effort.blocker_resolved",
    })) ?? null
  }

  async recordEffortAcceptance(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const result = recordStackEffortAcceptance({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      level: requiredString(args, "level"),
      state: optionalString(args, "state") as "recorded" | "pending" | "not_recorded" | undefined,
      status: optionalString(args, "status"),
      evidence: optionalStringArray(args, "evidence"),
      paths: optionalStringArray(args, "paths"),
      result: optionalString(args, "result"),
      decision: optionalString(args, "decision"),
      next: optionalString(args, "next"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      acceptance_level: result.level,
      acceptance_state: result.state,
      acceptance_status: result.status,
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      receipt: "lever.stack_mcp effort.acceptance_recorded",
    })) ?? null
  }

  async recordEffortResearchLog(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const result = appendStackEffortResearchLog({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      title: requiredString(args, "title"),
      sessionId: optionalString(args, "session_id"),
      operatorMessage: optionalString(args, "operator_message"),
      workSummary: requiredString(args, "work_summary"),
      result: optionalString(args, "result"),
      metrics: optionalStringArray(args, "metrics"),
      paths: optionalStringArray(args, "paths"),
      reproduceCommands: optionalStringArray(args, "reproduce_commands"),
      next: optionalString(args, "next"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      session_id: optionalString(args, "session_id"),
      receipt: "lever.stack_mcp effort.research_log_recorded",
    })) ?? null
  }

  async writeEffortHandoff(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const result = writeStackEffortHandoff({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      summary: optionalString(args, "summary"),
      risks: optionalStringArray(args, "risks"),
      next: optionalString(args, "next"),
      owner: optionalString(args, "owner"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      receipt: "lever.stack_mcp effort.handoff_written",
    })) ?? null
  }

  async writeEffortEngineeringPacket(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const repoPath = optionalString(args, "repo_path")
    const result = writeStackEffortEngineeringPacket({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: effort.manifest.id,
      summary: optionalString(args, "summary"),
      repoPath: repoPath ? resolveEffortSourcePath(config, effort.folder_path, repoPath) : undefined,
      baseRef: optionalString(args, "base_ref"),
      files: optionalStringArray(args, "files"),
      diffStat: optionalString(args, "diff_stat"),
      validations: optionalStringArray(args, "validations"),
      skippedGates: optionalStringArray(args, "skipped_gates"),
      risks: optionalStringArray(args, "risks"),
      next: optionalString(args, "next"),
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      changed_files: result.changedFiles,
      diff_stat: result.diffStat,
      git_status: result.gitStatus,
      receipt: "lever.stack_mcp effort.engineering_packet_written",
    })) ?? null
  }

  async recordEffortIdea(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const origin = optionalEffortIdeaOrigin(args, "origin") ?? "AGENT"
    const result = recordStackEffortIdea({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      origin,
      title: requiredString(args, "title"),
      body: optionalString(args, "body"),
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      origin,
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      receipt: "lever.stack_mcp effort.idea_recorded",
    })) ?? null
  }

  async recordEffortNote(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const kind = optionalEffortNoteKind(args, "kind") ?? "note"
    const result = recordStackEffortNote({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      kind,
      title: requiredString(args, "title"),
      body: optionalString(args, "body"),
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      kind,
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      receipt: "lever.stack_mcp effort.note_recorded",
    })) ?? null
  }

  async recordEffortRepo(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const rawSourcePath = requiredString(args, "path")
    const result = recordStackEffortRepo({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: effort.manifest.id,
      sourcePath: resolveEffortSourcePath(config, effort.folder_path, rawSourcePath),
      repoRef: optionalString(args, "repo_ref"),
      title: optionalString(args, "title"),
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      repo_refs: result.effort.manifest.links.repo_refs,
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      receipt: "lever.stack_mcp effort.repo_recorded",
    })) ?? null
  }

  async recordEffortFinding(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const rawSourcePath = optionalString(args, "path")
    const receiptPath = optionalString(args, "receipt_path")
    if (rawSourcePath && receiptPath) {
      throw new RpcError(-32602, "provide path or receipt_path, not both")
    }
    let artifactReceipt: Awaited<ReturnType<typeof readRoundTripPullReceipt>> | undefined
    if (receiptPath) {
      try {
        artifactReceipt = await readRoundTripPullReceipt(config, receiptPath)
      } catch (error) {
        throw new RpcError(-32602, `artifact receipt invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const sourcePath = artifactReceipt
      ? artifactReceipt.workspace_path
      : rawSourcePath ? resolveEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined
    const kind = requiredEffortFindingKind(args, "kind")
    const result = recordStackEffortFinding({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: effort.manifest.id,
      kind,
      title: requiredString(args, "title"),
      body: optionalString(args, "body"),
      sourcePath,
      sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      kind,
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      source_receipt_path: result.sourceReceiptPath ? relative(result.effort.folder_path, result.sourceReceiptPath) : null,
      source_receipt: result.sourceReceipt ?? null,
      artifact_receipt: artifactReceipt ? {
        receipt_path: artifactReceipt.receipt_path,
        artifact_kind: artifactReceipt.artifact_kind,
        source_kind: artifactReceipt.source_kind,
        environment: artifactReceipt.environment,
        run_id: artifactReceipt.run_id ?? null,
        project_id: artifactReceipt.project_id ?? null,
        artifact_name: artifactReceipt.artifact_name ?? null,
        output_id: artifactReceipt.output_id ?? null,
        label: artifactReceipt.label ?? null,
        workspace_path: artifactReceipt.workspace_path,
        digest: artifactReceipt.digest,
        pulled_at: artifactReceipt.pulled_at,
      } : null,
      receipt: "lever.stack_mcp effort.finding_recorded",
    })) ?? null
  }

  async recordEffortCapture(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const rawSourcePath = optionalString(args, "path")
    const receiptPath = optionalString(args, "receipt_path")
    if (rawSourcePath && receiptPath) {
      throw new RpcError(-32602, "provide path or receipt_path, not both")
    }
    let artifactReceipt: Awaited<ReturnType<typeof readRoundTripPullReceipt>> | undefined
    if (receiptPath) {
      try {
        artifactReceipt = await readRoundTripPullReceipt(config, receiptPath)
      } catch (error) {
        throw new RpcError(-32602, `artifact receipt invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const sourcePath = artifactReceipt
      ? artifactReceipt.workspace_path
      : rawSourcePath ? resolveEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined
    const captureKind = requiredEffortCaptureKind(args, "capture_kind")
    const kind = optionalEffortFindingKind(args, "kind")
    const result = recordStackEffortCapture({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: effort.manifest.id,
      captureKind,
      findingKind: kind,
      title: requiredString(args, "title"),
      body: optionalString(args, "body"),
      sourcePath,
      sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      capture_kind: result.captureKind,
      kind: result.kind,
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      source_receipt_path: result.sourceReceiptPath ? relative(result.effort.folder_path, result.sourceReceiptPath) : null,
      source_receipt: result.sourceReceipt ?? null,
      artifact_receipt: artifactReceipt ? {
        receipt_path: artifactReceipt.receipt_path,
        artifact_kind: artifactReceipt.artifact_kind,
        source_kind: artifactReceipt.source_kind,
        environment: artifactReceipt.environment,
        run_id: artifactReceipt.run_id ?? null,
        project_id: artifactReceipt.project_id ?? null,
        artifact_name: artifactReceipt.artifact_name ?? null,
        output_id: artifactReceipt.output_id ?? null,
        label: artifactReceipt.label ?? null,
        workspace_path: artifactReceipt.workspace_path,
        digest: artifactReceipt.digest,
        pulled_at: artifactReceipt.pulled_at,
      } : null,
      receipt: "lever.stack_mcp effort.capture_recorded",
    })) ?? null
  }

  async recordEffortBenchmark(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const rawSourcePath = optionalString(args, "path")
    const receiptPath = optionalString(args, "receipt_path")
    if (rawSourcePath && receiptPath) {
      throw new RpcError(-32602, "provide path or receipt_path, not both")
    }
    let artifactReceipt: Awaited<ReturnType<typeof readRoundTripPullReceipt>> | undefined
    if (receiptPath) {
      try {
        artifactReceipt = await readRoundTripPullReceipt(config, receiptPath)
      } catch (error) {
        throw new RpcError(-32602, `artifact receipt invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const sourcePath = artifactReceipt
      ? artifactReceipt.workspace_path
      : rawSourcePath ? resolveEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined
    const result = recordStackEffortBenchmark({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: effort.manifest.id,
      title: optionalString(args, "title"),
      benchmarkId: optionalString(args, "benchmark_id"),
      name: optionalString(args, "name"),
      version: optionalString(args, "version"),
      source: optionalString(args, "source"),
      license: optionalString(args, "license"),
      taskShape: optionalString(args, "task_shape"),
      splits: optionalStringArray(args, "splits"),
      metrics: optionalStringArray(args, "metrics"),
      body: optionalString(args, "body"),
      sourcePath,
      sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      benchmark_id: result.benchmarkId ?? null,
      name: result.name,
      version: result.version ?? null,
      source: result.source ?? null,
      license: result.license ?? null,
      task_shape: result.taskShape ?? null,
      splits: result.splits,
      metrics: result.metrics,
      kind: "data",
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      source_receipt_path: result.sourceReceiptPath ? relative(result.effort.folder_path, result.sourceReceiptPath) : null,
      source_receipt: result.sourceReceipt ?? null,
      artifact_receipt: artifactReceipt ? {
        receipt_path: artifactReceipt.receipt_path,
        artifact_kind: artifactReceipt.artifact_kind,
        source_kind: artifactReceipt.source_kind,
        environment: artifactReceipt.environment,
        run_id: artifactReceipt.run_id ?? null,
        project_id: artifactReceipt.project_id ?? null,
        artifact_name: artifactReceipt.artifact_name ?? null,
        output_id: artifactReceipt.output_id ?? null,
        label: artifactReceipt.label ?? null,
        workspace_path: artifactReceipt.workspace_path,
        digest: artifactReceipt.digest,
        pulled_at: artifactReceipt.pulled_at,
      } : null,
      receipt: "lever.stack_mcp effort.benchmark_recorded",
    })) ?? null
  }

  async recordEffortOptimizerCandidate(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const rawSourcePath = optionalString(args, "path")
    const receiptPath = optionalString(args, "receipt_path")
    if (rawSourcePath && receiptPath) {
      throw new RpcError(-32602, "provide path or receipt_path, not both")
    }
    let artifactReceipt: Awaited<ReturnType<typeof readRoundTripPullReceipt>> | undefined
    if (receiptPath) {
      try {
        artifactReceipt = await readRoundTripPullReceipt(config, receiptPath)
      } catch (error) {
        throw new RpcError(-32602, `artifact receipt invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const sourcePath = artifactReceipt
      ? artifactReceipt.workspace_path
      : rawSourcePath ? resolveEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined
    const result = recordStackEffortOptimizerCandidate({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: effort.manifest.id,
      title: optionalString(args, "title"),
      optimizerRunId: optionalString(args, "optimizer_run_id"),
      candidateId: optionalString(args, "candidate_id"),
      score: optionalString(args, "score"),
      scoreLabel: optionalString(args, "score_label"),
      split: optionalString(args, "split"),
      body: optionalString(args, "body"),
      sourcePath,
      sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      optimizer_run_id: result.optimizerRunId ?? null,
      candidate_id: result.candidateId ?? null,
      score: result.score ?? null,
      score_label: result.scoreLabel ?? null,
      split: result.split ?? null,
      kind: "proof",
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      source_receipt_path: result.sourceReceiptPath ? relative(result.effort.folder_path, result.sourceReceiptPath) : null,
      source_receipt: result.sourceReceipt ?? null,
      artifact_receipt: artifactReceipt ? {
        receipt_path: artifactReceipt.receipt_path,
        artifact_kind: artifactReceipt.artifact_kind,
        source_kind: artifactReceipt.source_kind,
        environment: artifactReceipt.environment,
        run_id: artifactReceipt.run_id ?? null,
        project_id: artifactReceipt.project_id ?? null,
        artifact_name: artifactReceipt.artifact_name ?? null,
        output_id: artifactReceipt.output_id ?? null,
        label: artifactReceipt.label ?? null,
        workspace_path: artifactReceipt.workspace_path,
        digest: artifactReceipt.digest,
        pulled_at: artifactReceipt.pulled_at,
      } : null,
      receipt: "lever.stack_mcp effort.optimizer_candidate_recorded",
    })) ?? null
  }

  async recordEffortRunEvidence(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const rawSourcePath = optionalString(args, "path")
    const receiptPath = optionalString(args, "receipt_path")
    if (rawSourcePath && receiptPath) {
      throw new RpcError(-32602, "provide path or receipt_path, not both")
    }
    let artifactReceipt: Awaited<ReturnType<typeof readRoundTripPullReceipt>> | undefined
    if (receiptPath) {
      try {
        artifactReceipt = await readRoundTripPullReceipt(config, receiptPath)
      } catch (error) {
        throw new RpcError(-32602, `artifact receipt invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const sourcePath = artifactReceipt
      ? artifactReceipt.workspace_path
      : rawSourcePath ? resolveEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined
    const runKind = requiredEffortRunEvidenceKind(args, "run_kind")
    const result = recordStackEffortRunEvidence({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: effort.manifest.id,
      runKind,
      title: optionalString(args, "title"),
      runId: optionalString(args, "run_id"),
      projectId: optionalString(args, "project_id"),
      outputId: optionalString(args, "output_id"),
      artifactName: optionalString(args, "artifact_name"),
      metric: optionalString(args, "metric"),
      acceptanceLevel: optionalString(args, "acceptance_level"),
      body: optionalString(args, "body"),
      sourcePath,
      sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      run_kind: result.runKind,
      run_id: result.runId ?? null,
      project_id: result.projectId ?? null,
      output_id: result.outputId ?? null,
      artifact_name: result.artifactName ?? null,
      metric: result.metric ?? null,
      acceptance_level: result.acceptanceLevel ?? null,
      kind: "proof",
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      source_receipt_path: result.sourceReceiptPath ? relative(result.effort.folder_path, result.sourceReceiptPath) : null,
      source_receipt: result.sourceReceipt ?? null,
      artifact_receipt: artifactReceipt ? {
        receipt_path: artifactReceipt.receipt_path,
        artifact_kind: artifactReceipt.artifact_kind,
        source_kind: artifactReceipt.source_kind,
        environment: artifactReceipt.environment,
        run_id: artifactReceipt.run_id ?? null,
        project_id: artifactReceipt.project_id ?? null,
        artifact_name: artifactReceipt.artifact_name ?? null,
        output_id: artifactReceipt.output_id ?? null,
        label: artifactReceipt.label ?? null,
        workspace_path: artifactReceipt.workspace_path,
        digest: artifactReceipt.digest,
        pulled_at: artifactReceipt.pulled_at,
      } : null,
      receipt: "lever.stack_mcp effort.run_evidence_recorded",
    })) ?? null
  }

  async recordEffortReleaseArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = readStackEffort({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
    }, effortRef)
    if (!effort) throw new RpcError(-32602, `effort not found: ${effortRef}`)
    const rawSourcePath = optionalString(args, "path")
    const receiptPath = optionalString(args, "receipt_path")
    if (rawSourcePath && receiptPath) {
      throw new RpcError(-32602, "provide path or receipt_path, not both")
    }
    let artifactReceipt: Awaited<ReturnType<typeof readRoundTripPullReceipt>> | undefined
    if (receiptPath) {
      try {
        artifactReceipt = await readRoundTripPullReceipt(config, receiptPath)
      } catch (error) {
        throw new RpcError(-32602, `artifact receipt invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const sourcePath = artifactReceipt
      ? artifactReceipt.workspace_path
      : rawSourcePath ? resolveEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined
    const result = recordStackEffortReleaseArtifact({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef: effort.manifest.id,
      title: optionalString(args, "title"),
      version: optionalString(args, "version"),
      channel: optionalString(args, "channel"),
      target: optionalString(args, "target"),
      archive: optionalString(args, "archive"),
      sha256: optionalString(args, "sha256"),
      size: optionalString(args, "size"),
      manifest: optionalString(args, "manifest"),
      releaseSite: optionalString(args, "release_site"),
      publishable: optionalBoolean(args, "publishable"),
      publishBlockers: optionalStringArray(args, "publish_blockers"),
      body: optionalString(args, "body"),
      sourcePath,
      sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      version: result.version ?? null,
      channel: result.channel ?? null,
      target: result.target ?? null,
      archive: result.archive ?? null,
      sha256: result.sha256 ?? null,
      size: result.size ?? null,
      manifest: result.manifest ?? null,
      release_site: result.releaseSite ?? null,
      publishable: result.publishable ?? null,
      publish_blockers: result.publishBlockers,
      kind: "proof",
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      source_receipt_path: result.sourceReceiptPath ? relative(result.effort.folder_path, result.sourceReceiptPath) : null,
      source_receipt: result.sourceReceipt ?? null,
      artifact_receipt: artifactReceipt ? {
        receipt_path: artifactReceipt.receipt_path,
        artifact_kind: artifactReceipt.artifact_kind,
        source_kind: artifactReceipt.source_kind,
        environment: artifactReceipt.environment,
        run_id: artifactReceipt.run_id ?? null,
        project_id: artifactReceipt.project_id ?? null,
        artifact_name: artifactReceipt.artifact_name ?? null,
        output_id: artifactReceipt.output_id ?? null,
        label: artifactReceipt.label ?? null,
        workspace_path: artifactReceipt.workspace_path,
        digest: artifactReceipt.digest,
        pulled_at: artifactReceipt.pulled_at,
      } : null,
      receipt: "lever.stack_mcp effort.release_artifact_recorded",
    })) ?? null
  }

  async updateEffortRefs(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const effort = updateStackEffortRefs({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      refs: optionalString(args, "system") && optionalString(args, "id")
        ? [{
            system: optionalString(args, "system")!,
            id: optionalString(args, "id")!,
            lane: optionalString(args, "lane"),
            role: optionalString(args, "role"),
          }]
        : undefined,
      refLane: optionalString(args, "lane"),
      factoryId: optionalString(args, "factory_id"),
      hostedEffortId: optionalString(args, "hosted_effort_id"),
      projectId: optionalString(args, "project_id"),
      optimizerRunId: optionalString(args, "optimizer_run_id"),
      smrRunId: optionalString(args, "smr_run_id"),
      tinkerRunId: optionalString(args, "tinker_run_id"),
      repoRef: optionalString(args, "repo_ref"),
      initiativeId: optionalString(args, "initiative_id"),
    })
    return toJsonValue(await this.effortPayload(config, effort, {
      refs: effort.manifest.refs,
      repo_refs: effort.manifest.links.repo_refs,
      initiative_id: effort.manifest.links.initiative_id,
      receipt: "lever.stack_mcp effort.refs_updated",
    })) ?? null
  }

  async updateEffortStatus(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const status = requiredEffortStatus(args, "status")
    const confirm = optionalBoolean(args, "confirm") ?? false
    if (status === "archived" && !confirm) {
      throw new RpcError(-32602, "confirm=true is required to archive an Effort")
    }
    const effort = updateStackEffortStatus({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      status,
    })
    return toJsonValue(await this.effortPayload(config, effort, {
      receipt: "lever.stack_mcp effort.status_updated",
    })) ?? null
  }

  async launchEffort(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const kind = requiredString(args, "kind")
    if (!(EFFORT_LAUNCH_KINDS as readonly string[]).includes(kind)) {
      throw new RpcError(-32602, `kind must be one of: ${EFFORT_LAUNCH_KINDS.join(", ")}`)
    }
    const capability = requiredString(args, "capability")
    const result = await launchStackEffortRun(config, {
      effortRef,
      kind: kind as EffortLaunchKind,
      capability: parseEffortLaunchCapability(capability),
      configPath: optionalString(args, "config_path"),
      tunnelUrl: optionalString(args, "tunnel_url"),
      containerPool: optionalString(args, "container_pool"),
      goal: optionalString(args, "goal"),
      projectId: optionalString(args, "project_id"),
      factoryId: optionalString(args, "factory_id"),
      poolId: optionalString(args, "pool_id"),
      taskId: optionalString(args, "task_id"),
      split: optionalString(args, "split"),
      seed: optionalInteger(args, "seed"),
      policyName: optionalString(args, "policy_name"),
      policyConfig: optionalJsonObject(args, "policy_config"),
      request: optionalJsonObject(args, "request"),
      name: optionalString(args, "name"),
      description: optionalString(args, "description"),
      status: optionalString(args, "status"),
      imageRef: optionalString(args, "image_ref"),
      serviceUrl: optionalString(args, "service_url"),
      runtimeKind: optionalString(args, "runtime_kind"),
      releaseName: optionalString(args, "release_name"),
      provider: optionalString(args, "provider"),
      archiveBase64: optionalString(args, "archive_base64"),
      sourceStorageUri: optionalString(args, "source_storage_uri"),
      dockerfilePath: optionalString(args, "dockerfile_path"),
      baseImageRef: optionalString(args, "base_image_ref"),
    })
    return toJsonValue({
      ok: result.ok,
      capability: result.capability,
      kind: result.kind,
      lane: result.lane,
      message: result.message,
      id: result.id,
      ref: result.ref,
      recorded_in: result.recorded_in,
      detail: result.detail,
      receipt: "lever.stack_mcp effort.launch_submitted",
    }) ?? null
  }

  async createMetaThread(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const actorRole = optionalString(args, "actor_role") ?? "gardener"
    if (actorRole !== "gardener" && actorRole !== "operator") {
      throw new RpcError(-32602, "actor_role must be gardener or operator")
    }
    const objective = optionalString(args, "objective")
    const status = optionalString(args, "status") ?? "active"
    if (status === "blocked") {
      throw new RpcError(-32602, "status=blocked is operator-only; keep the goal active and record the blocker separately")
    }
    const title = optionalString(args, "title") ?? objective
    if (!title) throw new RpcError(-32602, "title or objective is required")
    const threadId = requiredString(args, "thread_id")
    const effort = this.optionalEffort(config, optionalString(args, "effort_ref"))
    if (effort) await this.preflightEffortBoundMetaThreadCreate(effort.manifest.id)
    const gardenerThreadId = optionalString(args, "gardener_thread_id") ?? readCurrentGardenerThreadId(config.stackDataRoot)
    const manifest = await stackdCreateMetaThread({
      title,
      thread_id: threadId,
      role: optionalString(args, "role") ?? "implement",
      model: optionalString(args, "model") ?? harnessModel(config),
      reasoning_effort: optionalString(args, "reasoning_effort") ?? config.codexReasoningEffort,
      harness: optionalString(args, "harness") ?? config.harness,
      source: optionalString(args, "source") ?? "gardener",
      source_ref: optionalString(args, "source_ref") ?? gardenerThreadId,
      effort_ref: effort?.manifest.id,
      repo_refs: optionalStringArray(args, "repo_refs") ?? [],
      worktree_refs: optionalStringArray(args, "worktree_refs") ?? [config.workspaceRoot],
      gardener_thread_id: gardenerThreadId,
      monitor_profile: optionalString(args, "monitor_profile"),
      active_goal: objective
        ? {
            objective,
            status,
            acceptance_criteria: optionalStringArray(args, "acceptance_criteria") ?? [],
            blockers: optionalStringArray(args, "blockers") ?? [],
          }
        : undefined,
    })
    const boundManifest = effort
      ? await this.ensureMetaThreadEffortRef(effort.manifest.id, manifest.id, manifest)
      : manifest
    const effortBinding = effort
      ? await this.bindCreatedThreadToEffort(config, effort.manifest.id, boundManifest.id)
      : null
    return toJsonValue({
      ok: true,
      meta_thread_id: boundManifest.id,
      thread_id: boundManifest.head_thread_id,
      segment_id: boundManifest.head_segment_id,
      lifecycle_status: boundManifest.lifecycle_status ?? "live",
      active_goal: boundManifest.active_goal ?? null,
      effort_ref: boundManifest.effort_ref ?? null,
      effort: effortBinding,
      manifest: boundManifest,
      receipt: "lever.stack_mcp meta_thread.created",
    }) ?? null
  }

  async createWorkerThread(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const actorRole = optionalString(args, "actor_role") ?? "gardener"
    if (actorRole !== "gardener" && actorRole !== "operator") {
      throw new RpcError(-32602, "actor_role must be gardener or operator")
    }
    const objective = optionalString(args, "objective")
    const status = optionalString(args, "status") ?? "active"
    if (status === "blocked") {
      throw new RpcError(-32602, "status=blocked is operator-only; keep the goal active and record the blocker separately")
    }
    const effort = this.optionalEffort(config, optionalString(args, "effort_ref"))
    if (effort) await this.preflightEffortBoundMetaThreadCreate(effort.manifest.id)
    const title = optionalString(args, "title") ?? objective ?? "new worker thread"
    const workspaceRoot = optionalString(args, "workspace_root") ?? config.workspaceRoot
    const gardenerThreadId = optionalString(args, "gardener_thread_id") ?? readCurrentGardenerThreadId(config.stackDataRoot)
    const response = await stackdCreateWorkerMetaThread({
      title,
      workspace_root: workspaceRoot,
      codex_command: harnessSessionCommand(config),
      role: optionalString(args, "role") ?? "implement",
      model: optionalString(args, "model") ?? harnessModel(config),
      reasoning_effort: optionalString(args, "reasoning_effort") ?? config.codexReasoningEffort,
      harness: optionalString(args, "harness") ?? config.harness,
      source: optionalString(args, "source") ?? "gardener",
      source_ref: optionalString(args, "source_ref") ?? gardenerThreadId,
      effort_ref: effort?.manifest.id,
      repo_refs: optionalStringArray(args, "repo_refs") ?? [],
      worktree_refs: optionalStringArray(args, "worktree_refs") ?? [workspaceRoot],
      gardener_thread_id: gardenerThreadId,
      monitor_profile: optionalString(args, "monitor_profile"),
      active_goal: objective
        ? {
            objective,
            status,
            acceptance_criteria: optionalStringArray(args, "acceptance_criteria") ?? [],
            blockers: optionalStringArray(args, "blockers") ?? [],
          }
        : undefined,
    })
    const manifest = response.manifest
    const boundManifest = effort
      ? await this.ensureMetaThreadEffortRef(effort.manifest.id, manifest.id, manifest)
      : manifest
    const effortBinding = effort
      ? await this.bindCreatedThreadToEffort(config, effort.manifest.id, boundManifest.id)
      : null
    return toJsonValue({
      ok: true,
      thread_id: boundManifest.head_thread_id,
      session_path: response.session_path,
      meta_thread_id: boundManifest.id,
      segment_id: boundManifest.head_segment_id,
      lifecycle_status: boundManifest.lifecycle_status ?? "live",
      active_goal: boundManifest.active_goal ?? null,
      appears_in_threads: true,
      effort_ref: boundManifest.effort_ref ?? null,
      effort: effortBinding,
      manifest: boundManifest,
      receipt: "lever.stack_mcp worker_thread.created",
    }) ?? null
  }

  async workerRun(args: JsonObject): Promise<JsonValue> {
    await this.config(args)
    const threadId = requiredString(args, "thread_id")
    const maxTurns = optionalInteger(args, "max_turns")
    if (maxTurns !== undefined && maxTurns < 1) {
      throw new RpcError(-32602, "max_turns must be at least 1")
    }
    const result = await stackdWorkerRun(threadId, {
      objective: optionalString(args, "objective"),
      max_turns: maxTurns,
      monitor_profile: optionalString(args, "monitor_profile"),
    })
    return toJsonValue({
      ...result,
      receipt: "lever.stack_mcp worker_run.started",
    }) ?? null
  }

  async workerRunStatus(args: JsonObject): Promise<JsonValue> {
    await this.config(args)
    const threadId = requiredString(args, "thread_id")
    const status = await stackdWorkerRunStatus(threadId)
    return toJsonValue({
      ...status,
      receipt: "lever.stack_mcp worker_run.status",
    }) ?? null
  }

  async workerContinue(args: JsonObject): Promise<JsonValue> {
    await this.config(args)
    const threadId = requiredString(args, "thread_id")
    const maxTurns = optionalInteger(args, "max_turns")
    if (maxTurns !== undefined && maxTurns < 1) {
      throw new RpcError(-32602, "max_turns must be at least 1")
    }
    const result = await stackdWorkerContinue(threadId, {
      note: optionalString(args, "note"),
      max_turns: maxTurns,
    })
    return toJsonValue({
      ...result,
      receipt: "lever.stack_mcp worker_run.continued",
    }) ?? null
  }

  async workerPause(args: JsonObject): Promise<JsonValue> {
    await this.config(args)
    const threadId = requiredString(args, "thread_id")
    const reason = requiredString(args, "reason")
    const status = await stackdWorkerPause(threadId, { reason })
    return toJsonValue({
      ...status,
      receipt: "lever.stack_mcp worker_run.paused",
    }) ?? null
  }

  async updateMetaThreadGoal(args: JsonObject): Promise<JsonValue> {
    await this.config(args)
    const actorRole = optionalString(args, "actor_role") ?? "gardener"
    if (actorRole !== "gardener" && actorRole !== "operator") {
      throw new RpcError(-32602, "actor_role must be gardener or operator")
    }
    const status = optionalString(args, "status")
    if (status === "blocked") {
      throw new RpcError(-32602, "status=blocked is operator-only; keep the goal active and record the blocker separately")
    }
    const metaThreadId = requiredString(args, "meta_thread_id")
    const manifest = await stackdUpdateMetaThreadGoal(metaThreadId, {
      objective: optionalString(args, "objective"),
      status,
      acceptance_criteria: optionalStringArray(args, "acceptance_criteria"),
      blockers: optionalStringArray(args, "blockers"),
    })
    return toJsonValue({
      ok: true,
      meta_thread_id: manifest.id,
      thread_id: manifest.head_thread_id,
      segment_id: manifest.head_segment_id,
      active_goal: manifest.active_goal ?? null,
      manifest,
      receipt: "lever.stack_mcp meta_thread.goal_updated",
    }) ?? null
  }

  async setMetaThreadLifecycle(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const actorRole = optionalString(args, "actor_role") ?? "gardener"
    if (actorRole === "monitor") {
      throw new RpcError(-32602, "monitor cannot mutate meta-thread lifecycle")
    }
    if (actorRole !== "gardener" && actorRole !== "operator") {
      throw new RpcError(-32602, "actor_role must be gardener or operator")
    }
    if (actorRole === "gardener" && !loadGardenerConfig(config.stackDataRoot).permissions.metaThreadLifecycle) {
      throw new RpcError(-32602, "gardener meta-thread lifecycle permission is disabled")
    }
    const metaThreadId = requiredString(args, "meta_thread_id")
    const status = requiredMetaThreadLifecycle(args, "status")
    const confirm = optionalBoolean(args, "confirm") ?? false
    if (status === "archived" && !confirm) {
      throw new RpcError(-32602, "confirm=true is required to archive a meta-thread")
    }
    const reason = optionalString(args, "reason")
    const actorId = optionalString(args, "actor_id") ?? actorRole
    const manifest = await stackdUpdateMetaThreadLifecycle(metaThreadId, {
      status,
      reason,
      actor_id: actorId,
    })
    return toJsonValue({
      ok: true,
      meta_thread_id: manifest.id,
      lifecycle_status: manifest.lifecycle_status ?? "live",
      archived_at: manifest.archived_at ?? null,
      archived_by: manifest.archived_by ?? null,
      archive_reason: manifest.archive_reason ?? null,
      manifest,
      receipt: "lever.stack_mcp meta_thread.lifecycle_updated",
    }) ?? null
  }

  async setMetaThreadTitle(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const actorRole = optionalString(args, "actor_role") ?? "gardener"
    if (
      actorRole !== "gardener" &&
      actorRole !== "operator" &&
      actorRole !== "monitor" &&
      actorRole !== "remote_gardener"
    ) {
      throw new RpcError(-32602, "actor_role must be gardener, monitor, remote_gardener, or operator")
    }
    if (actorRole === "gardener" && !loadGardenerConfig(config.stackDataRoot).permissions.metaThreadTitle) {
      throw new RpcError(-32602, "gardener meta-thread title permission is disabled")
    }
    const metaThreadId = requiredString(args, "meta_thread_id")
    const title = requiredString(args, "title")
    const reason = optionalString(args, "reason")
    const actorId = optionalString(args, "actor_id") ?? actorRole
    const response = await stackdUpdateMetaThreadTitle(metaThreadId, {
      title,
      reason,
      actor_id: actorId,
    })
    const manifest = response.manifest
    return toJsonValue({
      ok: true,
      meta_thread_id: manifest.id,
      title: manifest.title,
      event_id: response.event_id ?? null,
      manifest,
      receipt: "lever.stack_mcp meta_thread.title_updated",
    }) ?? null
  }

  async bindMetaThreadSmrRun(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const actorRole = optionalString(args, "actor_role") ?? "remote_gardener"
    if (actorRole !== "remote_gardener" && actorRole !== "gardener" && actorRole !== "operator") {
      throw new RpcError(-32602, "actor_role must be remote_gardener, gardener, or operator")
    }
    const actorId = optionalString(args, "actor_id") ?? actorRole
    const metaThreadId = requiredString(args, "meta_thread_id")
    const runId = requiredString(args, "run_id")
    const projectId = optionalString(args, "project_id")
    const factoryId = optionalString(args, "factory_id")
    const deploymentId = optionalString(args, "deployment_id")
    const result = await stackdBindMetaThreadRemoteSmrRun(metaThreadId, {
      smr_run_id: runId,
      environment: config.environmentName,
      api_base_url: config.environment.apiBaseUrl,
      project_id: projectId,
      factory_id: factoryId,
      deployment_id: deploymentId,
      objective: optionalString(args, "objective"),
      remote_status: optionalString(args, "remote_status"),
      actor_id: actorId,
      reason: optionalString(args, "reason"),
    })
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_smr.run.bound",
      source: "lever.remote_gardener",
      subject: { kind: "remote_smr_run", id: runId },
      correlation: {
        run_id: runId,
        project_id: projectId ?? undefined,
        factory_id: factoryId ?? undefined,
        deployment_id: deploymentId ?? undefined,
        stack_session_id: result.manifest.head_thread_id,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        actor_role: actorRole,
        actor_id: actorId,
        meta_thread_id: metaThreadId,
        thread_id: result.manifest.head_thread_id,
        project_id: projectId ?? null,
        run_id: runId,
        factory_id: factoryId ?? null,
        deployment_id: deploymentId ?? null,
        objective: optionalString(args, "objective") ?? null,
        remote_status: optionalString(args, "remote_status") ?? null,
        reason: optionalString(args, "reason") ?? null,
        binding_id: result.binding.binding_id,
        meta_event_id: result.event_id,
        source: "stack_meta_thread_bind_smr_run",
      },
    })
    return toJsonValue({
      ok: true,
      receipt: "lever.remote_smr.run.bound",
      meta_thread_id: metaThreadId,
      run_id: runId,
      binding: result.binding,
      event_id: result.event_id,
      runtime_event: runtimeEvent,
      manifest: result.manifest,
    }) ?? null
  }

  async agentStatus(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const mode = optionalBridgeMode(args) ?? "all"
    if (mode !== "local") void emitFeatureUsed("hosted_ops")
    const auth = environmentAuthStatus(config.environment)
    const [local, runtime, telemetry] = await Promise.all([
      mode === "remote" ? Promise.resolve(undefined) : readOptimizerSnapshot(config),
      readStackRuntimeFactory(),
      stackdTelemetryStatus().catch(() => undefined),
    ])
    const runtimeSummary = runtimeSummaryFromFactory(runtime?.snapshot, config)
    const shouldReadDirectRemote = mode !== "local" && !runtimeSummary
    const [research, hosted] = shouldReadDirectRemote
      ? await Promise.all([
          readRemoteResearchSnapshot(config),
          readHostedOptimizerSnapshot(config),
        ])
      : [undefined, undefined] as const
    return toJsonValue({
      bridge: "stack-agent-bridge",
      mode,
      environment: config.environmentName,
      api_base_url: config.environment.apiBaseUrl,
      auth: {
        has_auth: auth.hasAuth,
        env: auth.authEnv,
        source: auth.source,
        message: auth.message,
      },
      mcp: {
        server: SERVER_NAME,
        tools: this.toolPayload().map((tool) => tool.name),
      },
      local: local
        ? {
            optimizer_status: local.status,
            optimizer_service_url: local.serviceUrl,
            optimizer_message: local.message,
            optimizer_jobs: local.runs.length,
            optimizer_active: local.runningCount ?? local.activeWorkers ?? 0,
            recent_optimizer_runs: local.runs.slice(0, 5).map((run) => ({
              run_id: run.runId,
              status: run.status,
              phase: run.phase,
              submitted_at: run.submittedAt,
            })),
          }
        : undefined,
      remote: runtimeSummary?.remote ?? (research
        ? {
            source: "direct-api",
            status: research.status,
            message: research.message,
            smr_runs: research.jobs.length,
            factories: research.factories.length,
            active_smr_runs: research.jobs.filter((run) => isActiveState(run.state)).length,
            selected_smr_run_id: research.jobs[0]?.runId,
            selected_factory_id: research.factories[0]?.factoryId,
            hosted_artifact_for_first: research.jobs[0]
              ? (research.hostedArtifacts[research.jobs[0].runId] ?? null)
              : null,
          }
        : undefined),
      hosted_optimizers: runtimeSummary?.hostedOptimizers ?? (hosted
        ? {
            source: "direct-api",
            status: hosted.status,
            message: hosted.message,
            runs: hosted.runs.length,
            active_runs: hosted.runs.filter((run) => isActiveState(run.status)).length,
            selected_run_id: hosted.runs[0]?.runId,
          }
        : undefined),
      runtime: runtime
        ? {
            status: runtime.status,
            snapshot: runtime.snapshot ?? null,
          }
        : {
            status: "unavailable",
            snapshot: null,
          },
      crash_reporting: telemetry?.crash_reporting
        ? {
            enabled: telemetry.crash_reporting.enabled,
            default: telemetry.crash_reporting.default,
            outbox_path: telemetry.crash_reporting.outbox_path,
            local_record_count: telemetry.crash_reporting.local_record_count,
            endpoint_configured: telemetry.crash_reporting.endpoint_configured,
          }
        : {
            status: "unavailable",
          },
      next_actions: bridgeNextActions(
        mode,
        auth.hasAuth,
        runtimeSummary?.remote.active_smr_runs ?? research?.jobs.length ?? 0,
        runtimeSummary?.hostedOptimizers.active_runs ?? hosted?.runs.length ?? 0,
      ),
    }) ?? null
  }

  async crashReports(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const limit = optionalInteger(args, "limit") ?? 20
    const remote = optionalBoolean(args, "remote") ?? true
    const windowDays = optionalInteger(args, "window_days") ?? 7
    const view = await readCrashReportsView(config, { limit, remote, windowDays })
    return toJsonValue(view) ?? null
  }

  async listLiveSmrs(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("hosted_ops")
    const tick = optionalBoolean(args, "tick") ?? false
    const runtime = tick
      ? await stackdRuntimeTick().catch(() => undefined)
      : await readStackRuntimeFactory()
    const runtimeRuns = liveSmrsMcpFromRuntime(runtime?.snapshot, config)
    if (runtimeRuns) return runtimeRuns
    const snapshot = await readRemoteResearchSnapshot(config)
    return toJsonValue({
      environment: config.environmentName,
      source: "direct-api",
      status: snapshot.status,
      message: snapshot.message,
      count: snapshot.jobs.length,
      runs: snapshot.jobs.map((run) => {
        const detail = snapshot.runDetails[run.runId]
        const ha = snapshot.hostedArtifacts[run.runId]
        return {
          run_id: run.runId,
          project_id: run.projectId,
          state: run.state,
          phase: run.phase,
          runbook: run.runbook,
          updated_at: run.updatedAt,
          reason: run.reason,
          work_products: detail?.workProductCount ?? 0,
          artifacts: detail?.artifactCount ?? 0,
          pending_messages: detail?.pendingRuntimeMessageCount ?? 0,
          file_mounts: detail?.activeFileMountCount ?? 0,
          hosted_artifact: ha
            ? {
                status: ha.status,
                hosted_url: ha.hostedUrl ?? null,
                public_url: ha.publicUrl ?? null,
                slug: ha.slug ?? null,
                visibility: ha.visibility ?? null,
                url_status: ha.urlStatus ?? null,
              }
            : null,
        }
      }),
    }) ?? null
  }

  async inspectLiveRun(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const projectId = optionalString(args, "project_id")
    const snapshot = await readRemoteResearchSnapshot(config)
    const run = snapshot.jobs.find((item) => item.runId === runId) ?? {
      runId,
      projectId,
      state: "unknown",
    }
    const [detail, hostedArtifact] = await Promise.all([
      readRemoteRunDetail(config, run),
      readRunHostedArtifactStatus(config, runId).catch(() => undefined),
    ])
    return toJsonValue({
      environment: config.environmentName,
      run: {
        run_id: run.runId,
        project_id: run.projectId,
        state: run.state,
        phase: run.phase,
        runbook: run.runbook,
        updated_at: run.updatedAt,
        reason: run.reason,
      },
      detail: runDetailToMcp(detail),
      hosted_artifact: hostedArtifact
        ? {
            status: hostedArtifact.status,
            hosted_url: hostedArtifact.hostedUrl ?? null,
            public_url: hostedArtifact.publicUrl ?? null,
            slug: hostedArtifact.slug ?? null,
            visibility: hostedArtifact.visibility ?? null,
            url_status: hostedArtifact.urlStatus ?? null,
            message: hostedArtifact.message ?? null,
          }
        : null,
    }) ?? null
  }

  async runtimeStatus(args: JsonObject): Promise<JsonValue> {
    await this.config(args)
    const afterSeq = optionalInteger(args, "after_seq")
    const limit = optionalInteger(args, "limit")
    const source = optionalString(args, "source")
    const tick = optionalBoolean(args, "tick") ?? false
    const factory = tick ? await stackdRuntimeTick().catch(errorToRuntimeUnavailable) : await readStackRuntimeFactory()
    const events = await stackdRuntimeEvents({ afterSeq, limit, source })
      .then((result) => ({ status: "ready", events: result.events, error: null }))
      .catch((error) => ({ status: "unavailable", events: [], error: errorMessage(error) }))
    return toJsonValue({
      status: factory?.status ?? "unavailable",
      events_appended: factory?.events_appended ?? null,
      snapshot: factory?.snapshot ?? null,
      events_status: events.status,
      events_error: events.error,
      events: events.events,
    }) ?? null
  }

  async listRemoteProjects(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("hosted_ops")
    void emitFeatureUsed("remote_sync")
    const tick = optionalBoolean(args, "tick") ?? false
    const runtime = tick
      ? await stackdRuntimeTick().catch(() => undefined)
      : await readStackRuntimeFactory()
    const runtimeProjects = remoteProjectsMcpFromRuntime(runtime?.snapshot, config)
    if (runtimeProjects) return runtimeProjects
    const snapshot = await readRemoteProjectsPanelSnapshot(config)
    return toJsonValue({
      environment: config.environmentName,
      source: "direct-api",
      status: snapshot.status,
      message: snapshot.message,
      checked_at: snapshot.checkedAt,
      count: snapshot.projects.length,
      tag_scope: snapshot.tagScope
        ? {
            scope_id: snapshot.tagScope.scopeId,
            name: snapshot.tagScope.name,
            status: snapshot.tagScope.status,
            is_default: snapshot.tagScope.isDefault,
            factory_id: snapshot.tagScope.factoryId,
            default_project_id: snapshot.tagScope.defaultProjectId,
          }
        : null,
      projects: snapshot.projects.map((project) => ({
        project_id: project.projectId,
        name: project.name,
        alias: project.alias,
        updated_at: project.updatedAt,
        active_run_id: project.activeRunId,
        experiments_last_7d: project.experimentsLast7Days,
        experiments_last_7d_capped: project.experimentsLast7DaysCapped ?? false,
        live_runs: project.runs.filter((run) => isActiveState(run.state)).map((run) => ({
          run_id: run.runId,
          project_id: run.projectId,
          state: run.state,
          phase: run.phase,
          runbook: run.runbook,
          updated_at: run.updatedAt,
          reason: run.reason,
        })),
        recent_runs: project.runs.map((run) => ({
          run_id: run.runId,
          project_id: run.projectId,
          state: run.state,
          phase: run.phase,
          runbook: run.runbook,
          updated_at: run.updatedAt,
          reason: run.reason,
        })),
        factories: project.factories.map((factory) => ({
          factory_id: factory.factoryId,
          name: factory.name,
          kind: factory.kind,
          status: factory.status,
          canonical_project_id: factory.canonicalProjectId,
          latest_project_id: factory.latestProjectId,
          latest_run_id: factory.latestRunId,
          has_cloud_dev_env: factory.hasCloudDevEnv ?? null,
          cloud_dev_label: factory.cloudDevLabel,
          is_running: factory.isRunning ?? false,
          active_efforts: factory.activeEfforts ?? 0,
          next_wake_at: factory.nextWakeAt,
        })),
      })),
    }) ?? null
  }

  async createRunnableProject(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("hosted_ops")
    void emitFeatureUsed("remote_sync")
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const request = optionalJsonObject(args, "request")
    if (!request) {
      throw new RpcError(-32602, "request is required and must match SmrRunnableProjectCreateRequest")
    }
    const result = await createRemoteRunnableProject(config, request as RemoteProjectCreateRequest)
    const projectId = remoteActionEntityId(result, ["project_id", "projectId", "id"])
    const effortRefRecord = result.ok
      ? this.recordOptionalCloudActionEffortRef(config, effortRef, { system: "project", id: projectId, role: "created" })
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_project.created",
      source: "lever.stack_mcp",
      subject: { kind: "remote_project", id: projectId ?? String(request.name ?? "unknown") },
      correlation: { project_id: projectId ?? undefined },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ok: result.ok,
        status: result.status,
        message: result.message,
        project_id: projectId ?? null,
      },
    })
    return toJsonValue({
      ok: result.ok,
      status: result.status,
      message: result.message,
      environment: config.environmentName,
      api_base_url: config.environment.apiBaseUrl,
      project_id: projectId ?? null,
      effort_ref: toJsonValue(effortRefRecord) ?? null,
      runtime_event: runtimeEvent,
      ...(result.data ? { response: result.data } : {}),
      receipt: result.ok ? "lever.remote_project.created" : null,
    }) ?? null
  }

  async createFactory(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("hosted_ops")
    void emitFeatureUsed("remote_sync")
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const request: RemoteFactoryCreateRequest = {
      ...(optionalJsonObject(args, "request") ?? {}),
    } as RemoteFactoryCreateRequest
    const name = optionalString(args, "name")
    if (name) request.name = name
    const description = optionalString(args, "description")
    if (description) request.description = description
    const kind = optionalString(args, "kind")
    if (kind) request.kind = kind
    const status = optionalString(args, "status")
    if (status) request.status = status
    const budgetPolicy = optionalJsonObject(args, "budget_policy")
    if (budgetPolicy) request.budget_policy = budgetPolicy
    const capPolicy = optionalJsonObject(args, "cap_policy")
    if (capPolicy) request.cap_policy = capPolicy
    const homeostasisPolicy = optionalJsonObject(args, "homeostasis_policy")
    if (homeostasisPolicy) request.homeostasis_policy = homeostasisPolicy
    const publicationPolicy = optionalJsonObject(args, "publication_policy")
    if (publicationPolicy) request.publication_policy = publicationPolicy
    const authorizationPolicy = optionalJsonObject(args, "authorization_policy")
    if (authorizationPolicy) request.authorization_policy = authorizationPolicy
    const metadata = optionalJsonObject(args, "metadata")
    if (metadata) request.metadata = metadata
    if (!request.name || !String(request.name).trim()) {
      throw new RpcError(-32602, "name is required for /smr/factories")
    }
    const result = await createRemoteFactory(config, request)
    const factoryId = remoteActionEntityId(result, ["factory_id", "factoryId", "id"])
    const effortRefRecord = result.ok
      ? this.recordOptionalCloudActionEffortRef(config, effortRef, { system: "factory", id: factoryId, role: "created" })
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_factory.created",
      source: "lever.stack_mcp",
      subject: { kind: "remote_factory", id: factoryId ?? request.name },
      correlation: { factory_id: factoryId ?? undefined },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ok: result.ok,
        status: result.status,
        message: result.message,
        factory_id: factoryId ?? null,
      },
    })
    return toJsonValue({
      ok: result.ok,
      status: result.status,
      message: result.message,
      environment: config.environmentName,
      api_base_url: config.environment.apiBaseUrl,
      factory_id: factoryId ?? null,
      effort_ref: toJsonValue(effortRefRecord) ?? null,
      runtime_event: runtimeEvent,
      ...(result.data ? { response: result.data } : {}),
      receipt: result.ok ? "lever.remote_factory.created" : null,
    }) ?? null
  }

  async prepareCloudPromotionPacket(args: JsonObject): Promise<JsonValue> {
    const { packet } = await this.buildCloudPromotionPacket(args)
    return toJsonValue(packet) ?? null
  }

  async launchCloudPromotion(args: JsonObject): Promise<JsonValue> {
    const { config, packet } = await this.buildCloudPromotionPacket(args)
    const dryRun = optionalBoolean(args, "dry_run") ?? true
    const confirm = optionalBoolean(args, "confirm") ?? false
    if (dryRun) {
      const runtimeEvent = await recordRuntimeLeverEvent({
        event_type: "lever.cloud_promotion.prepared",
        source: "lever.stack_mcp",
        subject: {
          kind: "cloud_promotion_packet",
          id: packet.task_id ?? packet.created_at,
        },
        correlation: {},
        payload: {
          environment: config.environmentName,
          api_base_url: config.environment.apiBaseUrl,
          dry_run: true,
          has_runtime_snapshot: packet.runtime.status !== "unavailable",
        },
      })
      return toJsonValue({
        ok: true,
        status: 0,
        dry_run: true,
        message: "promotion packet prepared; no cloud launch was created",
        promotion_packet: packet,
        runtime_event: runtimeEvent,
      }) ?? null
    }
    if (!confirm) {
      return {
        ok: false,
        status: 0,
        message: "confirm=true is required when dry_run=false",
      }
    }
    const taskId = optionalString(args, "task_id") ?? packet.task_id ?? undefined
    const objective = optionalString(args, "objective")
    const launchObjective = objective ?? (taskId ? `Continue Stack cloud promotion task ${taskId}` : undefined)
    if (!launchObjective) {
      throw new RpcError(-32602, "objective is required when dry_run=false unless task_id is available to derive one")
    }
    const metadata = optionalJsonObject(args, "metadata") ?? {}
    const result = await createRemoteLaunch(config, {
      ...(optionalString(args, "project_id") ? { project_id: optionalString(args, "project_id") } : {}),
      ...(taskId ? { task_id: taskId } : {}),
      objective: launchObjective,
      ...(optionalString(args, "runbook") ? { runbook: optionalString(args, "runbook") } : {}),
      metadata: {
        ...metadata,
        source: "stack_mcp",
        ...(taskId ? { source_task_id: taskId } : {}),
        promotion_packet: packet,
      },
    })
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.cloud_promotion.launched",
      source: "lever.stack_mcp",
      subject: {
        kind: "cloud_launch",
        id: remoteLaunchRunId(result) ?? taskId ?? objective ?? packet.created_at,
      },
      correlation: {
        project_id: optionalString(args, "project_id") ?? undefined,
        run_id: remoteLaunchRunId(result) ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        objective: launchObjective,
        ok: result.ok,
        status: result.status,
        message: result.message,
        dry_run: false,
      },
    })
    return actionResultWithData(result, { dry_run: false, promotion_packet: packet, runtime_event: runtimeEvent })
  }

  async requestRemoteSync(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("remote_sync")
    const direction = requiredString(args, "direction")
    if (direction !== "push" && direction !== "pull") {
      throw new RpcError(-32602, "direction must be push or pull")
    }
    const intent = requiredString(args, "intent")
    const actorRole = optionalString(args, "actor_role") ?? "remote_gardener"
    if (actorRole !== "remote_gardener" && actorRole !== "gardener" && actorRole !== "operator") {
      throw new RpcError(-32602, "actor_role must be remote_gardener, gardener, or operator")
    }
    const projectId = optionalString(args, "project_id")
    const runId = optionalString(args, "run_id")
    const factoryId = optionalString(args, "factory_id")
    const deploymentId = optionalString(args, "deployment_id")
    const threadId = optionalString(args, "thread_id")
    const metaThreadId = optionalString(args, "meta_thread_id")
    const subject = remoteSyncSubject({
      projectId,
      runId,
      factoryId,
      deploymentId,
      metaThreadId,
      intent,
    })
    const eventType = `lever.remote.${direction}_requested` as `lever.${string}`
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: eventType,
      source: "lever.remote_gardener",
      subject,
      correlation: {
        stack_session_id: threadId ?? undefined,
        project_id: projectId ?? undefined,
        run_id: runId ?? undefined,
        factory_id: factoryId ?? undefined,
        deployment_id: deploymentId ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        direction,
        intent,
        actor_role: actorRole,
        actor_id: optionalString(args, "actor_id") ?? actorRole,
        thread_id: threadId ?? null,
        meta_thread_id: metaThreadId ?? null,
        project_id: projectId ?? null,
        run_id: runId ?? null,
        factory_id: factoryId ?? null,
        deployment_id: deploymentId ?? null,
        note: optionalString(args, "note") ?? null,
        source: "stack_remote_sync_request",
      },
    })
    return toJsonValue({
      ok: runtimeEvent.ok,
      receipt: eventType,
      direction,
      intent,
      subject,
      runtime_event: runtimeEvent,
    }) ?? null
  }

  async handoffRemoteGardener(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("remote_sync")
    const threadId = requiredString(args, "thread_id")
    const reason = requiredString(args, "reason")
    const actorRole = optionalString(args, "actor_role") ?? "gardener"
    if (actorRole !== "gardener" && actorRole !== "operator") {
      throw new RpcError(-32602, "actor_role must be gardener or operator")
    }
    const actorId = optionalString(args, "actor_id") ?? (actorRole === "gardener" ? "gardener_default" : "operator")
    const remoteGardenerId = optionalString(args, "remote_gardener_id") ?? "remote_gardener_default"
    const metaThreadId = optionalString(args, "meta_thread_id")
    const projectId = optionalString(args, "project_id")
    const runId = optionalString(args, "run_id")
    const factoryId = optionalString(args, "factory_id")
    const deploymentId = optionalString(args, "deployment_id")
    ensureRemoteGardenerActorState(config.stackDataRoot, threadId, remoteGardenerId)
    const observedAt = new Date().toISOString()
    const handoffEvent = {
      event_id: stackEventId("remote_gardener_handoff"),
      type: "gardener.remote_handoff_requested",
      thread_id: threadId,
      observed_at: observedAt,
      actor_id: actorId,
      actor_role: actorRole === "gardener" ? "gardener" as const : "system" as const,
      meta_thread_id: metaThreadId,
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        reason,
        note: optionalString(args, "note") ?? null,
        actor_role: actorRole,
        actor_id: actorId,
        remote_gardener_id: remoteGardenerId,
        project_id: projectId ?? null,
        run_id: runId ?? null,
        factory_id: factoryId ?? null,
        deployment_id: deploymentId ?? null,
        source: "stack_remote_gardener_handoff",
      },
    }
    const triggerEvent = {
      event_id: stackEventId("remote_gardener_trigger_queued"),
      type: "remote_gardener.trigger_queued",
      thread_id: threadId,
      observed_at: observedAt,
      actor_id: remoteGardenerId,
      actor_role: "remote_gardener" as const,
      meta_thread_id: metaThreadId,
      payload: {
        wake_reason: "local_gardener_handoff",
        reason,
        trigger_event_ids: [handoffEvent.event_id],
        queued_for: "remote-gardener-pass",
        requested_by_actor_role: actorRole,
        requested_by_actor_id: actorId,
        project_id: projectId ?? null,
        run_id: runId ?? null,
        factory_id: factoryId ?? null,
        deployment_id: deploymentId ?? null,
        source: "stack_remote_gardener_handoff",
      },
    }
    const handoffPath = appendThreadMetaEvent(config.stackDataRoot, handoffEvent)
    appendThreadMetaEvent(config.stackDataRoot, triggerEvent)
    const subject = remoteGardenerHandoffSubject({
      actorId: remoteGardenerId,
      projectId,
      runId,
      factoryId,
      deploymentId,
      metaThreadId,
    })
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_gardener.wake_requested",
      source: "lever.gardener",
      subject,
      correlation: {
        stack_session_id: threadId,
        project_id: projectId ?? undefined,
        run_id: runId ?? undefined,
        factory_id: factoryId ?? undefined,
        deployment_id: deploymentId ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        actor_role: actorRole,
        actor_id: actorId,
        remote_gardener_id: remoteGardenerId,
        thread_id: threadId,
        meta_thread_id: metaThreadId ?? null,
        project_id: projectId ?? null,
        run_id: runId ?? null,
        factory_id: factoryId ?? null,
        deployment_id: deploymentId ?? null,
        reason,
        note: optionalString(args, "note") ?? null,
        handoff_event_id: handoffEvent.event_id,
        trigger_event_id: triggerEvent.event_id,
        source: "stack_remote_gardener_handoff",
      },
    })
    return toJsonValue({
      ok: runtimeEvent.ok,
      receipt: "lever.remote_gardener.wake_requested",
      thread_id: threadId,
      meta_thread_id: metaThreadId ?? null,
      remote_gardener_id: remoteGardenerId,
      handoff_event: {
        event_id: handoffEvent.event_id,
        event_type: handoffEvent.type,
        thread_event_log_path: handoffPath,
      },
      trigger_event: {
        event_id: triggerEvent.event_id,
        event_type: triggerEvent.type,
        thread_event_log_path: handoffPath,
      },
      runtime_event: runtimeEvent,
    }) ?? null
  }

  async recordRemoteGardenerPass(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("remote_sync")
    const actorRole = optionalString(args, "actor_role") ?? "remote_gardener"
    if (actorRole !== "remote_gardener" && actorRole !== "gardener" && actorRole !== "operator") {
      throw new RpcError(-32602, "actor_role must be remote_gardener, gardener, or operator")
    }
    const actorId = optionalString(args, "actor_id") ?? actorRole
    const threadId = optionalString(args, "thread_id")
    const metaThreadId = optionalString(args, "meta_thread_id")
    const projectId = optionalString(args, "project_id")
    const runId = optionalString(args, "run_id")
    const factoryId = optionalString(args, "factory_id")
    const deploymentId = optionalString(args, "deployment_id")
    const tick = optionalBoolean(args, "tick") ?? false
    const runtime = tick
      ? await stackdRuntimeTick().catch(errorToRuntimeUnavailable)
      : await readStackRuntimeFactory()
    const pass = remoteGardenerPassDigest(runtime, config, optionalString(args, "note"))
    const subject = remoteGardenerPassSubject({
      actorId,
      projectId,
      runId,
      factoryId,
      deploymentId,
      metaThreadId,
    })
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_gardener.pass_recorded",
      source: "lever.remote_gardener",
      subject,
      correlation: {
        stack_session_id: threadId ?? undefined,
        project_id: projectId ?? undefined,
        run_id: runId ?? undefined,
        factory_id: factoryId ?? undefined,
        deployment_id: deploymentId ?? undefined,
      },
      payload: {
        environment: pass.environment,
        api_base_url: pass.api_base_url,
        actor_role: actorRole,
        actor_id: actorId,
        thread_id: threadId ?? null,
        meta_thread_id: metaThreadId ?? null,
        project_id: projectId ?? null,
        run_id: runId ?? null,
        factory_id: factoryId ?? null,
        deployment_id: deploymentId ?? null,
        tick,
        pass,
        source: "stack_remote_gardener_pass",
      },
    })
    let threadWakeEvent: Record<string, unknown> | null = null
    if (threadId && actorRole === "remote_gardener") {
      const triggerEventIds = unconsumedRemoteGardenerTriggerIds(
        readThreadMetaEvents(config.stackDataRoot, threadId),
        actorId,
      )
      if (triggerEventIds.length > 0) {
        ensureRemoteGardenerActorState(config.stackDataRoot, threadId, actorId)
        const event = {
          event_id: stackEventId("remote_gardener_wake"),
          type: "remote_gardener.wake",
          thread_id: threadId,
          observed_at: new Date().toISOString(),
          actor_id: actorId,
          actor_role: "remote_gardener" as const,
          meta_thread_id: metaThreadId,
          payload: {
            wake_reason: "local_gardener_handoff",
            trigger_event_ids: triggerEventIds,
            runtime_event: runtimeEvent,
            source: "stack_remote_gardener_pass",
          },
        }
        const path = appendThreadMetaEvent(config.stackDataRoot, event)
        threadWakeEvent = {
          event_id: event.event_id,
          event_type: event.type,
          thread_event_log_path: path,
        }
      }
    }
    let threadEvent: Record<string, unknown> | null = null
    if (threadId) {
      const event = {
        event_id: stackEventId("remote_gardener_pass"),
        type: "remote_gardener.sync_narrated",
        thread_id: threadId,
        observed_at: new Date().toISOString(),
        actor_id: actorId,
        actor_role: threadActorRole(actorRole),
        meta_thread_id: metaThreadId,
        payload: {
          ...pass,
          runtime_event: runtimeEvent,
          source: "stack_remote_gardener_pass",
        },
      }
      const path = appendThreadMetaEvent(config.stackDataRoot, event)
      threadEvent = {
        event_id: event.event_id,
        event_type: event.type,
        thread_event_log_path: path,
      }
    }
    return toJsonValue({
      ok: runtimeEvent.ok,
      receipt: "lever.remote_gardener.pass_recorded",
      pass,
      runtime_event: runtimeEvent,
      thread_wake_event: threadWakeEvent,
      thread_event: threadEvent,
    }) ?? null
  }

  async inferenceCatalog(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("synth_inference")
    return toJsonValue(await readRemoteInferenceCatalog(config)) ?? null
  }

  async inferenceUsage(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("synth_inference")
    return toJsonValue(await readRemoteInferenceUsage(config)) ?? null
  }

  async launchPromoStatus(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("cloud_launch_promo")
    return actionResultWithData(await getRemoteLaunchPromoStatus(config))
  }

  async claimLaunchPromo(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("cloud_launch_promo")
    if (args.confirm !== true) {
      return {
        ok: false,
        status: 0,
        message: "confirm=true is required to claim launch promo entitlement",
        data: null,
      }
    }
    return actionResultWithData(await claimRemoteLaunchPromo(config))
  }

  async getCloudLaunch(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const result = await getRemoteLaunch(config, runId)
    return actionResultWithData(result)
  }

  async terminateCloudLaunch(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const result = await terminateRemoteLaunch(config, runId, {
      ...(optionalString(args, "reason") ? { reason: optionalString(args, "reason") } : {}),
    })
    return actionResultWithData(result)
  }

  async listRunInteractions(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const run = remoteRunRef(args)
    const statusFilter = optionalString(args, "status_filter")
    const [questions, approvals] = await Promise.all([
      listRemoteRunQuestions(config, run, statusFilter),
      listRemoteRunApprovals(config, run, statusFilter),
    ])
    return toJsonValue({
      environment: config.environmentName,
      run_id: run.runId,
      project_id: run.projectId ?? null,
      questions: remoteActionPayload(questions),
      approvals: remoteActionPayload(approvals),
    }) ?? null
  }

  async respondRunQuestion(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const run = remoteRunRef(args)
    const questionId = requiredString(args, "question_id")
    const responseText = requiredString(args, "response_text")
    const result = await respondRemoteRunQuestion(config, run, questionId, responseText)
    const effortRefRecord = result.ok
      ? this.recordOptionalRunInteractionEffortRef(config, effortRef, run.runId, "question-response", run.projectId)
      : null
    return actionResultWithData(result, { effort_ref: effortRefRecord })
  }

  async decideRunApproval(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const run = remoteRunRef(args)
    const approvalId = requiredString(args, "approval_id")
    const decision = requiredApprovalDecision(args)
    const result = await decideRemoteRunApproval(config, run, approvalId, decision, optionalString(args, "comment"))
    const effortRefRecord = result.ok
      ? this.recordOptionalRunInteractionEffortRef(config, effortRef, run.runId, "approval-decision", run.projectId)
      : null
    return actionResultWithData(result, { effort_ref: effortRefRecord })
  }

  private async buildCloudPromotionPacket(args: JsonObject): Promise<{
    config: StackConfig
    packet: {
      schema: string
      created_at: string
      source: string
      environment: {
        name: string
        api_base_url: string
      }
      project_id: string | null
      task_id: string | null
      objective: string | null
      runbook: string | null
      metadata: Record<string, unknown>
      runtime: {
        status: string
        snapshot: unknown
      }
    }
  }> {
    const config = await this.config(args)
    const runtime = await readStackRuntimeFactory()
    const taskId = optionalString(args, "task_id") ?? null
    return {
      config,
      packet: {
        schema: "stack.cloud_promotion_packet.v1",
        created_at: new Date().toISOString(),
        source: "stack_mcp",
        environment: {
          name: config.environmentName,
          api_base_url: config.environment.apiBaseUrl,
        },
        project_id: optionalString(args, "project_id") ?? null,
        task_id: taskId,
        objective: optionalString(args, "objective") ?? null,
        runbook: optionalString(args, "runbook") ?? null,
        metadata: optionalJsonObject(args, "metadata") ?? {},
        runtime: {
          status: runtime?.status ?? "unavailable",
          snapshot: runtime?.snapshot ?? null,
        },
      },
    }
  }

  async getRunArtifactStatus(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const status = await readRunHostedArtifactStatus(config, runId)
    const prefer = optionalString(args, "prefer") ?? "hosted"
    const targetUrl = prefer === "public_shell" && status.publicUrl ? status.publicUrl : status.hostedUrl ?? status.publicUrl
    return {
      run_id: status.runId,
      status: status.status,
      hosted_url: status.hostedUrl ?? null,
      public_url: status.publicUrl ?? null,
      slug: status.slug ?? null,
      visibility: status.visibility ?? null,
      url_status: status.urlStatus ?? null,
      message: status.message ?? null,
      target_url: targetUrl ?? null,
    }
  }

  async listHostedArtifacts(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const limit = optionalInteger(args, "limit") ?? 100
    if (limit < 1 || limit > 500) throw new RpcError(-32602, "limit must be between 1 and 500")
    const snapshot = await readHostedArtifacts(config, {
      projectId: optionalString(args, "project_id"),
      limit,
    })
    return {
      environment: snapshot.environmentName,
      api_base_url: snapshot.apiBaseUrl,
      status: snapshot.status,
      message: snapshot.message ?? null,
      project_id: snapshot.projectId ?? null,
      checked_at: snapshot.checkedAt,
      count: snapshot.artifacts.length,
      artifacts: snapshot.artifacts.map(hostedArtifactToMcp),
    }
  }

  async listContainerPools(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const limit = optionalInteger(args, "limit") ?? 100
    if (limit < 1 || limit > 500) throw new RpcError(-32602, "limit must be between 1 and 500")
    const snapshot = await readContainerPools(config, {
      limit,
      state: optionalString(args, "state"),
    })
    return {
      environment: snapshot.environmentName,
      api_base_url: snapshot.apiBaseUrl,
      status: snapshot.status,
      message: snapshot.message ?? null,
      state: snapshot.state ?? null,
      checked_at: snapshot.checkedAt,
      next_cursor: snapshot.nextCursor ?? null,
      count: snapshot.pools.length,
      pools: snapshot.pools.map((pool) => ({
        pool_id: pool.poolId,
        name: pool.name ?? null,
        type: pool.type ?? null,
        status: pool.status ?? null,
        state: pool.state ?? null,
        adapter: pool.adapter ?? null,
        container_url: pool.containerUrl ?? null,
        task_count: pool.taskCount ?? null,
        created_at: pool.createdAt ?? null,
        updated_at: pool.updatedAt ?? null,
      })),
    }
  }

  async containerHealth(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const poolId = requiredString(args, "pool_id")
    const taskId = optionalString(args, "task_id")
    const result = await readContainerPoolHealth(config, { poolId, taskId })
    return {
      ok: result.ok,
      status: result.status,
      environment: result.environmentName,
      api_base_url: result.apiBaseUrl,
      pool_id: result.poolId,
      task_id: result.taskId ?? null,
      message: result.message,
      health: toJsonValue(result.data ?? {}) ?? {},
    }
  }

  async containerRollout(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const poolId = requiredString(args, "pool_id")
    const taskId = optionalString(args, "task_id")
    const body = requiredJsonObject(args, "body")
    const timeoutSeconds = optionalInteger(args, "timeout_seconds")
    if (timeoutSeconds !== undefined && (timeoutSeconds < 5 || timeoutSeconds > 900)) {
      throw new RpcError(-32602, "timeout_seconds must be between 5 and 900")
    }
    const result = await executeContainerPoolRollout(config, {
      poolId,
      taskId,
      body,
      timeoutSeconds,
    })
    return {
      ok: result.ok,
      status: result.status,
      environment: result.environmentName,
      api_base_url: result.apiBaseUrl,
      pool_id: result.poolId,
      task_id: result.taskId ?? null,
      message: result.message,
      response: toJsonValue(result.data ?? {}) ?? {},
    }
  }

  async deployContainerPoolRuntime(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("hosted_ops")
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const poolId = requiredString(args, "pool_id")
    const taskId = optionalString(args, "task_id")
    const result = await deployContainerPoolRuntimeImage(config, {
      poolId,
      ...(taskId ? { taskId } : {}),
      body: containerPoolRuntimeReleaseRequest(args),
    })
    const effortRefRecord = result.ok
      ? this.recordOptionalCloudActionEffortRef(config, effortRef, {
        system: "container-pool",
        id: result.releaseId ?? poolId,
        role: result.releaseId ? "runtime-release" : "runtime-deploy",
      })
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.container_pool.runtime_deployed",
      source: "lever.stack_mcp",
      subject: { kind: "container_pool", id: poolId },
      correlation: {
        deployment_id: result.releaseId ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ok: result.ok,
        status: result.status,
        message: result.message,
        pool_id: poolId,
        task_id: taskId ?? null,
        release_id: result.releaseId ?? null,
      },
    })
    return toJsonValue({
      ok: result.ok,
      status: result.status,
      environment: result.environmentName,
      api_base_url: result.apiBaseUrl,
      pool_id: poolId,
      task_id: taskId ?? null,
      release_id: result.releaseId ?? null,
      effort_ref: effortRefRecord,
      message: result.message,
      release: result.release ?? null,
      binding: result.binding ?? null,
      runtime_event: runtimeEvent,
      ...(result.data ? { response: result.data } : {}),
      receipt: result.ok ? "lever.container_pool.runtime_deployed" : null,
    }) ?? null
  }

  async openHostedArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const prefer = (optionalString(args, "prefer") ?? "hosted") as "hosted" | "public_shell"
    const status = await readRunHostedArtifactStatus(config, runId)
    const url = prefer === "public_shell" && status.publicUrl ? status.publicUrl : status.hostedUrl ?? status.publicUrl
    if (!url) {
      return {
        ok: false,
        run_id: runId,
        status: status.status,
        message: status.message || "no hosted or public url for run",
      }
    }
    const headStatus = await headUrlStatus(url)
    if (headStatus === undefined || headStatus < 200 || headStatus >= 300) {
      return {
        ok: false,
        run_id: runId,
        opened_url: null,
        target_url: url,
        prefer,
        status: status.status,
        visibility: status.visibility ?? null,
        head_status: headStatus ?? null,
        message: headStatus === undefined ? "artifact URL HEAD precheck failed" : `artifact URL HEAD returned ${headStatus}`,
        receipt: null,
      }
    }
    const openRes = await openUrlInSystemBrowser(url)
    return {
      ok: openRes.ok,
      run_id: runId,
      opened_url: url,
      prefer,
      status: status.status,
      visibility: status.visibility ?? null,
      head_status: headStatus,
      message: openRes.message,
      receipt: openRes.ok ? `RECEIPT PASS hosted_url=${headStatus} [Open artifact ↗]` : null,
    }
  }

  async createArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const result = await writeStackArtifactPage(config, {
      slug: requiredString(args, "slug"),
      title: requiredString(args, "title"),
      kind: optionalString(args, "kind"),
      effort: optionalString(args, "effort"),
      pagePath: optionalString(args, "page_path"),
      htmlPath: optionalString(args, "html_path"),
      dataPath: optionalString(args, "data_path"),
    })
    return {
      ok: result.served.ok,
      artifact: toJsonValue(result.artifact) ?? null,
      local_url: result.localUrl,
      gallery_url: artifactGalleryUrl(),
      page_path: result.pagePath,
      data_path: result.dataPath,
      html_path: result.htmlPath ?? null,
      served: toJsonValue(result.served) ?? null,
      receipt: result.served.ok ? `RECEIPT PASS local_artifact_url=${result.localUrl}` : null,
    }
  }

  async updateArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const result = await writeStackArtifactPage(config, {
      slug: requiredString(args, "slug"),
      title: optionalString(args, "title"),
      kind: optionalString(args, "kind"),
      effort: optionalString(args, "effort"),
      pagePath: optionalString(args, "page_path"),
      htmlPath: optionalString(args, "html_path"),
      dataPath: optionalString(args, "data_path"),
      update: true,
    })
    return {
      ok: result.served.ok,
      artifact: toJsonValue(result.artifact) ?? null,
      local_url: result.localUrl,
      gallery_url: artifactGalleryUrl(),
      page_path: result.pagePath,
      data_path: result.dataPath,
      html_path: result.htmlPath ?? null,
      served: toJsonValue(result.served) ?? null,
      receipt: result.served.ok ? `RECEIPT PASS local_artifact_url=${result.localUrl}` : null,
    }
  }

  async listArtifacts(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const status = await readStackArtifactStatus(config)
    return {
      ok: true,
      running: status.running,
      gallery_url: status.galleryUrl,
      site_dir: status.siteDir,
      manifest_path: status.manifestPath,
      manifest_entries: status.manifestEntries,
      artifacts: toJsonValue(status.artifacts) ?? [],
      message: status.message,
    }
  }

  async openArtifact(args: JsonObject): Promise<JsonValue> {
    const slug = optionalString(args, "slug")
    const url = slug ? artifactLocalUrl(slug) : artifactGalleryUrl()
    const result = await openUrlInSystemBrowser(url)
    return {
      ok: result.ok,
      slug: slug ?? null,
      opened_url: result.ok ? url : null,
      target_url: url,
      message: result.message,
      receipt: result.ok ? `RECEIPT PASS local_artifact_url=${url}` : null,
    }
  }

  async lintArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const result = lintStackArtifact(config, requiredString(args, "slug"))
    return {
      ok: result.ok,
      artifact: result.artifact ? toJsonValue(result.artifact) ?? null : null,
      errors: result.errors,
      warnings: result.warnings,
      sha256: result.sha256 ?? null,
      bytes: result.bytes ?? null,
    }
  }

  async publishArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const result = await publishStackArtifact(config, {
      slug: requiredString(args, "slug"),
      visibility: optionalArtifactVisibility(args, "visibility"),
      projectId: optionalString(args, "project_id"),
      hostedEffortId: optionalString(args, "hosted_effort_id"),
      sourceRunIds: optionalStringArray(args, "source_run_ids"),
      traceId: optionalString(args, "trace_id"),
      confirmPublish: optionalBoolean(args, "confirm_publish") ?? false,
    })
    return toJsonValue(result) ?? null
  }

  async shareArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const result = await shareStackArtifact(config, {
      slug: requiredString(args, "slug"),
      visibility: optionalArtifactVisibility(args, "visibility"),
      projectId: optionalString(args, "project_id"),
      hostedEffortId: optionalString(args, "hosted_effort_id"),
      sourceRunIds: optionalStringArray(args, "source_run_ids"),
      traceId: optionalString(args, "trace_id"),
      publicSlug: optionalString(args, "public_slug"),
      confirmPublish: optionalBoolean(args, "confirm_publish") ?? false,
      confirmPublic: optionalBoolean(args, "confirm_public") ?? false,
    })
    return toJsonValue(result) ?? null
  }

  async recordEffortArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = requiredString(args, "effort_ref")
    const slug = requiredString(args, "slug")
    const artifact = readLatestStackArtifacts(config).find((entry) => entry.slug === slug)
    if (!artifact) throw new RpcError(-32602, `artifact page not found: ${slug}`)
    const result = recordStackEffortArtifact({
      stackDataRoot: config.stackDataRoot,
      workspaceRoot: config.workspaceRoot,
      effortRef,
      slug: artifact.slug,
      title: artifact.title,
      localUrl: artifact.local_url,
      hostedUrl: artifact.hosted_url,
      publicUrl: artifact.public_url,
      hostedArtifactId: artifact.hosted_artifact_id,
      artifactVersion: artifact.artifact_version ? String(artifact.artifact_version) : undefined,
      sha256: artifact.compiled_sha256 ?? artifact.sha256,
      splitsCited: optionalStringArray(args, "splits_cited") ?? artifact.splits_cited ?? [],
      sourcePath: join(stackArtifactsRoot(config), artifact.page_path),
      body: optionalString(args, "body"),
      filename: optionalString(args, "filename"),
    })
    return toJsonValue(await this.effortPayload(config, result.effort, {
      source_kind: "artifact.webpage",
      slug: result.slug,
      local_url: result.localUrl ?? null,
      hosted_url: result.hostedUrl ?? null,
      public_url: result.publicUrl ?? null,
      hosted_artifact_id: result.hostedArtifactId ?? null,
      artifact_version: result.artifactVersion ?? null,
      sha256: result.sha256 ?? null,
      splits_cited: result.splitsCited,
      path: result.path,
      relative_path: relative(result.effort.folder_path, result.path),
      receipt: "lever.stack_mcp effort.artifact_webpage_recorded",
    })) ?? null
  }

  async listFactories(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("hosted_ops")
    const tick = optionalBoolean(args, "tick") ?? false
    const runtime = tick
      ? await stackdRuntimeTick().catch(() => undefined)
      : await readStackRuntimeFactory()
    const runtimeFactories = factoriesMcpFromRuntime(runtime?.snapshot, config)
    if (runtimeFactories) return runtimeFactories
    const snapshot = await readRemoteResearchSnapshot(config)
    return toJsonValue({
      environment: config.environmentName,
      source: "direct-api",
      status: snapshot.status,
      message: snapshot.message,
      count: snapshot.factories.length,
      factories: snapshot.factories.map((factory) => ({
        factory_id: factory.factoryId,
        name: factory.name,
        kind: factory.kind,
        status: factory.status,
        canonical_project_id: factory.canonicalProjectId,
        latest_project_id: factory.latestProjectId,
        latest_run_id: factory.latestRunId,
        latest_work_product_id: factory.latestWorkProductId,
        next_wake_at: factory.nextWakeAt,
        active_efforts: factory.activeEfforts ?? 0,
        paused_or_waiting: factory.pausedOrWaiting ?? 0,
      })),
    }) ?? null
  }

  async listHostedOptimizerRuns(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    void emitFeatureUsed("hosted_ops")
    const tick = optionalBoolean(args, "tick") ?? false
    const runtime = tick
      ? await stackdRuntimeTick().catch(() => undefined)
      : await readStackRuntimeFactory()
    const runtimeOptimizers = hostedOptimizersMcpFromRuntime(runtime?.snapshot, config)
    if (runtimeOptimizers) return runtimeOptimizers
    const snapshot = await readHostedOptimizerSnapshot(config)
    return toJsonValue({
      environment: config.environmentName,
      source: "direct-api",
      status: snapshot.status,
      message: snapshot.message,
      count: snapshot.runs.length,
      runs: snapshot.runs.map((run) => {
        const detail = snapshot.runDetails[run.runId]
        return {
          run_id: run.runId,
          project_id: run.projectId,
          algorithm: run.algorithm,
          status: run.status,
          finalize_state: run.finalizeState,
          cancellation_requested: run.cancellationRequested ?? false,
          updated_at: run.updatedAt,
          artifact_names: detail?.artifactNames ?? [],
          event_count: detail?.eventCount ?? 0,
          event_types: detail?.eventTypes ?? [],
          detail_message: detail?.message,
        }
      }),
    }) ?? null
  }

  async launchLocalGepa(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const rawConfigPath = requiredString(args, "config_path")
    const configPath = resolve(config.workingDir, rawConfigPath)
    if (!existsSync(configPath)) {
      throw new RpcError(-32602, `config_path does not exist: ${configPath}`)
    }
    const result = await launchLocalGepaRun(config, {
      configPath,
      requestId: optionalString(args, "request_id"),
      metadata: optionalJsonObject(args, "metadata"),
      startService: optionalBoolean(args, "start_service") ?? true,
    })
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      service: {
        status: result.service.status,
        service_url: result.service.serviceUrl,
        db_path: result.service.dbPath,
        pid: result.service.pid ?? null,
        pid_alive: result.service.pidAlive ?? null,
      },
      container: result.container
        ? {
            url: result.container.url,
            pid: result.container.pid ?? null,
            log_path: result.container.logPath,
          }
        : null,
      run: result.run
        ? {
            run_id: result.run.runId,
            request_id: result.run.requestId ?? null,
            status: result.run.status,
            phase: result.run.phase ?? null,
            generation: result.run.generation ?? null,
            candidate_count: result.run.candidateCount ?? null,
            best_candidate_id: result.run.bestCandidateId ?? null,
            config_path: result.run.configPath ?? null,
          }
        : null,
      response: toJsonValue(result.response ?? {}) ?? {},
    }
  }

  async submitHostedOptimizer(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const rawConfigPath = requiredString(args, "config_path")
    const configPath = resolve(config.workingDir, rawConfigPath)
    if (!existsSync(configPath)) {
      throw new RpcError(-32602, `config_path does not exist: ${configPath}`)
    }
    const tunnelProvider = optionalString(args, "tunnel_provider")
    const allowedTunnelProviders = ["auto", "synth_tunnel", "cloudflared", "ngrok"] as const
    if (tunnelProvider && !allowedTunnelProviders.includes(tunnelProvider as HostedGepaTunnelProvider)) {
      throw new RpcError(-32602, "tunnel_provider must be auto, synth_tunnel, cloudflared, or ngrok")
    }
    const tunnelTtlSeconds = optionalInteger(args, "tunnel_ttl_seconds")
    if (tunnelTtlSeconds !== undefined && (tunnelTtlSeconds < 60 || tunnelTtlSeconds > 86400)) {
      throw new RpcError(-32602, "tunnel_ttl_seconds must be between 60 and 86400")
    }
    const timeoutSeconds = optionalInteger(args, "timeout_seconds")
    if (timeoutSeconds !== undefined && (timeoutSeconds < 30 || timeoutSeconds > 86400)) {
      throw new RpcError(-32602, "timeout_seconds must be between 30 and 86400")
    }
    const tunnelUrl = optionalString(args, "tunnel_url")
    const follow = optionalBoolean(args, "follow")
    if (tunnelUrl && follow === false) {
      throw new RpcError(-32602, "tunnel_url requires follow=true so the SynthTunnel lease stays open")
    }
    const containerPool = optionalString(args, "container_pool")
    const containerTaskId = optionalString(args, "container_task_id")
    if (containerTaskId && !containerPool) {
      throw new RpcError(-32602, "container_task_id requires container_pool")
    }

    const result = await submitHostedGepaRun(config, {
      configPath,
      runId: optionalString(args, "run_id"),
      idempotencyKey: optionalString(args, "idempotency_key"),
      projectId: optionalString(args, "project_id"),
      tunnelUrl,
      tunnelProvider: tunnelProvider as HostedGepaTunnelProvider | undefined,
      tunnelTtlSeconds,
      containerPool,
      containerTaskId,
      follow,
      timeoutSeconds,
    })
    const projectId = optionalString(args, "project_id")
    const effortRefRecord = result.ok && result.runId
      ? this.recordOptionalCloudActionEffortRef(config, effortRef, { system: "optimizer", id: result.runId, role: "hosted-gepa" })
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.hosted_gepa.submit_requested",
      source: "lever.stack_mcp",
      subject: { kind: "hosted_optimizer_run", id: result.runId ?? configPath },
      correlation: {
        optimizer_run_id: result.runId,
        project_id: projectId,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        config_path: configPath,
        tunnel_provider: tunnelProvider ?? (tunnelUrl ? "synth_tunnel" : null),
        has_tunnel_url: Boolean(tunnelUrl),
        container_pool: containerPool ?? null,
        container_task_id: containerTaskId ?? null,
        follow: result.args.includes("--follow"),
        ok: result.ok,
        status: result.status,
        message: result.message,
      },
    })
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      environment: result.environmentName,
      api_base_url: result.apiBaseUrl,
      run_id: result.runId ?? null,
      command: result.command,
      args: result.args,
      exit_code: result.exitCode ?? null,
      signal: result.signal ?? null,
      timed_out: result.timedOut,
      stdout_tail: result.stdout,
      stderr_tail: result.stderr,
      submitted_at: result.submittedAt,
      finished_at: result.finishedAt,
      effort_ref: toJsonValue(effortRefRecord) ?? null,
      runtime_event: toJsonValue(runtimeEvent) ?? null,
    }
  }

  async submitHostedOptimizerRun(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const algorithm = requiredHostedOptimizerAlgorithm(args, "algorithm")
    const configJson = optionalJsonObject(args, "config_json")
    const configToml = optionalString(args, "config_toml")
    if (!configJson && !configToml) {
      throw new RpcError(-32602, "config_json or config_toml is required")
    }
    const timeoutSeconds = optionalInteger(args, "timeout_seconds")
    if (timeoutSeconds !== undefined && (timeoutSeconds < 30 || timeoutSeconds > 86400)) {
      throw new RpcError(-32602, "timeout_seconds must be between 30 and 86400")
    }
    const result = await submitHostedOptimizerRun(config, {
      algorithm,
      runId: optionalString(args, "run_id"),
      idempotencyKey: optionalString(args, "idempotency_key"),
      projectId: optionalString(args, "project_id"),
      configToml,
      configJson,
      containerPool: optionalJsonObject(args, "container_pool"),
      timeoutSeconds,
    })
    const projectId = optionalString(args, "project_id")
    const effortRefRecord = result.ok && result.runId
      ? this.recordOptionalCloudActionEffortRef(config, effortRef, {
        system: "optimizer",
        id: result.runId,
        role: algorithm === "online-reflexion" ? "hosted-online-reflexion" : `hosted-${algorithm}`,
      })
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.hosted_optimizer.submit_requested",
      source: "lever.stack_mcp",
      subject: { kind: "hosted_optimizer_run", id: result.runId ?? optionalString(args, "run_id") ?? algorithm },
      correlation: {
        optimizer_run_id: result.runId ?? optionalString(args, "run_id"),
        project_id: projectId,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        algorithm,
        project_id: projectId ?? null,
        has_config_json: Boolean(configJson),
        has_config_toml: Boolean(configToml),
        has_container_pool: Boolean(args.container_pool),
        ok: result.ok,
        status: result.status,
        message: result.message,
      },
    })
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      environment: result.environmentName,
      api_base_url: result.apiBaseUrl,
      algorithm: result.algorithm,
      run_id: result.runId ?? null,
      submitted_at: result.submittedAt,
      finished_at: result.finishedAt,
      effort_ref: toJsonValue(effortRefRecord) ?? null,
      runtime_event: toJsonValue(runtimeEvent) ?? null,
      response: toJsonValue(result.response ?? {}) ?? {},
    }
  }

  async messageLiveRun(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const runId = requiredString(args, "run_id")
    const body = requiredString(args, "body")
    const projectId = optionalString(args, "project_id")
    const result = await sendRemoteRunMessage(config, { runId, projectId, state: "unknown" }, body)
    const effortRefRecord = result.ok
      ? this.recordOptionalRunInteractionEffortRef(config, effortRef, runId, "message-sent", projectId)
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_smr.run.message_sent",
      source: "lever.stack_mcp",
      subject: { kind: "remote_smr_run", id: runId },
      correlation: { run_id: runId, project_id: projectId ?? undefined },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ok: result.ok,
        status: result.status,
        message: result.message,
        body_preview: body.slice(0, 160),
      },
    })
    return actionResultWithData(result, { runtime_event: runtimeEvent, effort_ref: effortRefRecord })
  }

  async messageFactoryProject(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const factoryId = requiredString(args, "factory_id")
    const body = requiredString(args, "body")
    const projectId = optionalString(args, "project_id")
    let factory: RemoteFactorySummary = {
      factoryId,
      name: optionalString(args, "factory_name") ?? factoryId,
      canonicalProjectId: projectId,
    }
    if (!projectId) {
      const snapshot = await readRemoteResearchSnapshot(config)
      factory = snapshot.factories.find((item) => item.factoryId === factoryId) ?? factory
    }
    const result = await sendRemoteFactoryMessage(config, factory, body)
    const effectiveProjectId = projectId ?? factory.canonicalProjectId ?? factory.latestProjectId
    const effortRefRecord = result.ok
      ? this.recordOptionalFactoryActionEffortRef(config, effortRef, factoryId, "message-sent", effectiveProjectId)
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_factory.message_sent",
      source: "lever.stack_mcp",
      subject: { kind: "remote_factory", id: factoryId },
      correlation: {
        factory_id: factoryId,
        project_id: effectiveProjectId ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ok: result.ok,
        status: result.status,
        message: result.message,
        body_preview: body.slice(0, 160),
      },
    })
    return actionResultWithData(result, { runtime_event: runtimeEvent, effort_ref: effortRefRecord })
  }

  async wakeFactory(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const confirm = optionalBoolean(args, "confirm") ?? false
    if (!confirm) {
      return {
        ok: false,
        status: 0,
        message: "confirm=true is required to wake a Factory",
      }
    }
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const factoryId = requiredString(args, "factory_id")
    const projectId = optionalString(args, "project_id")
    let factory: RemoteFactorySummary = {
      factoryId,
      name: optionalString(args, "factory_name") ?? factoryId,
      canonicalProjectId: projectId,
    }
    if (!projectId) {
      const snapshot = await readRemoteResearchSnapshot(config)
      factory = snapshot.factories.find((item) => item.factoryId === factoryId) ?? factory
    }
    const result = await wakeRemoteFactoryDue(config, factory)
    const effectiveProjectId = projectId ?? factory.canonicalProjectId ?? factory.latestProjectId
    const effortRefRecord = result.ok
      ? this.recordOptionalFactoryActionEffortRef(config, effortRef, factoryId, "wake-requested", effectiveProjectId)
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_factory.wake_requested",
      source: "lever.stack_mcp",
      subject: { kind: "remote_factory", id: factoryId },
      correlation: {
        factory_id: factoryId,
        project_id: effectiveProjectId ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        action: "wake-factory",
        dry_run: false,
        ok: result.ok,
        status: result.status,
        message: result.message,
        factory_name: factory.name,
      },
    })
    return actionResultWithData(result, { runtime_event: runtimeEvent, effort_ref: effortRefRecord })
  }

  async controlFactory(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const action = requiredString(args, "action")
    if (action !== "pause-factory" && action !== "resume-factory") {
      throw new RpcError(-32602, "action must be pause-factory or resume-factory")
    }
    const confirm = optionalBoolean(args, "confirm") ?? false
    if (!confirm) {
      return {
        ok: false,
        status: 0,
        message: "confirm=true is required to pause or resume a Factory",
      }
    }
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const factoryId = requiredString(args, "factory_id")
    const projectId = optionalString(args, "project_id")
    let factory: RemoteFactorySummary = {
      factoryId,
      name: optionalString(args, "factory_name") ?? factoryId,
      canonicalProjectId: projectId,
    }
    if (!projectId) {
      const snapshot = await readRemoteResearchSnapshot(config)
      factory = snapshot.factories.find((item) => item.factoryId === factoryId) ?? factory
    }
    const result = await executeRemoteFactoryAction(config, factory, action)
    const effectiveProjectId = projectId ?? factory.canonicalProjectId ?? factory.latestProjectId
    const effortRefRecord = result.ok
      ? this.recordOptionalFactoryActionEffortRef(
        config,
        effortRef,
        factoryId,
        action === "pause-factory" ? "paused" : "resumed",
        effectiveProjectId,
      )
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: `lever.remote_factory.${action === "pause-factory" ? "paused" : "resumed"}` as `lever.${string}`,
      source: "lever.stack_mcp",
      subject: { kind: "remote_factory", id: factoryId },
      correlation: {
        factory_id: factoryId,
        project_id: effectiveProjectId ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        action,
        ok: result.ok,
        status: result.status,
        message: result.message,
        factory_name: factory.name,
      },
    })
    return actionResultWithData(result, { runtime_event: runtimeEvent, effort_ref: effortRefRecord })
  }

  async controlLiveRun(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const action = requiredString(args, "action")
    if (action !== "pause-run" && action !== "resume-run" && action !== "stop-run") {
      throw new RpcError(-32602, "action must be pause-run, resume-run, or stop-run")
    }
    const run: RemoteSmrRunSummary = {
      runId,
      projectId: optionalString(args, "project_id"),
      state: "unknown",
    }
    const result = await executeRemoteRunAction(config, run, action)
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: `lever.remote_smr.run.${action.replace("-run", "").replace("-", "_")}` as `lever.${string}`,
      source: "lever.stack_mcp",
      subject: { kind: "remote_smr_run", id: runId },
      correlation: { run_id: runId, project_id: run.projectId ?? undefined },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        action,
        ok: result.ok,
        status: result.status,
        message: result.message,
      },
    })
    return actionResultWithData(result, { runtime_event: runtimeEvent })
  }

  async cancelHostedOptimizer(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const result = await cancelHostedOptimizerRun(config, {
      runId,
      algorithm: "unknown",
      status: "unknown",
    })
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.hosted_optimizer.cancel_requested",
      source: "lever.stack_mcp",
      subject: { kind: "hosted_optimizer_run", id: runId },
      correlation: { optimizer_run_id: runId },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ok: result.ok,
        status: result.status,
        message: result.message,
      },
    })
    return actionResultWithData(result, { runtime_event: runtimeEvent })
  }

  async previewHostedOptimizerArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const artifactName = requiredString(args, "artifact_name")
    const maxBytes = optionalInteger(args, "max_bytes") ?? 8192
    if (maxBytes < 1 || maxBytes > 65536) throw new RpcError(-32602, "max_bytes must be between 1 and 65536")
    const result = await previewHostedOptimizerArtifact(
      config,
      { runId, algorithm: "unknown", status: "unknown" },
      artifactName,
      maxBytes,
    )
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      artifact_name: artifactName,
      ...(result.data ? { preview_result: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async auditOnlineReflexionReceipt(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const runId = requiredString(args, "run_id")
    const strict = optionalBoolean(args, "strict") ?? false
    const result = await auditOnlineReflexionReceipt(config, { runId, strict })
    const auditStatus = hostedOptimizerAuditStatus(result.data)
    const effortEvidence = result.ok && effortRef
      ? recordStackEffortRunEvidence({
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
        effortRef,
        runKind: "optimizer",
        title: "Online Reflexion receipt audit",
        runId,
        metric: `receipt-audit:${auditStatus ?? "unknown"}`,
        body: hostedOptimizerAuditEvidenceBody(
          `Online Reflexion receipt audit for hosted optimizer run ${runId}.`,
          result.data,
        ),
      })
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.hosted_optimizer.online_reflexion_receipt_audit_read",
      source: "lever.stack_mcp",
      subject: { kind: "hosted_optimizer_run", id: runId },
      correlation: { optimizer_run_id: runId },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        strict,
        ok: result.ok,
        status: result.status,
        audit_status: auditStatus ?? null,
        message: result.message,
      },
    })
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      strict,
      audit_status: auditStatus ?? null,
      effort_evidence: effortEvidence ? {
        effort_id: effortEvidence.effort.manifest.id,
        slug: effortEvidence.effort.manifest.slug,
        path: relative(effortEvidence.effort.folder_path, effortEvidence.path),
        run_kind: effortEvidence.runKind,
        run_id: effortEvidence.runId ?? null,
        metric: effortEvidence.metric ?? null,
      } : null,
      runtime_event: toJsonValue(runtimeEvent) ?? null,
      ...(result.data ? { audit: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async auditOnlineReflexionReceiptSet(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const runIds = optionalStringArray(args, "run_ids")?.map((runId) => runId.trim()).filter(Boolean)
    if (runIds && runIds.length > 100) throw new RpcError(-32602, "run_ids must contain at most 100 items")
    const limit = optionalInteger(args, "limit")
    if (limit !== undefined && (limit < 1 || limit > 100)) {
      throw new RpcError(-32602, "limit must be between 1 and 100")
    }
    const strict = optionalBoolean(args, "strict") ?? false
    const layerId = optionalString(args, "layer_id")
    const projectId = optionalString(args, "project_id")
    const result = await auditOnlineReflexionReceiptSet(config, {
      runIds,
      layerId,
      projectId,
      strict,
      limit,
    })
    const auditStatus = hostedOptimizerAuditStatus(result.data)
    const effortEvidence = result.ok && effortRef
      ? recordStackEffortFinding({
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
        effortRef,
        kind: "proof",
        title: "Online Reflexion aggregate receipt audit",
        body: hostedOptimizerAuditEvidenceBody(
          "Online Reflexion aggregate receipt audit for a hosted optimizer publish-candidate set.",
          result.data,
        ),
      })
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.hosted_optimizer.online_reflexion_receipt_audit_set_read",
      source: "lever.stack_mcp",
      subject: { kind: "hosted_optimizer_receipt_set", id: runIds?.join(",") || layerId || projectId || "recent" },
      correlation: {
        optimizer_run_id: runIds?.[0],
        project_id: projectId ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        run_ids: runIds ?? [],
        layer_id: layerId ?? null,
        project_id: projectId ?? null,
        strict,
        limit: limit ?? null,
        ok: result.ok,
        status: result.status,
        audit_status: auditStatus ?? null,
        message: result.message,
      },
    })
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_ids: runIds ?? [],
      layer_id: layerId ?? null,
      project_id: projectId ?? null,
      strict,
      limit: limit ?? null,
      audit_status: auditStatus ?? null,
      effort_evidence: effortEvidence ? {
        effort_id: effortEvidence.effort.manifest.id,
        slug: effortEvidence.effort.manifest.slug,
        path: relative(effortEvidence.effort.folder_path, effortEvidence.path),
      } : null,
      runtime_event: toJsonValue(runtimeEvent) ?? null,
      ...(result.data ? { audit: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async buildOnlineReflexionEvidencePacket(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const runIds = optionalStringArray(args, "run_ids")?.map((runId) => runId.trim()).filter(Boolean)
    if (runIds && runIds.length > 100) throw new RpcError(-32602, "run_ids must contain at most 100 items")
    const limit = optionalInteger(args, "limit")
    if (limit !== undefined && (limit < 1 || limit > 100)) {
      throw new RpcError(-32602, "limit must be between 1 and 100")
    }
    const layerId = optionalString(args, "layer_id")
    const projectId = optionalString(args, "project_id")
    const evidenceNotes = optionalJsonObject(args, "evidence_notes")
    const blogDecisionOwner = optionalString(args, "blog_decision_owner")
    const blogApprovedByOwner = optionalBoolean(args, "blog_approved_by_owner") ?? false
    const includeReceiptSummaries = optionalBoolean(args, "include_receipt_summaries")
    const result = await buildOnlineReflexionEvidencePacket(config, {
      runIds,
      layerId,
      projectId,
      evidenceNotes,
      blogDecisionOwner,
      blogApprovedByOwner,
      includeReceiptSummaries,
      limit,
    })
    const packet = result.data
    const packetRecord = packet
    const packetStatus = hostedOptimizerAuditStatus(packetRecord)
    const effortEvidence = result.ok && effortRef
      ? recordStackEffortFinding({
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
        effortRef,
        kind: "proof",
        title: "Online Reflexion release evidence packet",
        body: hostedOptimizerAuditEvidenceBody(
          "Online Reflexion release evidence packet for hosted optimizer claim review.",
          packetRecord,
        ),
      })
      : null
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.hosted_optimizer.online_reflexion_evidence_packet_read",
      source: "lever.stack_mcp",
      subject: { kind: "hosted_optimizer_evidence_packet", id: runIds?.join(",") || layerId || projectId || "recent" },
      correlation: {
        optimizer_run_id: runIds?.[0],
        project_id: projectId ?? undefined,
      },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        run_ids: runIds ?? [],
        layer_id: layerId ?? null,
        project_id: projectId ?? null,
        limit: limit ?? null,
        packet_status: packetStatus ?? null,
        public_copy_allowed: packetRecord?.public_copy_allowed === true,
        ok: result.ok,
        status: result.status,
        message: result.message,
      },
    })
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_ids: runIds ?? [],
      layer_id: layerId ?? null,
      project_id: projectId ?? null,
      packet_status: packetStatus ?? null,
      effort_evidence: effortEvidence ? {
        effort_id: effortEvidence.effort.manifest.id,
        slug: effortEvidence.effort.manifest.slug,
        path: relative(effortEvidence.effort.folder_path, effortEvidence.path),
      } : null,
      runtime_event: toJsonValue(runtimeEvent) ?? null,
      ...(packet ? { evidence_packet: toJsonValue(packet) ?? null } : {}),
    }
  }

  async downloadHostedOptimizerArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const runId = requiredString(args, "run_id")
    const artifactName = requiredString(args, "artifact_name")
    const result = await downloadHostedOptimizerArtifact(
      config,
      { runId, algorithm: "unknown", status: "unknown" },
      artifactName,
    )
    const effortEvidence = result.ok && effortRef
      ? recordStackEffortRunEvidence({
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
        effortRef,
        runKind: "optimizer",
        title: "Downloaded hosted optimizer artifact",
        runId,
        artifactName,
        metric: "downloaded",
        body: `Downloaded hosted optimizer artifact ${artifactName} from run ${runId} through Stack MCP.`,
      })
      : null
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      artifact_name: artifactName,
      effort_evidence: effortEvidence ? {
        effort_id: effortEvidence.effort.manifest.id,
        slug: effortEvidence.effort.manifest.slug,
        path: relative(effortEvidence.effort.folder_path, effortEvidence.path),
        run_kind: effortEvidence.runKind,
        run_id: effortEvidence.runId ?? null,
        artifact_name: effortEvidence.artifactName ?? null,
      } : null,
      ...(result.data ? { download_result: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async downloadRunOutput(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const effortRef = optionalString(args, "effort_ref")
    this.optionalEffort(config, effortRef)
    const runId = requiredString(args, "run_id")
    const projectId = optionalString(args, "project_id")
    const outputKind = optionalOutputKind(args, "output_kind")
    const outputId = optionalString(args, "output_id")
    const index = optionalInteger(args, "index") ?? 0
    if (index < 0) throw new RpcError(-32602, "index must be 0 or greater")

    const snapshot = await readRemoteResearchSnapshot(config)
    const snapshotRun = snapshot.jobs.find((item) => item.runId === runId)
    const run: RemoteSmrRunSummary = {
      ...(snapshotRun ?? { runId, state: "unknown" }),
      projectId: projectId ?? snapshotRun?.projectId,
    }
    const detail = snapshot.runDetails[runId] ?? (await readRemoteRunDetail(config, run))
    const selection = selectRemoteOutput(run, detail, outputKind, outputId, index)
    if (!selection) {
      return {
        ok: false,
        status: 0,
        message: "no matching WorkProduct or artifact found",
        run_id: runId,
        work_product_count: detail.workProductCount,
        artifact_count: detail.artifactCount,
      }
    }

    const result = await downloadRemoteOutput(config, selection)
    const selectedId = selectedOutputId(selection)
    const effortEvidence = result.ok && effortRef
      ? recordStackEffortRunEvidence({
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
        effortRef,
        runKind: "smr",
        title: `Downloaded ${selection.kind} from SMR run`,
        runId,
        projectId: run.projectId,
        outputId: selectedId,
        metric: "downloaded",
        body: `Downloaded ${selection.kind} ${selectedId} from SMR run ${runId} through Stack MCP.`,
      })
      : null
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      output_kind: selection.kind,
      output_id: selectedId,
      output_label: selectedOutputLabel(selection),
      effort_evidence: effortEvidence ? {
        effort_id: effortEvidence.effort.manifest.id,
        slug: effortEvidence.effort.manifest.slug,
        path: relative(effortEvidence.effort.folder_path, effortEvidence.path),
        run_kind: effortEvidence.runKind,
        run_id: effortEvidence.runId ?? null,
        project_id: effortEvidence.projectId ?? null,
        output_id: effortEvidence.outputId ?? null,
      } : null,
      ...(result.data ? { download_result: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async listRunWorkProducts(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const projectId = optionalString(args, "project_id")
    const snapshot = await readRemoteResearchSnapshot(config)
    const snapshotRun = snapshot.jobs.find((item) => item.runId === runId)
    const run: RemoteSmrRunSummary = {
      ...(snapshotRun ?? { runId, state: "unknown" }),
      projectId: projectId ?? snapshotRun?.projectId,
    }
    const detail = snapshot.runDetails[runId] ?? (await readRemoteRunDetail(config, run))
    return {
      environment: config.environmentName,
      api_base_url: config.environment.apiBaseUrl,
      run_id: runId,
      project_id: run.projectId ?? null,
      count: detail.workProducts.length,
      work_products: detail.workProducts.map((workProduct) => ({
        work_product_id: workProduct.workProductId,
        kind: workProduct.kind ?? null,
        title: workProduct.title ?? null,
        status: workProduct.status ?? null,
        readiness: workProduct.readiness ?? null,
        artifact_id: workProduct.artifactId ?? null,
        created_at: workProduct.createdAt ?? null,
      })),
      message: detail.message ?? null,
    }
  }

  async downloadWorkProduct(args: JsonObject): Promise<JsonValue> {
    const runId = requiredString(args, "run_id")
    const workProductId = requiredString(args, "work_product_id")
    return await this.downloadRunOutput({
      ...args,
      run_id: runId,
      output_kind: "work-product",
      output_id: workProductId,
    })
  }

  async previewRunOutput(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const projectId = optionalString(args, "project_id")
    const outputKind = optionalOutputKind(args, "output_kind")
    const outputId = optionalString(args, "output_id")
    const index = optionalInteger(args, "index") ?? 0
    const maxBytes = optionalInteger(args, "max_bytes") ?? 8192
    if (index < 0) throw new RpcError(-32602, "index must be 0 or greater")
    if (maxBytes < 1 || maxBytes > 65536) throw new RpcError(-32602, "max_bytes must be between 1 and 65536")

    const snapshot = await readRemoteResearchSnapshot(config)
    const snapshotRun = snapshot.jobs.find((item) => item.runId === runId)
    const run: RemoteSmrRunSummary = {
      ...(snapshotRun ?? { runId, state: "unknown" }),
      projectId: projectId ?? snapshotRun?.projectId,
    }
    const detail = snapshot.runDetails[runId] ?? (await readRemoteRunDetail(config, run))
    const selection = selectRemoteOutput(run, detail, outputKind, outputId, index)
    if (!selection) {
      return {
        ok: false,
        status: 0,
        message: "no matching WorkProduct or artifact found",
        run_id: runId,
        work_product_count: detail.workProductCount,
        artifact_count: detail.artifactCount,
      }
    }

    const result = await previewRemoteOutput(config, selection, maxBytes)
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      output_kind: selection.kind,
      output_id: selectedOutputId(selection),
      output_label: selectedOutputLabel(selection),
      ...(result.data ? { preview_result: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async listSavedDownloads(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const downloads = await readRemoteDownloadHistory(config)
    return {
      environment: config.environmentName,
      count: downloads.length,
      downloads: downloads.map((download, index) => ({
        index,
        environment_name: download.environmentName,
        run_id: download.runId,
        output_kind: download.kind,
        output_id: download.outputId,
        label: download.label,
        path: download.path,
        filename: download.filename,
        bytes: download.bytes,
        downloaded_at: download.downloadedAt,
      })),
    }
  }

  async previewSavedDownload(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const maxBytes = optionalInteger(args, "max_bytes") ?? 8192
    if (maxBytes < 1 || maxBytes > 65536) throw new RpcError(-32602, "max_bytes must be between 1 and 65536")
    const downloads = await readRemoteDownloadHistory(config)
    const runId = optionalString(args, "run_id")
    const outputId = optionalString(args, "output_id")
    const path = optionalString(args, "path")
    const record = selectSavedDownload(downloads, {
      index: optionalInteger(args, "index") ?? 0,
      ...(runId ? { runId } : {}),
      ...(outputId ? { outputId } : {}),
      ...(path ? { path } : {}),
    })
    if (!record) {
      return {
        ok: false,
        status: 0,
        message: "no matching saved download found",
        download_count: downloads.length,
      }
    }
    const result = await previewSavedRemoteDownload(config, record, maxBytes)
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: record.runId,
      output_kind: record.kind,
      output_id: record.outputId,
      output_label: record.label,
      path: record.path,
      ...(result.data ? { preview_result: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async uploadRunFile(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const localPath = requiredString(args, "local_path")
    const resolvedLocalPath = resolve(config.workingDir, localPath)
    const remotePath = optionalString(args, "remote_path")
    const visibility = optionalFileVisibility(args, "visibility")
    const result = await uploadRemoteRunFile(config, {
      run: { runId, state: "unknown" },
      localPath: resolvedLocalPath,
      remotePath,
      contentType: optionalString(args, "content_type"),
      visibility,
      kind: optionalString(args, "kind"),
      metadata: {
        stack_tool: "stack_upload_run_file",
      },
    })
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_smr.run_file.upload_requested",
      source: "lever.stack_mcp",
      subject: { kind: "remote_smr_run", id: runId },
      correlation: { run_id: runId },
      payload: {
        environment: config.environmentName,
        api_base_url: config.environment.apiBaseUrl,
        ok: result.ok,
        status: result.status,
        message: result.message,
        remote_path: remotePath,
        visibility: visibility ?? "model",
      },
    })
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      local_path: resolvedLocalPath,
      ...(remotePath ? { remote_path: remotePath } : {}),
      visibility: visibility ?? "model",
      runtime_event: toJsonValue(runtimeEvent) ?? null,
      ...(result.data ? { upload_result: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async pullArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const artifactKind = requiredRoundTripArtifactKind(args, "artifact_kind")
    const result = await pullRoundTripArtifact(config, {
      artifactKind,
      sourceKind: optionalRoundTripSourceKind(args, "source"),
      runId: optionalString(args, "run_id"),
      projectId: optionalString(args, "project_id"),
      artifactName: optionalString(args, "artifact_name"),
      sourcePath: optionalString(args, "source_path"),
      savedDownloadPath: optionalString(args, "saved_download_path"),
      outputId: optionalString(args, "output_id"),
      index: optionalInteger(args, "index"),
      destinationPath: optionalString(args, "destination_path"),
      receiptPath: optionalString(args, "receipt_path"),
    })
    return toJsonValue(result) ?? null
  }

  async applyArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const artifactKind = requiredRoundTripArtifactKind(args, "artifact_kind")
    const result = await applyRoundTripArtifact(config, {
      artifactKind,
      artifactPath: optionalString(args, "artifact_path"),
      receiptPath: optionalString(args, "receipt_path"),
      targetPath: requiredString(args, "target_path"),
      mode: optionalRoundTripApplyMode(args, "mode"),
      tomlField: optionalString(args, "toml_field"),
      promptJsonPath: optionalString(args, "prompt_json_path"),
      createMissing: optionalBoolean(args, "create_missing"),
    })
    return toJsonValue(result) ?? null
  }

  async pushArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const artifactKind = requiredRoundTripArtifactKind(args, "artifact_kind")
    const result = await pushRoundTripArtifact(config, {
      artifactKind,
      artifactPath: optionalString(args, "artifact_path"),
      receiptPath: optionalString(args, "receipt_path"),
      runId: requiredString(args, "run_id"),
      remotePath: optionalString(args, "remote_path"),
      visibility: optionalFileVisibility(args, "visibility"),
      contentType: optionalString(args, "content_type"),
    })
    return toJsonValue(result) ?? null
  }

  async queryLogs(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const limit = optionalInteger(args, "limit") ?? 100
    if (limit < 1 || limit > 500) throw new RpcError(-32602, "limit must be between 1 and 500")
    const minutes = optionalInteger(args, "minutes") ?? 60
    if (minutes < 1 || minutes > 10_080) throw new RpcError(-32602, "minutes must be between 1 and 10080")
    const result = await queryStackLogs(config, {
      slot: optionalString(args, "slot"),
      query: optionalString(args, "query"),
      eventDomain: optionalString(args, "event_domain"),
      service: optionalString(args, "service"),
      runId: optionalString(args, "run_id"),
      threadId: optionalString(args, "thread_id"),
      minutes,
      limit,
      timeoutSeconds: optionalInteger(args, "timeout_seconds") ?? 20,
    })
    return toJsonValue({
      ...result,
      hits: result.records.map((record) => ({
        time: record._time ?? record.timestamp ?? null,
        msg: record._msg ?? record.message ?? null,
        fields: record,
      })),
    }) ?? null
  }

  async runWithLogs(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const command = requiredString(args, "command")
    const argv = optionalStringArray(args, "args") ?? []
    const cwd = resolve(config.workingDir, optionalString(args, "cwd") ?? ".")
    const runId = optionalString(args, "run_id") ?? `harnesscmd_${Date.now()}`
    const timeoutSeconds = clampNumber(optionalInteger(args, "timeout_seconds") ?? 300, 1, 3600)
    const tailBytes = clampNumber(optionalInteger(args, "tail_bytes") ?? 4000, 0, 20000)
    const startedAt = new Date().toISOString()
    projectHarnessCommandEvent(config.appRoot, {
      eventType: "command.start",
      phase: "started",
      runId,
      command,
      argv,
      cwd,
      startedAt,
    })
    const startedMs = Date.now()
    const proc = Bun.spawn([command, ...argv], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const timeout = setTimeout(() => proc.kill(), timeoutSeconds * 1000)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).finally(() => clearTimeout(timeout))
    const durationMs = Date.now() - startedMs
    const completedAt = new Date().toISOString()
    const timedOut = durationMs >= timeoutSeconds * 1000 && exitCode !== 0
    projectHarnessCommandEvent(config.appRoot, {
      eventType: exitCode === 0 ? "command.exit" : "command.failed",
      phase: "completed",
      runId,
      command,
      argv,
      cwd,
      startedAt,
      completedAt,
      durationMs,
      exitCode,
      timedOut,
      stdoutTail: tailText(stdout, tailBytes),
      stderrTail: tailText(stderr, tailBytes),
    })
    return toJsonValue({
      ok: exitCode === 0,
      run_id: runId,
      service: "harness-cmd",
      event_domain: "local_optimizer",
      command,
      args: argv,
      cwd,
      exit_code: exitCode,
      duration_ms: durationMs,
      timed_out: timedOut,
      stdout_tail: tailText(stdout, tailBytes),
      stderr_tail: tailText(stderr, tailBytes),
    }) ?? null
  }

  async listSkills(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const query = optionalString(args, "query")
    const limit = optionalInteger(args, "limit") ?? 100
    if (limit < 1 || limit > 500) throw new RpcError(-32602, "limit must be between 1 and 500")
    const skills = query
      ? searchStackSkills(config.appRoot, query, { workspaceRoot: config.workspaceRoot, limit })
      : discoverStackSkills(config.appRoot, { workspaceRoot: config.workspaceRoot }).slice(0, limit)
    return {
      count: skills.length,
      skills: skills.map(skillToJson),
    }
  }

  async readSkill(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const skillId = requiredString(args, "skill_id")
    const maxBytes = optionalInteger(args, "max_bytes") ?? 50_000
    if (maxBytes < 1 || maxBytes > 200_000) throw new RpcError(-32602, "max_bytes must be between 1 and 200000")
    const result = readStackSkill(config.appRoot, skillId, { workspaceRoot: config.workspaceRoot, maxBytes })
    if (!result) throw new RpcError(-32602, `unknown skill_id: ${skillId}`)
    const threadId = optionalString(args, "thread_id")
    const actorId = optionalString(args, "actor_id")
    const actorRole = optionalActorRole(args)
    let threadEventLogPath: string | undefined
    let eventId: string | undefined
    if (threadId) {
      eventId = stackEventId("skill_read")
      threadEventLogPath = appendThreadMetaEvent(config.stackDataRoot, {
        event_id: eventId,
        type: "skill.read",
        thread_id: threadId,
        observed_at: new Date().toISOString(),
        actor_id: actorId,
        actor_role: actorRole,
        payload: {
          skill_id: result.skill.skillId,
          skill_name: result.skill.name,
          source_path: result.skill.sourcePath,
          origin: result.skill.origin,
          max_bytes: maxBytes,
          truncated: result.truncated,
          content_bytes: Buffer.byteLength(result.content, "utf8"),
          reason: optionalString(args, "reason") ?? null,
        },
      })
    }
    return {
      skill: skillToJson(result.skill),
      content: result.content,
      truncated: result.truncated,
      ...(threadId ? { event_id: eventId, thread_event_log_path: threadEventLogPath } : {}),
    }
  }

  async searchSkills(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const query = requiredString(args, "query")
    const limit = optionalInteger(args, "limit") ?? 20
    if (limit < 1 || limit > 100) throw new RpcError(-32602, "limit must be between 1 and 100")
    const skills = searchStackSkills(config.appRoot, query, { workspaceRoot: config.workspaceRoot, limit })
    return {
      query,
      count: skills.length,
      skills: skills.map(skillToJson),
    }
  }

  async listGuidance(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const scope = optionalGuidanceScope(args)
    const styleLayer = optionalStyleLayer(args)
    const limit = optionalInteger(args, "limit") ?? 100
    if (limit < 1 || limit > 500) throw new RpcError(-32602, "limit must be between 1 and 500")
    const guidance = discoverStackGuidance(config.appRoot, {
      workspaceRoot: config.workspaceRoot,
      scope,
      styleLayer,
    }).slice(0, limit)
    return {
      count: guidance.length,
      scope: scope ?? "all",
      style_layer: styleLayer ?? "all",
      guidance: guidance.map(guidanceToJson),
    }
  }

  async searchGuidance(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const query = requiredString(args, "query")
    const scope = optionalGuidanceScope(args)
    const styleLayer = optionalStyleLayer(args)
    const limit = optionalInteger(args, "limit") ?? 20
    const maxExcerptBytes = optionalInteger(args, "max_excerpt_bytes") ?? 600
    if (limit < 1 || limit > 100) throw new RpcError(-32602, "limit must be between 1 and 100")
    if (maxExcerptBytes < 0 || maxExcerptBytes > 5000) {
      throw new RpcError(-32602, "max_excerpt_bytes must be between 0 and 5000")
    }
    const results = searchStackGuidance(config.appRoot, query, {
      workspaceRoot: config.workspaceRoot,
      scope,
      styleLayer,
      limit,
      maxExcerptBytes,
    })
    const threadId = optionalString(args, "thread_id")
    const actorId = optionalString(args, "actor_id")
    const actorRole = optionalActorRole(args)
    let threadEventLogPath: string | undefined
    let eventId: string | undefined
    if (threadId) {
      eventId = stackEventId("guidance_query")
      threadEventLogPath = appendThreadMetaEvent(config.stackDataRoot, {
        event_id: eventId,
        type: "guidance.query",
        thread_id: threadId,
        observed_at: new Date().toISOString(),
        actor_id: actorId,
        actor_role: actorRole,
        payload: {
          query,
          scope: scope ?? "all",
          style_layer: styleLayer ?? "all",
          hit_ids: results.map((item) => item.guidanceId),
          result_count: results.length,
        },
      })
    }
    const guidanceEvent = guidanceEventToJson(recordStackGuidanceEvent(config.appRoot, {
      eventType: "guidance.query",
      actorId,
      actorRole,
      threadId,
      payload: {
        query,
        scope: scope ?? "all",
        style_layer: styleLayer ?? "all",
        hit_ids: results.map((item) => item.guidanceId),
        result_count: results.length,
        thread_event_id: eventId ?? null,
      },
    }))
    return {
      query,
      scope: scope ?? "all",
      style_layer: styleLayer ?? "all",
      count: results.length,
      guidance_event: toJsonValue(guidanceEvent) ?? null,
      guidance: results.map((item) => ({
        ...guidanceToJson(item),
        score: item.score,
        excerpt: item.excerpt,
      })),
      ...(threadId ? { event_id: eventId, thread_event_log_path: threadEventLogPath } : {}),
    }
  }

  async readGuidance(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const guidanceId = requiredString(args, "guidance_id")
    const maxBytes = optionalInteger(args, "max_bytes") ?? 50_000
    if (maxBytes < 1 || maxBytes > 200_000) throw new RpcError(-32602, "max_bytes must be between 1 and 200000")
    const result = readStackGuidance(config.appRoot, guidanceId, { workspaceRoot: config.workspaceRoot, maxBytes })
    if (!result) throw new RpcError(-32602, `unknown guidance_id: ${guidanceId}`)
    const threadId = optionalString(args, "thread_id")
    const actorId = optionalString(args, "actor_id")
    const actorRole = optionalActorRole(args)
    let threadEventLogPath: string | undefined
    let eventId: string | undefined
    if (threadId) {
      eventId = stackEventId("guidance_read")
      threadEventLogPath = appendThreadMetaEvent(config.stackDataRoot, {
        event_id: eventId,
        type: "guidance.read",
        thread_id: threadId,
        observed_at: new Date().toISOString(),
        actor_id: actorId,
        actor_role: actorRole,
        payload: {
          guidance_id: result.item.guidanceId,
          source_path: result.item.sourcePath,
          origin: result.item.origin,
          scope: result.item.scope,
          max_bytes: maxBytes,
          truncated: result.truncated,
          content_bytes: Buffer.byteLength(result.content, "utf8"),
          reason: optionalString(args, "reason") ?? null,
        },
      })
    }
    const guidanceEvent = guidanceEventToJson(recordStackGuidanceEvent(config.appRoot, {
      eventType: "guidance.used",
      guidanceId: result.item.guidanceId,
      actorId,
      actorRole,
      threadId,
      reason: optionalString(args, "reason"),
      payload: {
        source_path: result.item.sourcePath,
        origin: result.item.origin,
        scope: result.item.scope,
        max_bytes: maxBytes,
        truncated: result.truncated,
        content_bytes: Buffer.byteLength(result.content, "utf8"),
        thread_event_id: eventId ?? null,
      },
    }))
    return {
      guidance: guidanceToJson(result.item),
      content: result.content,
      truncated: result.truncated,
      guidance_event: toJsonValue(guidanceEvent) ?? null,
      ...(threadId ? { event_id: eventId, thread_event_log_path: threadEventLogPath } : {}),
    }
  }

  async recordGuidanceEvent(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const eventType = requiredGuidanceEventType(args, "event_type")
    const guidanceId = optionalString(args, "guidance_id")
    const impact = optionalGuidanceImpact(args)
    const confidence = optionalConfidence(args)
    if (eventType === "guidance.impact_judged" && !impact) {
      throw new RpcError(-32602, "impact is required when event_type is guidance.impact_judged")
    }
    const event = recordStackGuidanceEvent(config.appRoot, {
      eventType,
      guidanceId,
      actorId: optionalString(args, "actor_id"),
      actorRole: optionalActorRole(args),
      threadId: optionalString(args, "thread_id"),
      impact,
      confidence,
      reason: optionalString(args, "reason"),
      evidenceEventIds: optionalStringArray(args, "evidence_event_ids") ?? [],
      payload: optionalJsonObject(args, "payload") ?? {},
    })
    return {
      ok: true,
      event: toJsonValue(guidanceEventToJson(event)) ?? null,
    }
  }

  async listGuidanceEvents(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const limit = optionalInteger(args, "limit") ?? 50
    if (limit < 1 || limit > 500) throw new RpcError(-32602, "limit must be between 1 and 500")
    const events = listStackGuidanceEvents(config.appRoot, {
      guidanceId: optionalString(args, "guidance_id"),
      eventType: optionalGuidanceEventType(args, "event_type"),
      threadId: optionalString(args, "thread_id"),
      limit,
    })
    return {
      count: events.length,
      events: toJsonValue(events.map(guidanceEventToJson)) ?? [],
    }
  }

  async listLocalThreads(_args: JsonObject): Promise<JsonValue> {
    const threads = await stackdThreads()
    return toJsonValue({ count: threads.length, threads }) ?? { count: 0, threads: [] }
  }

  async readLocalThread(args: JsonObject): Promise<JsonValue> {
    const threadId = requiredString(args, "thread_id")
    return toJsonValue({ thread: await stackdThread(threadId) }) ?? { thread: null }
  }

  async traceLocalThread(args: JsonObject): Promise<JsonValue> {
    const threadId = requiredString(args, "thread_id")
    return toJsonValue({ trace: await stackdTrace(threadId) }) ?? { trace: null }
  }

  async exportLocalThread(args: JsonObject): Promise<JsonValue> {
    const threadId = requiredString(args, "thread_id")
    return toJsonValue(await stackdExport(threadId)) ?? {}
  }

  async pushSkillContext(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const event = pushSkillContext(config.appRoot, {
      threadId: requiredString(args, "thread_id"),
      monitorActorId: requiredString(args, "monitor_actor_id"),
      targetActorId: requiredString(args, "target_actor_id"),
      skillId: requiredString(args, "skill_id"),
      reason: requiredString(args, "reason"),
      evidenceEventIds: optionalStringArray(args, "evidence_event_ids") ?? [],
      message: optionalString(args, "message"),
      workspaceRoot: config.workspaceRoot,
    })
    const threadEventLogPath = appendThreadMetaEvent(config.stackDataRoot, {
      event_id: event.eventId,
      type: "monitor.skill_context_push",
      thread_id: event.threadId,
      observed_at: event.createdAt,
      actor_id: event.monitorActorId,
      actor_role: "monitor",
      payload: {
        target_actor_id: event.targetActorId,
        skill_id: event.skillId,
        source_path: event.sourcePath,
        reason: event.reason,
        evidence_event_ids: event.evidenceEventIds,
        message_id: event.messageId,
      },
    })
    return toJsonValue({
      ok: true,
      event_type: "monitor.skill_context_push",
      event,
      thread_event_log_path: threadEventLogPath,
    }) ?? null
  }
}

function mcpToolFilterFromEnv(): McpToolFilter {
  return {
    allow: readMcpToolSet(process.env[MCP_TOOL_ALLOW_ENV] ?? process.env[MCP_TOOL_ALLOWED_TOOLS_ENV]),
    deny: readMcpToolSet(process.env[MCP_TOOL_DENY_ENV] ?? process.env[MCP_TOOL_DENIED_TOOLS_ENV]) ?? new Set(),
  }
}

function readMcpToolSet(value: string | undefined): Set<string> | undefined {
  if (value === undefined) return undefined
  const toolIds = value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (toolIds.length === 0) return undefined
  return new Set(toolIds)
}

function mcpToolAllowed(name: string, filter: McpToolFilter): boolean {
  if (filter.deny.has(name)) return false
  if (filter.allow && !filter.allow.has(name)) return false
  return true
}

function runDetailToMcp(detail: RemoteRunDetail): JsonObject {
  return toJsonValue({
    run_id: detail.runId,
    artifact_count: detail.artifactCount,
    work_product_count: detail.workProductCount,
    runtime_message_count: detail.runtimeMessageCount,
    pending_runtime_message_count: detail.pendingRuntimeMessageCount,
    file_mount_count: detail.fileMountCount,
    active_file_mount_count: detail.activeFileMountCount,
    artifact_types: detail.artifactTypes,
    work_product_kinds: detail.workProductKinds,
    artifacts: detail.artifacts.map((artifact) => ({
      artifact_id: artifact.artifactId,
      artifact_type: artifact.artifactType,
      title: artifact.title,
      created_at: artifact.createdAt,
    })),
    work_products: detail.workProducts.map((workProduct) => ({
      work_product_id: workProduct.workProductId,
      kind: workProduct.kind,
      title: workProduct.title,
      status: workProduct.status,
      readiness: workProduct.readiness,
      artifact_id: workProduct.artifactId,
      created_at: workProduct.createdAt,
    })),
    runtime_messages: detail.runtimeMessages.map((message) => ({
      message_id: message.messageId,
      status: message.status,
      mode: message.mode,
      sender: message.sender,
      target: message.target,
      action: message.action,
      body: message.body,
      created_at: message.createdAt,
    })),
    file_mounts: detail.fileMounts.map((mount) => ({
      mount_id: mount.mountId,
      file_id: mount.fileId,
      mount_path: mount.mountPath,
      visibility: mount.visibility,
      active: mount.active,
      content_type: mount.contentType,
      content_bytes: mount.contentBytes,
      created_at: mount.createdAt,
    })),
    message: detail.message,
  }) as JsonObject
}

function hostedArtifactToMcp(artifact: HostedArtifactSummary): JsonObject {
  return toJsonValue({
    hosted_artifact_id: artifact.hostedArtifactId,
    project_id: artifact.projectId ?? null,
    run_id: artifact.runId ?? null,
    built_by_run_id: artifact.builtByRunId ?? null,
    work_product_id: artifact.workProductId ?? null,
    status: artifact.status ?? null,
    title: artifact.title ?? null,
    hosted_url: artifact.hostedUrl ?? null,
    canonical_url: artifact.canonicalUrl ?? null,
    public_url: artifact.publicUrl ?? null,
    slug: artifact.slug ?? null,
    visibility: artifact.visibility ?? null,
    artifact_version: artifact.artifactVersion ?? null,
    source_run_ids: artifact.sourceRunIds,
    trace_id: artifact.traceId ?? null,
    published_at: artifact.publishedAt ?? null,
  }) as JsonObject
}

async function readStackRuntimeFactory(): Promise<StackdRuntimeFactoryResponse | undefined> {
  try {
    return await stackdRuntimeFactory()
  } catch {
    return undefined
  }
}

async function recordRuntimeLeverEvent(
  request: StackdRuntimeEventAppendRequest,
): Promise<Record<string, unknown>> {
  try {
    const response = await stackdRuntimeAppendEvent(request)
    const event = response.events[0]
    return {
      ok: true,
      event_id: event?.event_id ?? null,
      seq: event?.seq ?? null,
      event_type: event?.event_type ?? request.event_type,
      source: event?.source ?? request.source,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function remoteSyncSubject(input: {
  projectId?: string
  runId?: string
  factoryId?: string
  deploymentId?: string
  metaThreadId?: string
  intent: string
}): { kind: string; id: string } {
  if (input.deploymentId) return { kind: "remote_deployment", id: input.deploymentId }
  if (input.factoryId) return { kind: "remote_factory", id: input.factoryId }
  if (input.runId) return { kind: "remote_smr_run", id: input.runId }
  if (input.projectId) return { kind: "remote_project", id: input.projectId }
  if (input.metaThreadId) return { kind: "meta_thread", id: input.metaThreadId }
  return { kind: "remote_sync_request", id: input.intent }
}

function remoteGardenerHandoffSubject(input: {
  actorId: string
  projectId?: string
  runId?: string
  factoryId?: string
  deploymentId?: string
  metaThreadId?: string
}): { kind: string; id: string } {
  if (input.deploymentId) return { kind: "remote_deployment", id: input.deploymentId }
  if (input.factoryId) return { kind: "remote_factory", id: input.factoryId }
  if (input.runId) return { kind: "remote_smr_run", id: input.runId }
  if (input.projectId) return { kind: "remote_project", id: input.projectId }
  if (input.metaThreadId) return { kind: "meta_thread", id: input.metaThreadId }
  return { kind: "remote_gardener", id: input.actorId }
}

function remoteGardenerPassSubject(input: {
  actorId: string
  projectId?: string
  runId?: string
  factoryId?: string
  deploymentId?: string
  metaThreadId?: string
}): { kind: string; id: string } {
  if (input.deploymentId) return { kind: "remote_deployment", id: input.deploymentId }
  if (input.factoryId) return { kind: "remote_factory", id: input.factoryId }
  if (input.runId) return { kind: "remote_smr_run", id: input.runId }
  if (input.projectId) return { kind: "remote_project", id: input.projectId }
  if (input.metaThreadId) return { kind: "meta_thread", id: input.metaThreadId }
  return { kind: "remote_gardener_pass", id: input.actorId }
}

function unconsumedRemoteGardenerTriggerIds(events: Array<{ type: string; actor_id?: string; event_id: string; payload: Record<string, unknown> }>, actorId: string): string[] {
  const queued: string[] = []
  for (const event of events) {
    if (event.actor_id !== actorId) continue
    if (event.type !== "remote_gardener.trigger_queued" && event.type !== "remote_gardener.wake") continue
    const ids = Array.isArray(event.payload.trigger_event_ids)
      ? event.payload.trigger_event_ids.filter((value): value is string => typeof value === "string")
      : []
    if (event.type === "remote_gardener.trigger_queued") {
      for (const id of ids) if (!queued.includes(id)) queued.push(id)
    } else {
      for (const id of ids) {
        const index = queued.indexOf(id)
        if (index >= 0) queued.splice(index, 1)
      }
    }
  }
  return queued
}

function ensureRemoteGardenerActorState(stackRoot: string, threadId: string, actorId: string): void {
  const dir = join(stackRoot, ".stack", "actors", safeStackPathSegment(threadId), "remote_gardeners")
  const safeActorId = safeStackPathSegment(actorId)
  const path = join(dir, `${safeActorId}.json`)
  if (existsSync(path)) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schema: "stack/remote-gardener-actor-state/v1",
        thread_id: threadId,
        actor_id: actorId,
        state: "idle",
        wake_counts: 0,
        queue_counts: 0,
      },
      null,
      2,
    )}\n`,
  )
}

function safeStackPathSegment(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
  if (!safe || safe === "." || safe === "..") throw new RpcError(-32602, `invalid path segment: ${value}`)
  return safe
}

function remoteGardenerPassDigest(
  runtime: { status?: string; events_appended?: number | null; snapshot?: unknown } | undefined,
  config: StackConfig,
  note?: string,
): JsonObject {
  const rawSnapshot = runtime?.snapshot
  const snapshot = rawSnapshot && typeof rawSnapshot === "object" && !Array.isArray(rawSnapshot)
    ? rawSnapshot as StackdFactorySnapshot
    : undefined
  const remote = snapshot?.remote_synth
  const runtimeEnvironment = remote
    ? runtimeRemoteEnvironment(remote, config)
    : { environmentName: config.environmentName, apiBaseUrl: config.environment.apiBaseUrl }
  const deployments = remote?.deployments ?? []
  const activeRun = remote?.runs.find((run) => !run.terminal) ?? remote?.runs[0]
  const activeFactory = remote?.factories.find((factory) => factory.is_running) ?? remote?.factories[0]
  const activeOptimizer = remote?.hosted_optimizers.find((run) => !run.terminal) ?? remote?.hosted_optimizers[0]
  const pendingPush = remote?.pending_push ?? []
  const pendingPull = remote?.pending_pull ?? []
  const linkedSmrRuns = remote?.linked_smr_runs ?? []
  const recentRunEvents = remote?.recent_run_events ?? []
  const degradedDeployment = deployments.find((deployment) =>
    Boolean(deployment.degraded_reason) || (deployment.status ?? "").toLowerCase().includes("degrad")
  )
  const counts = {
    projects: remote?.active_project_count ?? remote?.projects.length ?? 0,
    smr_runs: remote?.active_run_count ?? remote?.runs.length ?? 0,
    factories: remote?.active_factory_count ?? remote?.factories.length ?? 0,
    hosted_optimizers: remote?.active_hosted_optimizer_count ?? remote?.hosted_optimizers.length ?? 0,
    deployments: remote?.deployment_count ?? deployments.length,
    degraded_deployments: remote?.degraded_deployment_count ?? (degradedDeployment ? 1 : 0),
    pending_push: pendingPush.length,
    pending_pull: pendingPull.length,
    linked_smr_runs: linkedSmrRuns.length,
    recent_run_events: recentRunEvents.length,
  }
  const selected = {
    project_id: remote?.projects[0]?.project_id ?? null,
    run_id: activeRun?.run_id ?? null,
    factory_id: activeFactory?.factory_id ?? null,
    deployment_id: degradedDeployment?.deployment_id ?? deployments[0]?.deployment_id ?? null,
    hosted_optimizer_run_id: activeOptimizer?.run_id ?? null,
    linked_smr_run_id: linkedSmrRuns[0]?.run_id ?? null,
  }
  const trimmedNote = note?.trim()
  const narration = trimmedNote
    ? trimmedNote.slice(0, 800)
    : remoteGardenerGeneratedNarration({
        runtimeStatus: runtime?.status ?? "unavailable",
        environment: runtimeEnvironment.environmentName,
        authStatus: remote?.auth_status ?? "unknown",
        syncEnabled: remote?.sync_enabled ?? false,
        counts,
      })
  return toJsonValue({
    schema: "stack.remote_gardener.pass.v1",
    environment: runtimeEnvironment.environmentName,
    api_base_url: runtimeEnvironment.apiBaseUrl,
    runtime_status: runtime?.status ?? "unavailable",
    events_appended: runtime?.events_appended ?? null,
    auth_status: remote?.auth_status ?? "unknown",
    sync_enabled: remote?.sync_enabled ?? false,
    control_state: snapshot?.control_state ?? "unknown",
    last_ok_at: remote?.last_ok_at ?? null,
    counts,
    selected,
    pending_push: pendingPush.slice(0, 5),
    pending_pull: pendingPull.slice(0, 5),
    linked_smr_runs: linkedSmrRuns.slice(0, 5),
    recent_run_events: recentRunEvents.slice(0, 5),
    narration,
    next_action: remoteGardenerNextAction({
      runtimeStatus: runtime?.status ?? "unavailable",
      authStatus: remote?.auth_status ?? "unknown",
      syncEnabled: remote?.sync_enabled ?? false,
      counts,
    }),
  }) as JsonObject
}

function remoteGardenerGeneratedNarration(input: {
  runtimeStatus: string
  environment: string
  authStatus: string
  syncEnabled: boolean
  counts: {
    projects: number
    smr_runs: number
    factories: number
    hosted_optimizers: number
    deployments: number
    degraded_deployments: number
    pending_push: number
    pending_pull: number
    linked_smr_runs: number
    recent_run_events: number
  }
}): string {
  if (input.runtimeStatus === "unavailable") {
    return "Remote runtime snapshot is unavailable; keep local work local and start stackd before cloud sync."
  }
  if (!input.syncEnabled || input.authStatus === "missing") {
    return `Remote Synth is signed out for ${input.environment}; local Stack remains ready, and cloud sync waits for an optional sign-in.`
  }
  if (input.counts.degraded_deployments > 0) {
    return `Remote ${input.environment} has ${input.counts.degraded_deployments} degraded deployment signal(s); inspect deployment status before push/pull actions.`
  }
  if (input.counts.pending_push > 0 || input.counts.pending_pull > 0) {
    return `Remote ${input.environment} has ${input.counts.pending_push} pending push request(s) and ${input.counts.pending_pull} pending pull request(s) in the runtime snapshot.`
  }
  if (input.counts.linked_smr_runs > 0) {
    return `Remote ${input.environment} has ${input.counts.linked_smr_runs} local meta-thread to SMR run binding(s) in the runtime snapshot.`
  }
  if (input.counts.recent_run_events > 0) {
    return `Remote ${input.environment} has ${input.counts.recent_run_events} recent SMR runtime message event(s) in the runtime snapshot.`
  }
  if (input.counts.smr_runs > 0 || input.counts.factories > 0 || input.counts.hosted_optimizers > 0) {
    return `Remote ${input.environment} has ${input.counts.smr_runs} SMR run(s), ${input.counts.factories} Factory row(s), and ${input.counts.hosted_optimizers} hosted optimizer row(s) in the runtime snapshot.`
  }
  return `Remote ${input.environment} is connected but has no active hosted work in the runtime snapshot.`
}

function remoteGardenerNextAction(input: {
  runtimeStatus: string
  authStatus: string
  syncEnabled: boolean
  counts: { smr_runs: number; factories: number; degraded_deployments: number; pending_push: number; pending_pull: number }
}): string {
  if (input.runtimeStatus === "unavailable") return "start stackd or rerun with tick=true before claiming sync state"
  if (!input.syncEnabled || input.authStatus === "missing") return "sign in only if cloud sync is needed; local paths remain available"
  if (input.counts.degraded_deployments > 0) return "inspect deployments and open Ops only if operator review is useful"
  if (input.counts.pending_push > 0 || input.counts.pending_pull > 0) return "resolve or narrate the pending push/pull request receipts before adding more sync requests"
  if (input.counts.smr_runs > 0 || input.counts.factories > 0) return "inspect the focused remote rows, then record push/pull requests with concrete ids"
  return "prepare a promotion packet only when local proof is ready to graduate"
}

function threadActorRole(actorRole: string): "gardener" | "remote_gardener" | "system" {
  if (actorRole === "remote_gardener") return "remote_gardener"
  if (actorRole === "gardener") return "gardener"
  return "system"
}

function remoteLaunchRunId(result: RemoteActionResult): string | undefined {
  const data = result.data
  if (!data) return undefined
  for (const key of ["run_id", "runId", "id", "launch_id", "launchId"]) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return value
  }
  const launch = data.launch
  if (launch && typeof launch === "object" && !Array.isArray(launch)) {
    for (const key of ["run_id", "runId", "id"]) {
      const value = (launch as Record<string, unknown>)[key]
      if (typeof value === "string" && value.trim()) return value
    }
  }
  return undefined
}

function remoteActionEntityId(result: RemoteActionResult, keys: string[]): string | undefined {
  const data = result.data
  if (!data) return undefined
  for (const key of keys) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function containerPoolRuntimeReleaseRequest(args: JsonObject): ContainerPoolRuntimeImageReleaseRequest {
  const body = { ...(optionalJsonObject(args, "body") ?? {}) } as ContainerPoolRuntimeImageReleaseRequest
  const name = optionalString(args, "release_name")
  if (name) body.name = name
  const provider = optionalString(args, "provider")
  if (provider) body.provider = provider
  const runtimeKind = optionalString(args, "runtime_kind") ?? (optionalString(args, "service_url") ? "service_url" : undefined)
  if (runtimeKind) body.runtime_kind = runtimeKind
  const imageRef = optionalString(args, "image_ref")
  if (imageRef) body.image_ref = imageRef
  const serviceUrl = optionalString(args, "service_url")
  if (serviceUrl) body.service_url = serviceUrl
  const archiveBase64 = optionalString(args, "archive_base64")
  if (archiveBase64) body.archive_base64 = archiveBase64
  const sourceStorageUri = optionalString(args, "source_storage_uri")
  if (sourceStorageUri) body.source_storage_uri = sourceStorageUri
  const dockerfilePath = optionalString(args, "dockerfile_path")
  if (dockerfilePath) body.dockerfile_path = dockerfilePath
  const baseImageRef = optionalString(args, "base_image_ref")
  if (baseImageRef) body.base_image_ref = baseImageRef
  const entrypoint = optionalString(args, "entrypoint")
  if (entrypoint) body.entrypoint = entrypoint
  const envVars = optionalJsonObject(args, "env_vars")
  if (envVars) body.env_vars = envVars
  const limits = optionalJsonObject(args, "limits")
  if (limits) body.limits = limits
  const metadata = optionalJsonObject(args, "metadata")
  if (metadata) body.metadata = metadata
  if (!body.runtime_kind) body.runtime_kind = body.service_url ? "service_url" : "image_ref"
  if (body.runtime_kind === "image_ref" && !body.image_ref) {
    throw new RpcError(-32602, "runtime_kind=image_ref requires image_ref")
  }
  if (body.runtime_kind === "service_url" && !body.service_url) {
    throw new RpcError(-32602, "runtime_kind=service_url requires service_url")
  }
  return body
}

function errorToRuntimeUnavailable(error: unknown): {
  status: string
  events_appended?: number | null
  snapshot?: unknown
} {
  return {
    status: "unavailable",
    snapshot: {
      error: error instanceof Error ? error.message : String(error),
    },
  }
}

function runtimeSummaryFromFactory(snapshot: StackdFactorySnapshot | null | undefined, config: StackConfig): {
  remote: {
    source: "runtime"
    environment: string
    api_base_url: string
    status: string
    message: string
    control_state: string
    smr_runs: number
    factories: number
    deployments: number
    degraded_deployments: number
    active_smr_runs: number
    active_factories: number
    selected_smr_run_id?: string
    selected_factory_id?: string
    sync: {
      pending_push: StackdFactorySnapshot["remote_synth"]["pending_push"]
      pending_pull: StackdFactorySnapshot["remote_synth"]["pending_pull"]
      recent_remote_gardener_passes: StackdFactorySnapshot["remote_synth"]["recent_remote_gardener_passes"]
      linked_smr_runs: StackdFactorySnapshot["remote_synth"]["linked_smr_runs"]
      recent_run_events: StackdFactorySnapshot["remote_synth"]["recent_run_events"]
    }
    hosted_artifact_for_first: null
  }
  hostedOptimizers: {
    source: "runtime"
    environment: string
    api_base_url: string
    status: string
    message: string
    runs: number
    active_runs: number
    selected_run_id?: string
  }
} | undefined {
  const remote = snapshot?.remote_synth
  if (!snapshot || !remote) return undefined
  const deployments = remote.deployments ?? []
  const pendingPush = remote.pending_push ?? []
  const pendingPull = remote.pending_pull ?? []
  const recentRemoteGardenerPasses = remote.recent_remote_gardener_passes ?? []
  const linkedSmrRuns = remote.linked_smr_runs ?? []
  const recentRunEvents = remote.recent_run_events ?? []
  const deploymentCount = remote.deployment_count ?? deployments.length
  const hasRemoteState =
    remote.projects.length > 0 ||
    remote.runs.length > 0 ||
    remote.factories.length > 0 ||
    deployments.length > 0 ||
    pendingPush.length > 0 ||
    pendingPull.length > 0 ||
    recentRemoteGardenerPasses.length > 0 ||
    linkedSmrRuns.length > 0 ||
    recentRunEvents.length > 0 ||
    remote.hosted_optimizers.length > 0 ||
    remote.active_run_count > 0 ||
    remote.active_factory_count > 0 ||
    remote.active_hosted_optimizer_count > 0 ||
    deploymentCount > 0
  if (!hasRemoteState) return undefined
  const selectedRun = remote.runs.find((run) => !run.terminal) ?? remote.runs[0]
  const selectedFactory = remote.factories.find((factory) => factory.is_running) ?? remote.factories[0]
  const selectedOptimizer = remote.hosted_optimizers.find((run) => !run.terminal) ?? remote.hosted_optimizers[0]
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  return {
    remote: {
      source: "runtime",
      environment: runtimeEnvironment.environmentName,
      api_base_url: runtimeEnvironment.apiBaseUrl,
      status: remote.auth_status === "ready" ? "ready" : "missing-auth",
      message: `runtime ${remote.active_project_count} projects, ${deploymentCount} deployments`,
      control_state: snapshot.control_state,
      smr_runs: remote.runs.length,
      factories: remote.factories.length,
      deployments: deploymentCount,
      degraded_deployments: remote.degraded_deployment_count ?? 0,
      active_smr_runs: remote.active_run_count,
      active_factories: remote.active_factory_count,
      ...(selectedRun ? { selected_smr_run_id: selectedRun.run_id } : {}),
      ...(selectedFactory ? { selected_factory_id: selectedFactory.factory_id } : {}),
      sync: {
        pending_push: pendingPush,
        pending_pull: pendingPull,
        recent_remote_gardener_passes: recentRemoteGardenerPasses,
        linked_smr_runs: linkedSmrRuns,
        recent_run_events: recentRunEvents,
      },
      hosted_artifact_for_first: null,
    },
    hostedOptimizers: {
      source: "runtime",
      environment: runtimeEnvironment.environmentName,
      api_base_url: runtimeEnvironment.apiBaseUrl,
      status: remote.auth_status === "ready" ? "ready" : "missing-auth",
      message: `runtime ${remote.hosted_optimizers.length} hosted optimizer runs`,
      runs: remote.hosted_optimizers.length,
      active_runs: remote.active_hosted_optimizer_count,
      ...(selectedOptimizer ? { selected_run_id: selectedOptimizer.run_id } : {}),
    },
  }
}

function remoteProjectsMcpFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
): JsonValue | undefined {
  const remote = snapshot?.remote_synth
  const projects = remote?.projects ?? []
  const runtimeDeployments = remote?.deployments ?? []
  const recentRunEvents = remote?.recent_run_events ?? []
  const deploymentCount = remote?.deployment_count ?? runtimeDeployments.length
  if (!remote || (projects.length === 0 && deploymentCount === 0 && recentRunEvents.length === 0)) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  const runtimeRuns = remote.runs ?? []
  const runtimeFactories = remote.factories ?? []
  const runsById = new Map(runtimeRuns.map((run) => [run.run_id, run]))
  const factoriesById = new Map(runtimeFactories.map((factory) => [factory.factory_id, factory]))
  return toJsonValue({
    environment: runtimeEnvironment.environmentName,
    api_base_url: runtimeEnvironment.apiBaseUrl,
    source: "runtime",
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    message: `runtime ${projects.length} projects`,
    checked_at: snapshot.updated_at,
    count: projects.length,
    tag_scope: null,
    hosted_optimizers: {
      active_count: remote.active_hosted_optimizer_count,
      runs: remote.hosted_optimizers.map((optimizer) => ({
        run_id: optimizer.run_id,
        status: optimizer.status,
        updated_at: optimizer.updated_at,
        terminal: optimizer.terminal,
      })),
    },
    deployments: {
      count: deploymentCount,
      degraded_count: remote.degraded_deployment_count ?? 0,
      rows: runtimeDeployments.map((deployment) => ({
        deployment_id: deployment.deployment_id,
        name: deployment.name,
        status: deployment.status,
        preflight_status: deployment.preflight_status,
        degraded_reason: deployment.degraded_reason,
        project_id: deployment.project_id,
        factory_id: deployment.factory_id,
        topology: deployment.topology,
        substrate: deployment.substrate,
        updated_at: deployment.updated_at,
        ready: deployment.ready,
      })),
    },
    sync: {
      pending_push: remote.pending_push ?? [],
      pending_pull: remote.pending_pull ?? [],
      recent_remote_gardener_passes: remote.recent_remote_gardener_passes ?? [],
      linked_smr_runs: remote.linked_smr_runs ?? [],
      recent_run_events: recentRunEvents,
    },
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
      return {
        project_id: project.project_id,
        name: project.name,
        alias: project.alias,
        updated_at: project.updated_at,
        active_run_id: project.active_run_id ?? projectRuns.find((run) => !run.terminal)?.run_id,
        experiments_last_7d: null,
        experiments_last_7d_capped: false,
        live_runs: projectRuns.filter((run) => !run.terminal).map((run) => ({
          run_id: run.run_id,
          project_id: run.project_id,
          state: run.state,
          phase: run.phase,
          runbook: run.runbook,
          updated_at: run.updated_at,
          reason: null,
        })),
        recent_runs: projectRuns.map((run) => ({
          run_id: run.run_id,
          project_id: run.project_id,
          state: run.state,
          phase: run.phase,
          runbook: run.runbook,
          updated_at: run.updated_at,
          reason: null,
        })),
        factories: projectFactories.map((factory) => ({
          factory_id: factory.factory_id,
          name: factory.name,
          kind: factory.kind,
          status: factory.status,
          canonical_project_id: factory.canonical_project_id,
          latest_project_id: factory.latest_project_id,
          latest_run_id: factory.latest_run_id,
          has_cloud_dev_env: factory.has_cloud_dev_env,
          cloud_dev_label: factory.cloud_dev_label,
          is_running: factory.is_running ?? false,
          active_efforts: factory.active_efforts ?? 0,
          next_wake_at: factory.next_wake_at,
        })),
      }
    }),
  })
}

function liveSmrsMcpFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
): JsonValue | undefined {
  const remote = snapshot?.remote_synth
  const runs = remote?.runs ?? []
  const recentRunEvents = remote?.recent_run_events ?? []
  if (!remote || (runs.length === 0 && recentRunEvents.length === 0)) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  return toJsonValue({
    environment: runtimeEnvironment.environmentName,
    api_base_url: runtimeEnvironment.apiBaseUrl,
    source: "runtime",
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    message: `runtime ${runs.length} SMR runs`,
    count: runs.length,
    control_state: snapshot.control_state,
    recent_run_events: recentRunEvents,
    runs: runs.map((run) => ({
      run_id: run.run_id,
      project_id: run.project_id,
      state: run.state,
      phase: run.phase,
      runbook: run.runbook,
      updated_at: run.updated_at,
      reason: run.terminal ? "terminal" : null,
      terminal: run.terminal,
      work_products: 0,
      artifacts: 0,
      pending_messages: 0,
      file_mounts: 0,
      hosted_artifact: null,
    })),
  })
}

function factoriesMcpFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
): JsonValue | undefined {
  const remote = snapshot?.remote_synth
  const factories = remote?.factories ?? []
  if (!remote || factories.length === 0) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  return toJsonValue({
    environment: runtimeEnvironment.environmentName,
    api_base_url: runtimeEnvironment.apiBaseUrl,
    source: "runtime",
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    message: `runtime ${factories.length} factories`,
    count: factories.length,
    control_state: snapshot.control_state,
    factories: factories.map((factory) => ({
      factory_id: factory.factory_id,
      name: factory.name,
      kind: factory.kind,
      status: factory.status,
      canonical_project_id: factory.canonical_project_id,
      latest_project_id: factory.latest_project_id,
      latest_run_id: factory.latest_run_id,
      latest_work_product_id: null,
      next_wake_at: factory.next_wake_at,
      active_efforts: factory.active_efforts ?? 0,
      paused_or_waiting: 0,
      has_cloud_dev_env: factory.has_cloud_dev_env,
      cloud_dev_label: factory.cloud_dev_label,
      is_running: factory.is_running ?? false,
      project_ids: factory.project_ids,
    })),
  })
}

function hostedOptimizersMcpFromRuntime(
  snapshot: StackdFactorySnapshot | null | undefined,
  config: StackConfig,
): JsonValue | undefined {
  const remote = snapshot?.remote_synth
  const runs = remote?.hosted_optimizers ?? []
  if (!remote || runs.length === 0) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  return toJsonValue({
    environment: runtimeEnvironment.environmentName,
    api_base_url: runtimeEnvironment.apiBaseUrl,
    source: "runtime",
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    message: `runtime ${runs.length} hosted optimizer runs`,
    count: runs.length,
    control_state: snapshot.control_state,
    runs: runs.map((run) => ({
      run_id: run.run_id,
      project_id: null,
      algorithm: "unknown",
      status: run.status,
      finalize_state: null,
      cancellation_requested: false,
      updated_at: run.updated_at,
      terminal: run.terminal,
      artifact_names: [],
      event_count: 0,
      event_types: [],
      detail_message: null,
    })),
  })
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

function buildTools(server: StackMcpServer): ToolDefinition[] {
  return [
    {
      name: "stack_status",
      description: "Read concise Stack Agent Bridge status for Codex: local optimizer state, remote SMR/Factory state, hosted optimizer state, auth, README-smoke state, and suggested next actions.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        mode: enumProperty(["local", "remote", "all"], "Optional bridge mode filter. Defaults to all."),
      }),
      handler: (args) => server.agentStatus(args),
    },
    {
      name: "stack_crash_reports",
      description:
        "Read Stack client crash visibility: local stackd outbox tail plus optional Synth cloud summary (requires auth). Use after TUI/runtime fatals or when triaging opentui_buffer and related crash classes in prod.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        limit: numberProperty("Maximum local outbox rows to return. Defaults to 20."),
        window_days: numberProperty("Remote summary window in days. Defaults to 7."),
        remote: {
          type: "boolean",
          description: "When true (default), also fetch remote /api/v1/product/stack-crashes/summary when auth is present.",
        },
      }),
      handler: (args) => server.crashReports(args),
    },
    {
      name: "stack_runtime_status",
      description: "Read stackd runtime factory snapshot and recent runtime sensor events. Check events_status before treating an empty events list as authoritative. Optionally force one runtime tick.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        tick: { type: "boolean", description: "If true, request one stackd /runtime/tick before reading events." },
        after_seq: numberProperty("Only return runtime events after this sequence."),
        limit: numberProperty("Maximum runtime events to return. Defaults to stackd default."),
        source: stringProperty("Optional runtime event source filter, e.g. sensor.local_gepa or sensor.remote_synth."),
      }),
      handler: (args) => server.runtimeStatus(args),
    },
    {
      name: "stack_inference_catalog",
      description:
        "List Synth inference lanes visible to Stack: free aux promo models, billed GLM catalog entries, billing tier, role eligibility, and the primary-worker opt-in invariant. Does not route any actor to Synth inference.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
      }),
      handler: (args) => server.inferenceCatalog(args),
    },
    {
      name: "stack_inference_usage",
      description:
        "Read Synth inference usage visibility from backend owner endpoints: free aux promo budget, inference spend summaries, top project/actor rows, and the primary-worker opt-in invariant. Does not include prompts or transcripts.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
      }),
      handler: (args) => server.inferenceUsage(args),
    },
    {
      name: "stack_sidecar_pause_for_restart",
      description: "Sidecar monitor tool: mark the persistent sidecar Codex thread as done with the current monitoring batch and waiting for the runtime to wake it on the next worker event, operator message, or goal change.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Worker Stack thread/session id this sidecar monitors."),
          actor_id: stringProperty("Optional sidecar actor id. Defaults to monitor."),
          reason: stringProperty("Short reason the sidecar is pausing until the next runtime wake."),
          next_wake_on: arrayProperty("Optional wake conditions such as worker_event, operator_message, or goal_change."),
        },
        ["thread_id"],
      ),
      handler: (args) => server.sidecarPauseForRestart(args),
    },
    {
      name: "stack_monitor_goal_status",
      description:
        "Sidecar monitor tool: record a goal-progress update. This is the SOLE source of the operator's events feed — set `for_human: true` with a short `headline` (title) and one-sentence `note` (content) whenever the operator should see this update; the UI renders it as `type · headline` over one content line. Call it on a MEANINGFUL status change: `advancing` (with the concrete metric), `blocked`/`stalled`, `goal_failed`, or `goal_met` once you have AUDITED the worker's completion claim against cited proof. `goal_met` flips the goal to done, so only emit it when the proof clears the target. For a structured signal the operator does not need to read, omit `for_human` (or set it false).",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Worker Stack thread/session id this sidecar monitors."),
          actor_id: stringProperty("Optional sidecar actor id. Defaults to monitor."),
          status: stringProperty("The update type. One of: advancing, working, blocked, stalled, goal_met, goal_failed."),
          headline: stringProperty("A 1-5 word title for this update, shown as the events-feed header (e.g. 'baseline established', 'candidate beats 2x')."),
          note: stringProperty("One concise human sentence: what the worker is doing or the milestone reached — cite the concrete number when there is one."),
          for_human: { type: "boolean", description: "true to surface this update in the operator's events feed. Omit/false for a structured-only signal the operator should not be shown." },
          metric: {
            type: "object",
            description: "Optional concrete metric, e.g. {value, baseline, ratio, target_ratio, target_value, unit} — cite the number.",
          },
          evidence_event_ids: arrayProperty("Optional event ids that substantiate this status."),
        },
        ["thread_id", "status"],
      ),
      handler: (args) => server.monitorGoalStatus(args),
    },
    {
      name: "stack_ui_open_panel",
      description:
        "Open a side panel for human review. The agent panel always stays primary; use this ONLY at review moments (audited goal_met/goal_failed, blocked, a steer you issued, or a risky pending action) and at most once per distinct signature. panel: monitor (sidecar events/thread/tape), gardener (portfolio), ops (local/remote/hosted), lights (threads list with viewed dropdown - gardener may open), efforts (durable workstreams list), threads (operator-only legacy list). Every open emits an audited ui.panel_opened event; the operator's Esc closes it and wins until your next open.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Worker Stack thread/session id the panel belongs to."),
          panel: { type: "string", enum: [...UI_PANEL_IDS], description: "Registered panel id." },
          view: stringProperty("Optional view within the panel (monitor: events|thread|tape; gardener: portfolio|chat; ops: local|remote|hosted; lights: threads; efforts: list; threads: list)."),
          reason: stringProperty("One short sentence: why this deserves the operator's eyes now."),
          actor_role: stringProperty("Who is opening: monitor, gardener, remote_gardener, or operator."),
          actor_id: stringProperty("Optional concrete actor id for the audit event."),
        },
        ["thread_id", "panel", "reason"],
      ),
      handler: (args) => server.uiOpenPanel(args),
    },
    {
      name: "stack_ui_close_panel",
      description:
        "Close a side panel. Monitor/gardener may close only panels they opened; the operator closes anything. Emits ui.panel_closed.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Worker Stack thread/session id."),
          panel: { type: "string", enum: [...UI_PANEL_IDS], description: "Registered panel id." },
          reason: stringProperty("Optional reason for the audit event."),
          actor_role: stringProperty("Who is closing: monitor, gardener, remote_gardener, or operator."),
          actor_id: stringProperty("Optional concrete actor id for the audit event."),
        },
        ["thread_id", "panel"],
      ),
      handler: (args) => server.uiClosePanel(args),
    },
    {
      name: "stack_lights_thread_view",
      description:
        "Mark a worker thread viewed or unviewed in the Lights threads panel. Preferred gardener path for 'show this thread in Lights' — opens the dropdown with thread metadata. Do not use panel=threads (operator-only). Use viewed=true to expand details; viewed=false to clear the viewed marker.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Worker Stack thread/session id (or meta-thread id mt_* — resolves to head worker thread)."),
          viewed: { type: "boolean", description: "True to mark viewed (default); false to mark unviewed." },
          reason: stringProperty("One short sentence for the audit trail."),
          actor_role: stringProperty("Who is acting: monitor, gardener, remote_gardener, or operator."),
          actor_id: stringProperty("Optional concrete actor id for the audit event."),
        },
        ["thread_id"],
      ),
      handler: (args) => server.uiLightsThreadView(args),
    },
    {
      name: "stack_list_remote_projects",
      description: "List remote Synth projects with associated live/recent SMR runs and linked Factory/cloud badges. Uses stackd runtime snapshot first, with direct API fallback.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        tick: { type: "boolean", description: "If true, request one stackd /runtime/tick before reading projects." },
      }),
      handler: (args) => server.listRemoteProjects(args),
    },
    {
      name: "stack_create_runnable_project",
      description: "Create a runnable Managed Research project through POST /smr/projects:runnable. Thin owner-route wrapper; request must match the backend SmrRunnableProjectCreateRequest, including pool/runtime/environment/profile ids.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the created project as a hosted Effort ref."),
          request: jsonObjectProperty("SmrRunnableProjectCreateRequest payload for /smr/projects:runnable."),
        },
        ["request"],
      ),
      handler: (args) => server.createRunnableProject(args),
    },
    {
      name: "stack_create_factory",
      description: "Create a Managed Research Factory through POST /smr/factories. Thin owner-route wrapper; name is required unless supplied in request.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the created factory as a hosted Effort ref."),
          name: stringProperty("Factory name. Required unless supplied in request."),
          description: stringProperty("Optional Factory description."),
          kind: stringProperty("Optional Factory kind. Defaults to backend default."),
          status: stringProperty("Optional Factory status. Defaults to backend default."),
          budget_policy: jsonObjectProperty("Optional Factory budget policy."),
          cap_policy: jsonObjectProperty("Optional Factory cap policy."),
          homeostasis_policy: jsonObjectProperty("Optional Factory homeostasis policy."),
          publication_policy: jsonObjectProperty("Optional Factory publication policy."),
          authorization_policy: jsonObjectProperty("Optional Factory authorization policy."),
          metadata: jsonObjectProperty("Optional Factory metadata."),
          request: jsonObjectProperty("Optional raw SmrFactoryCreateRequest payload. Explicit top-level fields override this object."),
        },
        [],
      ),
      handler: (args) => server.createFactory(args),
    },
    {
      name: "stack_prepare_cloud_promotion_packet",
      description: "Prepare a local-to-cloud promotion packet from the stackd runtime snapshot. Does not create cloud work.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        project_id: stringProperty("Optional target Synth project id."),
        task_id: stringProperty("Optional task id for the promotion packet."),
        objective: stringProperty("Optional cloud launch objective."),
        runbook: stringProperty("Optional runbook or launch mode hint."),
        metadata: jsonObjectProperty("Optional structured metadata to carry into the promotion packet."),
      }),
      handler: (args) => server.prepareCloudPromotionPacket(args),
    },
    {
      name: "stack_launch_cloud_promotion",
      description: "Create a cloud launch from a Stack promotion packet through the Managed Research launch owner route. Dry-run by default; set dry_run=false and confirm=true to mutate cloud state.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        project_id: stringProperty("Optional target Synth project id."),
        task_id: stringProperty("Optional task id for the promotion packet."),
        objective: stringProperty("Optional cloud launch objective. When omitted, task_id is used to derive canonical SMR launch context."),
        runbook: stringProperty("Optional runbook or launch mode hint."),
        metadata: jsonObjectProperty("Optional structured metadata to carry into the launch request."),
        dry_run: { type: "boolean", description: "Defaults to true. When true, returns the launch packet without creating cloud work." },
        confirm: { type: "boolean", description: "Required as true when dry_run=false." },
      }),
      handler: (args) => server.launchCloudPromotion(args),
    },
    {
      name: "stack_launch_promo_status",
      description: "Read Managed Research launch promo entitlement status through the Stack cloud owner route. Does not mutate cloud state.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
      }),
      handler: (args) => server.launchPromoStatus(args),
    },
    {
      name: "stack_claim_launch_promo",
      description: "Claim Managed Research launch promo entitlement through the Stack cloud owner route. Requires confirm=true.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        confirm: { type: "boolean", description: "Required as true to claim the launch promo entitlement." },
      }),
      handler: (args) => server.claimLaunchPromo(args),
    },
    {
      name: "stack_remote_sync_request",
      description: "Record a remote gardener push/pull sync request receipt in stackd runtime events. This does not mutate cloud state; use owner-route tools for the actual action.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          direction: enumProperty(["push", "pull"], "Sync direction. push means local-to-cloud request; pull means cloud-to-local request."),
          intent: enumProperty(
            [
              "promotion_packet",
              "workspace_upload",
              "message_run",
              "message_factory",
              "objective",
              "task_status",
              "artifact_refs",
              "deployment_status",
              "factory_status",
            ],
            "Requested sync intent.",
          ),
          thread_id: stringProperty("Optional local Stack thread/session id for correlation."),
          meta_thread_id: stringProperty("Optional local Stack meta-thread id for correlation."),
          project_id: stringProperty("Optional Synth project id."),
          run_id: stringProperty("Optional SMR run id."),
          factory_id: stringProperty("Optional Factory id."),
          deployment_id: stringProperty("Optional cloud deployment id."),
          note: stringProperty("Short reason or operator-facing narration for the requested sync."),
          actor_id: stringProperty("Optional actor id. Defaults to actor_role."),
          actor_role: enumProperty(["remote_gardener", "gardener", "operator"], "Actor role. Defaults to remote_gardener."),
        },
        ["direction", "intent"],
      ),
      handler: (args) => server.requestRemoteSync(args),
    },
    {
      name: "stack_remote_gardener_handoff",
      description:
        "Record a local-gardener to remote-gardener handoff and queue a remote gardener wake. This writes local thread events plus a stackd runtime receipt; it does not mutate cloud state.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Local Stack thread/session id where the handoff happened."),
          meta_thread_id: stringProperty("Optional local Stack meta-thread id for correlation."),
          reason: stringProperty("Short reason the local gardener is escalating cloud/sync confusion."),
          note: stringProperty("Optional operator-facing handoff note."),
          project_id: stringProperty("Optional Synth project id."),
          run_id: stringProperty("Optional SMR run id."),
          factory_id: stringProperty("Optional Factory id."),
          deployment_id: stringProperty("Optional cloud deployment id."),
          actor_id: stringProperty("Optional local gardener actor id. Defaults to gardener_default."),
          actor_role: enumProperty(["gardener", "operator"], "Who is requesting the handoff. Defaults to gardener."),
          remote_gardener_id: stringProperty("Optional remote gardener actor id. Defaults to remote_gardener_default."),
        },
        ["thread_id", "reason"],
      ),
      handler: (args) => server.handoffRemoteGardener(args),
    },
    {
      name: "stack_remote_gardener_pass",
      description:
        "Record a remote gardener sync narration pass from the stackd runtime snapshot. Optionally emits a local thread event and always records a runtime receipt; this does not mutate cloud state.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          tick: { type: "boolean", description: "If true, request one stackd /runtime/tick before narrating sync state." },
          thread_id: stringProperty("Optional local Stack thread/session id; when present, writes remote_gardener.sync_narrated to that thread log."),
          meta_thread_id: stringProperty("Optional local Stack meta-thread id for correlation."),
          project_id: stringProperty("Optional Synth project id to correlate this pass."),
          run_id: stringProperty("Optional SMR run id to correlate this pass."),
          factory_id: stringProperty("Optional Factory id to correlate this pass."),
          deployment_id: stringProperty("Optional cloud deployment id to correlate this pass."),
          note: stringProperty("Optional bounded narration. If omitted, Stack generates one from the runtime snapshot."),
          actor_id: stringProperty("Optional actor id. Defaults to actor_role."),
          actor_role: enumProperty(["remote_gardener", "gardener", "operator"], "Actor role. Defaults to remote_gardener."),
        },
      ),
      handler: (args) => server.recordRemoteGardenerPass(args),
    },
    {
      name: "stack_meta_thread_bind_smr_run",
      description:
        "Bind a local Stack meta-thread to a remote SMR run. Writes smr_run_id on the meta-thread manifest, appends a meta-thread bind event, and records a runtime receipt. Does not mutate the remote run.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          meta_thread_id: stringProperty("Local Stack meta-thread id."),
          run_id: stringProperty("Remote SMR run id to bind."),
          project_id: stringProperty("Optional Synth project id."),
          factory_id: stringProperty("Optional Factory id."),
          deployment_id: stringProperty("Optional cloud deployment id."),
          objective: stringProperty("Optional remote objective or local objective mapped to this run."),
          remote_status: stringProperty("Optional current remote run state/status."),
          reason: stringProperty("Short reason for the binding."),
          actor_id: stringProperty("Optional actor id. Defaults to actor_role."),
          actor_role: enumProperty(["remote_gardener", "gardener", "operator"], "Actor role. Defaults to remote_gardener."),
        },
        ["meta_thread_id", "run_id"],
      ),
      handler: (args) => server.bindMetaThreadSmrRun(args),
    },
    {
      name: "stack_get_cloud_launch",
      description: "Read one Managed Research run through the canonical SMR run route, with legacy launch fallback.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("Cloud launch run id."),
        },
        ["run_id"],
      ),
      handler: (args) => server.getCloudLaunch(args),
    },
    {
      name: "stack_terminate_cloud_launch",
      description: "Stop one Managed Research run through the canonical SMR run route, with legacy launch fallback.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("Cloud launch run id."),
          reason: stringProperty("Optional termination reason."),
        },
        ["run_id"],
      ),
      handler: (args) => server.terminateCloudLaunch(args),
    },
    {
      name: "stack_list_run_interactions",
      description: "List pending or filtered human questions and approvals for one SMR run through backend interaction owner routes.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id for project-scoped interaction routes."),
          status_filter: stringProperty("Optional backend status filter, e.g. pending."),
        },
        ["run_id"],
      ),
      handler: (args) => server.listRunInteractions(args),
    },
    {
      name: "stack_respond_run_question",
      description: "Respond to one SMR run question through the backend interaction owner route.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the SMR run ref after a successful response."),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id for project-scoped interaction routes."),
          question_id: stringProperty("Question id."),
          response_text: stringProperty("Human response text."),
        },
        ["run_id", "question_id", "response_text"],
      ),
      handler: (args) => server.respondRunQuestion(args),
    },
    {
      name: "stack_decide_run_approval",
      description: "Approve or deny one SMR run approval request through the backend interaction owner route.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the SMR run ref after a successful decision."),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id for project-scoped interaction routes."),
          approval_id: stringProperty("Approval id."),
          decision: enumProperty(["approve", "deny"], "Approval decision."),
          comment: stringProperty("Optional decision comment."),
        },
        ["run_id", "approval_id", "decision"],
      ),
      handler: (args) => server.decideRunApproval(args),
    },
    {
      name: "stack_list_live_smrs",
      description: "List recent live SMR runs in a concise Codex-friendly shape. Uses stackd runtime snapshot first, with direct API fallback for output/message/file counts.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        tick: { type: "boolean", description: "If true, request one stackd /runtime/tick before reading runs." },
      }),
      handler: (args) => server.listLiveSmrs(args),
    },
    {
      name: "stack_inspect_live_run",
      description: "Inspect one SMR run with WorkProducts, artifacts, runtime messages, file mounts, and hosted artifact status.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id for project-scoped WorkProduct/runtime-message reads."),
        },
        ["run_id"],
      ),
      handler: (args) => server.inspectLiveRun(args),
    },
    {
      name: "stack_query_logs",
      description: "Query VictoriaLogs through stackd's native LogSQL client for agent-legible cloud, local optimizer, and meta-harness telemetry.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        slot: stringProperty("Local synth-dev slot id. Defaults to STACK_VL_SLOT or slot1."),
        query: stringProperty("Optional LogSQL query expression. Defaults to * plus supplied field filters."),
        event_domain: enumProperty(["cloud_sdk", "local_optimizer", "meta_harness"], "Optional event_domain filter."),
        service: stringProperty("Optional service filter, e.g. gepa, stackd, backend-api."),
        run_id: stringProperty("Optional run/job id filter."),
        thread_id: stringProperty("Optional Stack thread/session id filter."),
        minutes: numberProperty("Lookback window in minutes. Defaults to 60, max 10080."),
        limit: numberProperty("Maximum records to return. Defaults to 100, max 500."),
        timeout_seconds: numberProperty("VictoriaLogs query timeout. Defaults to 20 seconds."),
      }),
      handler: (args) => server.queryLogs(args),
    },
    {
      name: "stack_run_with_logs",
      description: "Run a bounded local command and emit harness-cmd start/exit summaries to VictoriaLogs with event_domain=local_optimizer.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        command: { type: "string", description: "Executable to run without shell expansion." },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Argument vector. Shell syntax is not interpreted.",
        },
        cwd: stringProperty("Working directory relative to Stack workingDir. Defaults to workingDir."),
        run_id: stringProperty("Optional run correlation id. Defaults to harnesscmd_<timestamp>."),
        timeout_seconds: numberProperty("Timeout in seconds. Defaults to 300, max 3600."),
        tail_bytes: numberProperty("Bytes of stdout/stderr tail returned and logged. Defaults to 4000, max 20000."),
      }),
      handler: (args) => server.runWithLogs(args),
    },
    {
      name: "stack_get_run_artifact_status", // FRESH mcp/server.ts edit this turn for delta
      description: "Return hosted artifact status + urls for a given SMR run (used for artifact_builder runs). Includes hosted_url, public_url, status (building|ready|published), and whether the hosted URL returned 200.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        run_id: { type: "string", description: "SMR run_id to query for hosted artifact" },
        prefer: { type: "string", enum: ["hosted", "public_shell"], description: "Which URL family to prefer for open actions" },
      }),
      handler: (args) => server.getRunArtifactStatus(args),
    },
    {
      name: "stack_list_hosted_artifacts",
      description: "Discover hosted Synth artifacts visible to the current org, optionally scoped to a project. Rows include hosted_url, public_url, run_id, work_product_id, status, visibility, and slug.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        project_id: stringProperty("Optional project id for project-scoped hosted artifacts."),
        limit: numberProperty("Maximum artifacts to return. Defaults to 100, max 500."),
      }),
      handler: (args) => server.listHostedArtifacts(args),
    },
    {
      name: "stack_list_container_pools",
      description: "List Synth hosted container pools through the live /v1/pools backend route. Use this before pool health checks, rollouts, or hosted GEPA container-pool submits.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        state: stringProperty("Optional backend state filter."),
        limit: numberProperty("Maximum pools to return. Defaults to 100, max 500."),
      }),
      handler: (args) => server.listContainerPools(args),
    },
    {
      name: "stack_container_health",
      description: "Read /v1/pools/{pool_id}/container/health, or a task-scoped health route when task_id is provided.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          pool_id: stringProperty("Synth container pool id."),
          task_id: stringProperty("Optional pool task id for task-scoped container health."),
        },
        ["pool_id"],
      ),
      handler: (args) => server.containerHealth(args),
    },
    {
      name: "stack_container_rollout",
      description: "Run a bounded synchronous rollout through /v1/pools/{pool_id}/container/rollout, or the task-scoped route when task_id is provided. Pass the container-native JSON body unchanged.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          pool_id: stringProperty("Synth container pool id."),
          task_id: stringProperty("Optional pool task id for task-scoped container rollout."),
          body: jsonObjectProperty("Container-native rollout request JSON body."),
          timeout_seconds: numberProperty("Maximum wait for the rollout response. Defaults to 120, max 900."),
        },
        ["pool_id", "body"],
      ),
      handler: (args) => server.containerRollout(args),
    },
    {
      name: "stack_deploy_container_pool_runtime",
      description: "Create a runtime image release for a Synth container pool and bind it to the pool or task. Returns release_id for pool-backed heldout scoring.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the created runtime release as a hosted Effort ref."),
          pool_id: stringProperty("Synth container pool id."),
          task_id: stringProperty("Optional pool task id for task-scoped release bind."),
          runtime_kind: stringProperty("Runtime release kind. Defaults to image_ref, or service_url when service_url is supplied."),
          release_name: stringProperty("Optional runtime image release name."),
          provider: stringProperty("Optional runtime image release provider."),
          image_ref: stringProperty("Runtime image ref when runtime_kind=image_ref."),
          service_url: stringProperty("Service URL when runtime_kind=service_url."),
          archive_base64: stringProperty("Optional archive payload for docker_context/source_build runtime releases."),
          source_storage_uri: stringProperty("Optional source storage URI for docker_context/source_build runtime releases."),
          dockerfile_path: stringProperty("Dockerfile path for docker_context runtime releases."),
          base_image_ref: stringProperty("Base image ref for source_build runtime releases."),
          entrypoint: stringProperty("Optional runtime entrypoint."),
          env_vars: jsonObjectProperty("Optional runtime environment variables."),
          limits: jsonObjectProperty("Optional runtime resource limits."),
          metadata: jsonObjectProperty("Optional runtime release metadata."),
          body: jsonObjectProperty("Optional raw runtime_image_releases request body. Explicit top-level fields override this object."),
        },
        ["pool_id"],
      ),
      handler: (args) => server.deployContainerPoolRuntime(args),
    },
    {
      name: "stack_open_hosted_artifact",
      description: "Launch the system browser to the hosted artifact (or public shell) for a run. Returns receipt string on success. Does not embed; uses external browser (same split as Codex browser vs Sites).",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        run_id: { type: "string", description: "SMR run_id owning the artifact" },
        prefer: { type: "string", enum: ["hosted", "public_shell"], description: "hosted (default) or public_shell for usesynth.ai/openresearch/..." },
      }),
      handler: (args) => server.openHostedArtifact(args),
    },
    {
      name: "stack_artifact_create",
      description: "Create a local Stack Artifact Site page from a TSX page or static HTML file, copy optional data JSON, auto-serve the local site, and return the localhost URL.",
      inputSchema: objectSchema(
        {
          slug: stringProperty("Artifact slug, normalized to lowercase URL form."),
          title: stringProperty("Artifact title."),
          kind: { type: "string", enum: ["result", "analysis", "bloglet", "blog"], description: "Artifact kind. Defaults to result." },
          effort: stringProperty("Optional Effort slug/id for receipt context."),
          page_path: stringProperty("Workspace path to a TSX page. Mutually exclusive with html_path."),
          html_path: stringProperty("Workspace path to a static HTML file. Mutually exclusive with page_path."),
          data_path: stringProperty("Optional workspace path to JSON data copied into .stack/artifacts/data/<slug>/data.json."),
        },
        ["slug", "title"],
      ),
      handler: (args) => server.createArtifact(args),
    },
    {
      name: "stack_artifact_update",
      description: "Update an existing local Stack Artifact Site page, preserving identity while rewriting page/html/data metadata, then return the localhost URL.",
      inputSchema: objectSchema({
        slug: stringProperty("Existing artifact slug."),
        title: stringProperty("Optional replacement title."),
        kind: { type: "string", enum: ["result", "analysis", "bloglet", "blog"], description: "Optional replacement artifact kind." },
        effort: stringProperty("Optional Effort slug/id for receipt context."),
        page_path: stringProperty("Optional workspace path to a replacement TSX page. Mutually exclusive with html_path."),
        html_path: stringProperty("Optional workspace path to replacement static HTML. Mutually exclusive with page_path."),
        data_path: stringProperty("Optional workspace path to replacement JSON data."),
      }, ["slug"]),
      handler: (args) => server.updateArtifact(args),
    },
    {
      name: "stack_artifact_list",
      description: "List local Stack Artifact Site pages from the workspace .stack/artifacts manifest and report whether the local site is running.",
      inputSchema: objectSchema({}),
      handler: (args) => server.listArtifacts(args),
    },
    {
      name: "stack_artifact_open",
      description: "Open a local Stack Artifact Site page, or the gallery when slug is omitted, in the system browser.",
      inputSchema: objectSchema({
        slug: stringProperty("Optional artifact slug. Opens gallery when omitted."),
      }),
      handler: (args) => server.openArtifact(args),
    },
    {
      name: "stack_artifact_lint",
      description: "Run the local Artifact Site structural lint for a page: no external requests, receipt footer present, score-like stats cite splits, and compiled HTML stays below the 4 MiB cap.",
      inputSchema: objectSchema({ slug: stringProperty("Artifact slug to lint.") }, ["slug"]),
      handler: (args) => server.lintArtifact(args),
    },
    {
      name: "stack_artifact_publish",
      description: "Compile a local Artifact Site page to a self-contained HTML document and publish it as a Synth hosted artifact. Republish preserves hosted_artifact_id when present in the manifest.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          slug: stringProperty("Artifact slug to publish."),
          visibility: enumProperty(["private", "org", "public"], "Hosted artifact visibility. Defaults to org."),
          project_id: stringProperty("Synth project id for first publish. Republish can use the manifest hosted_artifact_id."),
          hosted_effort_id: stringProperty("Optional Synth hosted Effort id. Distinct from local Stack effort slug."),
          source_run_ids: arrayProperty("Optional source SMR run ids to carry into lineage."),
          trace_id: stringProperty("Optional trace id."),
          confirm_publish: { type: "boolean", description: "Must be true for the first hosted publish of this artifact. Republish is allowed after consent is recorded in the manifest." },
        },
        ["slug"],
      ),
      handler: (args) => server.publishArtifact(args),
    },
    {
      name: "stack_artifact_share",
      description: "Publish a local Artifact Site page if needed, then optionally promote it to a public Open Research artifact when public_slug and confirm_public=true are supplied.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          slug: stringProperty("Artifact slug to share."),
          visibility: enumProperty(["private", "org", "public"], "Hosted artifact visibility for the publish step. Defaults to org."),
          project_id: stringProperty("Synth project id for first publish. Republish can use the manifest hosted_artifact_id."),
          hosted_effort_id: stringProperty("Optional Synth hosted Effort id. Distinct from local Stack effort slug."),
          source_run_ids: arrayProperty("Optional source SMR run ids to carry into lineage."),
          trace_id: stringProperty("Optional trace id."),
          confirm_publish: { type: "boolean", description: "Must be true for the first hosted publish of this artifact. Republish is allowed after consent is recorded in the manifest." },
          public_slug: stringProperty("Optional public Open Research slug. Omit to publish org/private only."),
          confirm_public: { type: "boolean", description: "Must be true to create or reuse a public Open Research slug." },
        },
        ["slug"],
      ),
      handler: (args) => server.shareArtifact(args),
    },
    {
      name: "stack_list_factories",
      description: "List remote Research Factories and routable project/run hints for operator mediation. Uses stackd runtime snapshot first, with direct API fallback.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        tick: { type: "boolean", description: "If true, request one stackd /runtime/tick before reading factories." },
      }),
      handler: (args) => server.listFactories(args),
    },
    {
      name: "stack_list_hosted_optimizer_runs",
      description: "List hosted optimizer runs. Uses stackd runtime snapshot first, with direct API fallback for artifact/event details.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        tick: { type: "boolean", description: "If true, request one stackd /runtime/tick before reading hosted optimizer runs." },
      }),
      handler: (args) => server.listHostedOptimizerRuns(args),
    },
    {
      name: "stack_launch_gepa",
      description: "Submit a local GEPA job to the running synth-optimizers service, starting the service first by default. Uses POST /runs with config_path so the job appears in Local Research.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          config_path: stringProperty("Path to a GEPA TOML config, relative to Stack workingDir or absolute."),
          request_id: stringProperty("Optional stable request id for service idempotency/correlation."),
          start_service: { type: "boolean", description: "Start the local GEPA service first when it is not running. Defaults to true." },
          metadata: jsonObjectProperty("Optional metadata passed through to the local GEPA service."),
        },
        ["config_path"],
      ),
      handler: (args) => server.launchLocalGepa(args),
    },
    {
      name: "stack_submit_hosted_optimizer",
      description: "Submit a hosted GEPA optimizer run through synth-optimizers. Supports SynthTunnel by passing tunnel_url + tunnel_provider=synth_tunnel and follows by default while the lease is open.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the hosted optimizer run ref after successful submit."),
          config_path: stringProperty("Path to a hosted GEPA TOML config, relative to Stack workingDir or absolute."),
          run_id: stringProperty("Optional hosted optimizer run id."),
          idempotency_key: stringProperty("Optional idempotency key for submit retries."),
          project_id: stringProperty("Optional Synth project id."),
          tunnel_url: stringProperty("Optional local container URL to expose through SynthTunnel, e.g. http://127.0.0.1:8765."),
          tunnel_provider: enumProperty(["auto", "synth_tunnel", "cloudflared", "ngrok"], "Tunnel provider for tunnel_url. Defaults to synth_tunnel."),
          tunnel_ttl_seconds: numberProperty("SynthTunnel lease TTL in seconds. Defaults to CLI behavior, max 86400."),
          container_pool: stringProperty("Optional existing Synth container pool id instead of a tunnel URL."),
          container_task_id: stringProperty("Optional task id within container_pool."),
          follow: { type: "boolean", description: "Follow hosted optimizer events. Defaults to true when tunnel_url is set, otherwise false." },
          timeout_seconds: numberProperty("Maximum time Stack waits for the submit command. Defaults to 3600 when following, otherwise 300."),
        },
        ["config_path"],
      ),
      handler: (args) => server.submitHostedOptimizer(args),
    },
    {
      name: "stack_submit_hosted_optimizer_run",
      description: "Submit a hosted optimizer run through the backend optimizer owner route. Use algorithm=online-reflexion for the row-native online Reflexion run kind.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the hosted optimizer run ref after successful submit."),
          algorithm: enumProperty(["gepa", "go-ex", "mapo", "online-reflexion"], "Hosted optimizer algorithm."),
          run_id: stringProperty("Optional hosted optimizer run id."),
          idempotency_key: stringProperty("Optional idempotency key for submit retries."),
          project_id: stringProperty("Optional Synth project id."),
          config_json: jsonObjectProperty("Optimizer config object. Required unless config_toml is supplied."),
          config_toml: stringProperty("Optimizer config TOML. Required unless config_json is supplied."),
          container_pool: jsonObjectProperty("Optional backend OptimizerContainerPoolTarget."),
          timeout_seconds: numberProperty("Maximum time Stack waits for the backend submit response. Defaults to 300, max 86400."),
        },
        ["algorithm"],
      ),
      handler: (args) => server.submitHostedOptimizerRun(args),
    },
    {
      name: "stack_live_status",
      description: "Read Stack live operations status: recent SMR runs, factories, and hosted optimizer runs.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.liveStatus(args),
    },
    {
      name: "stack_effort_list",
      description: "List durable Stack Efforts with orientation fields: paths, latest progress/activity/unresolved blocker, latest typed optimizer candidate/run evidence/benchmark intake/release artifact proof, remaining_work, ref counts, artifact counts, handoff state, and parsed acceptance packet state. Efforts are long-lived workspaces for research or engineering work across threads, runs, findings, ideas, and proof artifacts.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        status: enumProperty([...STACK_EFFORT_STATUSES, "all"], "Optional Effort status filter. Defaults to all."),
      }),
      handler: (args) => server.listEfforts(args),
    },
    {
      name: "stack_effort_templates",
      description: "List available Stack Effort templates/playbooks, including bundled research/engineering/task templates, research-log support, finding folders, and seeded acceptance criteria.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
      }),
      handler: (args) => server.listEffortTemplates(args),
    },
    {
      name: "stack_effort_get",
      description: "Read one durable Stack Effort by id or slug, including manifest, registry record, workspace path refs, machine-readable artifact_inventory, parsed acceptance_packet when present, typed optimizer_candidates, typed run_evidence, typed benchmark intakes, typed release_artifacts, remaining_work, latest progress/activity, historical blocker tail, unresolved blocker tail, and bound meta-thread context.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.getEffort(args),
    },
    {
      name: "stack_tagged_effort_get",
      description: "Read which Effort is ON (active). Only one effort can be ON at a time (or none). Shown top-right as active: … and in Lights as ◉ ON. Returns null when none is ON.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
      }),
      handler: (args) => server.getTaggedEffort(args),
    },
    {
      name: "stack_tagged_effort_set",
      description: "Turn an Effort ON (active) or turn all OFF. Pass effort_ref as slug/id to turn one ON, or effort_ref=\"none\" to turn off. Running efforts are unchanged; this picks the single focus effort for evals and gardener.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        effort_ref: stringProperty('Effort slug/id to tag, or "none" to clear the tagged effort.'),
      }),
      handler: (args) => server.setTaggedEffort(args),
    },
    {
      name: "stack_effort_remaining",
      description: "Answer what remains for one Effort: parsed acceptance state, open acceptance levels, latest unresolved blocker, next safe actions, and key handoff/acceptance paths. Use this before handoff, resumption, or deciding whether A-level proof can be recorded.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.getEffortRemaining(args),
    },
    {
      name: "stack_effort_audit",
      description: "Run a read-only coherence audit for one Effort: scaffold, manifest/registry agreement, research-log shape, timelines, blockers, human context, idea origin tags, promoted idea backlinks, findings, receipt sidecars and digest integrity, handoff packet, acceptance packet, acceptance criteria coverage, declared claim requirements for recorded levels, refs, and meta-thread effort_ref back-links.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.auditEffort(args),
    },
    {
      name: "stack_effort_activity",
      description: "Read a bounded Effort activity timeline from ACTIVITY.jsonl. Use this when an agent or gardener needs more timeline context than stack_effort_get's compact activity_tail.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          limit: numberProperty("Maximum activity receipts to return. Defaults to 20, max 200."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.getEffortActivity(args),
    },
    {
      name: "stack_effort_refresh_receipts",
      description: "Refresh local digest metadata for existing receipt-backed Effort findings. Use after local/ad-hoc findings or nested proof directories changed and stack_effort_audit reports finding_receipt_digests drift.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.refreshEffortReceiptDigests(args),
    },
    {
      name: "stack_effort_create",
      description: "Create a durable Stack Effort folder from a bundled template such as research, engineering, task-classifier, or system-optimizer. Built-in templates may seed acceptance criteria.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          title: stringProperty("Human-readable Effort title."),
          slug: stringProperty("Optional folder/registry slug. Defaults to a slugified title."),
          template: stringProperty("Optional template id. Defaults to research."),
          topic: stringProperty("Optional research or engineering topic. Defaults to title."),
          folder_ref: stringProperty("Optional workspace-relative Effort folder. Defaults to efforts/<slug>."),
          acceptance_criteria: arrayProperty("Optional acceptance criteria recorded in effort.toml. Overrides template defaults when provided."),
        },
        ["title"],
      ),
      handler: (args) => server.createEffort(args),
    },
    {
      name: "stack_effort_bind_thread",
      description: "Bind a durable Stack Effort to a stackd meta-thread. This patches the meta-thread owner route, then updates the Effort reverse index.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          meta_thread_id: stringProperty("Stack meta-thread id."),
          reason: stringProperty("Optional short bind reason."),
          actor_id: stringProperty("Optional actor id. Defaults to operator."),
        },
        ["effort_ref", "meta_thread_id"],
      ),
      handler: (args) => server.bindEffortThread(args),
    },
    {
      name: "stack_effort_update_progress",
      description: "Append a timestamped progress entry to an Effort's PROGRESS.md.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          message: stringProperty("Progress message to append."),
        },
        ["effort_ref", "message"],
      ),
      handler: (args) => server.updateEffortProgress(args),
    },
    {
      name: "stack_effort_record_effort_session",
      description: "Record a durable effort_session id in EFFORT_SESSIONS.jsonl so downstream gardener, worker, benchmark, and research-log records can share one correlation tag.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          session_id: stringProperty("Optional caller-provided session id. Defaults to a generated effsess_<uuid>."),
          title: stringProperty("Human-readable session title."),
          actor: stringProperty("Optional actor label, such as gardener, worker, effortbench, or operator. Defaults to operator."),
          kind: stringProperty("Optional session kind, such as research, gardener, worker, or effortbench.live. Defaults to work."),
          summary: stringProperty("Optional one-line session summary. Defaults to title."),
          parent_session_id: stringProperty("Optional parent effort_session id for nested worker/gardener work."),
          tags: arrayProperty("Optional tags to make downstream work grepable."),
          payload: jsonObjectProperty("Optional structured metadata for this session."),
        },
        ["effort_ref", "title"],
      ),
      handler: (args) => server.recordEffortSession(args),
    },
    {
      name: "stack_effort_record_session",
      description: "Alias for stack_effort_record_effort_session.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          session_id: stringProperty("Optional caller-provided session id. Defaults to a generated effsess_<uuid>."),
          title: stringProperty("Human-readable effort_session title."),
          actor: stringProperty("Optional actor label, such as gardener, worker, effortbench, or operator. Defaults to operator."),
          kind: stringProperty("Optional effort_session kind, such as research, gardener, worker, or effortbench.live. Defaults to work."),
          summary: stringProperty("Optional one-line effort_session summary. Defaults to title."),
          parent_session_id: stringProperty("Optional parent effort_session id for nested worker/gardener work."),
          tags: arrayProperty("Optional tags to make downstream work grepable."),
          payload: jsonObjectProperty("Optional structured metadata for this effort_session."),
        },
        ["effort_ref", "title"],
      ),
      handler: (args) => server.recordEffortSession(args),
    },
    {
      name: "stack_effort_record_blocker",
      description: "Record an external blocker on an Effort without changing status to blocked. The progress entry and activity receipt include the blocker, evidence, next owner, and next safe action.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          blocker: stringProperty("Exact blocker or dependency."),
          evidence: stringProperty("Evidence that proves the blocker exists."),
          owner: stringProperty("Next owner responsible for clearing or deciding the blocker."),
          next: stringProperty("Next safe action while the Effort remains active or paused."),
        },
        ["effort_ref", "blocker", "evidence", "owner", "next"],
      ),
      handler: (args) => server.recordEffortBlocker(args),
    },
    {
      name: "stack_effort_resolve_blocker",
      description: "Resolve a previously recorded Effort blocker with an explicit activity receipt. Historical blocker evidence stays in ACTIVITY.jsonl and handoffs, but resolved blockers no longer drive latest_blocker or remaining_work.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          activity_id: stringProperty("Optional effort.blocker_recorded activity id. Defaults to the latest unresolved blocker."),
          resolution: stringProperty("How the blocker was cleared or superseded."),
          evidence: stringProperty("Optional evidence for the resolution, such as an audit result, run id, or artifact path."),
          owner: stringProperty("Optional owner who cleared or verified the resolution."),
        },
        ["effort_ref", "resolution"],
      ),
      handler: (args) => server.resolveEffortBlocker(args),
    },
    {
      name: "stack_effort_record_acceptance",
      description: "Record or update one acceptance level in an Effort's findings/results/acceptance-summary.md and append a typed acceptance activity receipt. Use this after concrete proof artifacts, receipts, or run ids exist. When the Effort declares a claim for the level, recorded updates are rejected until the claim's declared needs_refs and needs_evidence requirements are satisfied; use pending while proof is partial.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          level: stringProperty("Acceptance level such as A0, A1, A2, A3, or A4."),
          state: enumProperty(["recorded", "pending", "not_recorded"], "Acceptance state. Defaults to recorded."),
          status: stringProperty("Optional status text to write on the level's Status line."),
          evidence: arrayProperty("Evidence bullets to append to the acceptance level."),
          paths: arrayProperty("Artifact, receipt, config, or scorecard paths to append to the acceptance level."),
          result: stringProperty("Optional result summary."),
          decision: stringProperty("Optional decision or interpretation."),
          next: stringProperty("Optional next action for this acceptance level."),
        },
        ["effort_ref", "level"],
      ),
      handler: (args) => server.recordEffortAcceptance(args),
    },
    {
      name: "stack_effort_record_research_log",
      description: "Append a Craftax-style chronological research-log entry to a research Effort's research_log.md, preserving operator message text separately from summarized work. Use this for research Effort timeline continuity.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          title: stringProperty("Research-log session title."),
          session_id: stringProperty("Optional effort_session id from stack_effort_record_effort_session."),
          operator_message: stringProperty("Optional verbatim operator message for the **You:** block."),
          work_summary: stringProperty("Summarized agent work, runs, artifacts, and result."),
          result: stringProperty("Optional result summary."),
          metrics: arrayProperty("Optional metric/result bullets."),
          paths: arrayProperty("Optional key path bullets."),
          reproduce_commands: arrayProperty("Optional reproduce commands for a text block."),
          next: stringProperty("Optional next concrete research step."),
        },
        ["effort_ref", "title", "work_summary"],
      ),
      handler: (args) => server.recordEffortResearchLog(args),
    },
    {
      name: "stack_effort_write_handoff",
      description: "Write or refresh an Effort HANDOFF.md packet summarizing manifest state, refs, latest progress/activity, recorded blockers, acceptance criteria, acceptance packet pointer, embedded audit status, artifact inventory, risks, owner, and next step.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          summary: stringProperty("Optional handoff summary. Defaults to the Effort topic/title."),
          risks: arrayProperty("Optional risk/open-thread bullets."),
          next: stringProperty("Optional next concrete step."),
          owner: stringProperty("Optional next owner or handoff recipient."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.writeEffortHandoff(args),
    },
    {
      name: "stack_effort_write_engineering_packet",
      description: "Write or refresh an Engineering Effort change packet under findings/results with changed files, diff stat, validation, skipped gates, risks, and next action. Use this when the operator asks what changed or before engineering handoff/release review.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          summary: stringProperty("Optional engineering summary."),
          repo_path: stringProperty("Optional local git repo/worktree path. Relative paths first resolve inside the Effort folder, then from Stack workingDir."),
          base_ref: stringProperty("Optional git base ref for diff/stat. Defaults to HEAD for working-tree changes."),
          files: arrayProperty("Optional changed file list for manual packets."),
          diff_stat: stringProperty("Optional manual diff stat text. Overrides git-derived diff stat when provided."),
          validations: arrayProperty("Validation commands/results to record."),
          skipped_gates: arrayProperty("Skipped gates with reason and risk."),
          risks: arrayProperty("Risk/open-thread bullets."),
          next: stringProperty("Next concrete action."),
          filename: stringProperty("Optional target filename under findings/results/. Defaults to engineering-change-summary.md."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.writeEffortEngineeringPacket(args),
    },
    {
      name: "stack_effort_record_idea",
      description: "Record an idea under an Effort's ideas folder with [HUMAN], [AGENT], or [MIXED] origin tagging.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          origin: enumProperty([...STACK_EFFORT_IDEA_ORIGINS], "Idea origin. Defaults to AGENT for MCP calls."),
          title: stringProperty("Idea title."),
          body: stringProperty("Optional idea body."),
          filename: stringProperty("Optional markdown filename inside the ideas folder."),
        },
        ["effort_ref", "title"],
      ),
      handler: (args) => server.recordEffortIdea(args),
    },
    {
      name: "stack_effort_record_note",
      description: "Record human context or working notes under an Effort's human/ or notes/ folder. Use kind=human for operator constraints/original phrasing that must survive handoffs. These are included in generated HANDOFF.md packets.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          kind: enumProperty([...STACK_EFFORT_NOTE_KINDS], "Note kind. human writes to human/; note writes to notes/. Defaults to note."),
          title: stringProperty("Note title."),
          body: stringProperty("Optional note body."),
          filename: stringProperty("Optional markdown filename inside the selected folder."),
        },
        ["effort_ref", "title"],
      ),
      handler: (args) => server.recordEffortNote(args),
    },
    {
      name: "stack_effort_record_repo",
      description: "Attach a local repo/worktree path under an Effort's repos/ folder and optionally record a repo ref in effort.toml. Directory paths write pointer records instead of recursive copies. Included in generated HANDOFF.md packets.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          path: stringProperty("Local repo/worktree path. Relative paths first resolve inside the Effort folder, then from Stack workingDir."),
          repo_ref: stringProperty("Optional durable repo ref to append to effort.toml links.repo_refs."),
          title: stringProperty("Optional attachment title. Defaults to the source basename."),
          filename: stringProperty("Optional target filename/folder name inside repos/."),
        },
        ["effort_ref", "path"],
      ),
      handler: (args) => server.recordEffortRepo(args),
    },
    {
      name: "stack_effort_record_finding",
      description: "Record an Effort finding under findings/{ideas,code,data,proof,results}, either as markdown body text, by copying/linking a local path with an Effort-local source receipt, or from a stack_pull_artifact receipt. Returns source_receipt for both local and pulled evidence.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          kind: enumProperty([...STACK_EFFORT_FINDING_KINDS], "Finding kind."),
          title: stringProperty("Finding title."),
          body: stringProperty("Optional markdown body. Used when path is omitted."),
          path: stringProperty("Optional local path. Relative paths first resolve inside the Effort folder, then from Stack workingDir."),
          receipt_path: stringProperty("Optional stack_pull_artifact receipt path. Mutually exclusive with path; records the pulled workspace_path and hosted/saved receipt metadata as the finding source."),
          filename: stringProperty("Optional target filename."),
        },
        ["effort_ref", "kind", "title"],
      ),
      handler: (args) => server.recordEffortFinding(args),
    },
    {
      name: "stack_memory_record",
      description:
        "Record a typed runtime memory into the Stack guidance ledgers via stackd. Kinds are the registered MLDP instances (papercut, mistake, learning, desire); entries land in .stack/guidance/records/<kind>/ and mirror into the eval packet when running in eval mode.",
      inputSchema: objectSchema(
        {
          kind: enumProperty(["papercut", "mistake", "learning", "desire"], "Memory kind (registered instance)."),
          summary: stringProperty("One-line memory summary."),
          body: stringProperty("Optional markdown detail."),
          file: stringProperty("Optional relevant source or workflow file, optionally with :line."),
          severity: enumProperty(["LOW", "MED", "HIGH"], "Optional severity. Defaults per kind."),
          source: enumProperty(["gardener", "monitor", "worker", "operator", "mcp"], "Who is recording. Defaults to mcp."),
          thread_id: stringProperty("Optional thread id provenance."),
          effort_ref: stringProperty("Optional Effort id or slug provenance."),
        },
        ["kind", "summary"],
      ),
      handler: async (args) => {
        const context: Record<string, string> = {}
        const threadId = optionalString(args, "thread_id")
        if (threadId) context.thread_id = threadId
        const effortRef = optionalString(args, "effort_ref")
        if (effortRef) context.effort = effortRef
        const receipt = await stackdRecordMemory({
          kind: requiredString(args, "kind"),
          summary: requiredString(args, "summary"),
          body: optionalString(args, "body"),
          file: optionalString(args, "file"),
          severity: optionalString(args, "severity") as StackdMemorySeverity | undefined,
          source: (optionalString(args, "source") as StackdMemorySource | undefined) ?? "mcp",
          context,
          packet_dir: process.env.STACKEVAL_PACKET?.trim() || undefined,
        })
        return toJsonValue(receipt) ?? null
      },
    },
    {
      name: "stack_memory_kinds",
      description: "List the registered runtime memory kinds (the MLDP set) with descriptions and default severities.",
      inputSchema: objectSchema({}),
      handler: async () => toJsonValue(await stackdMemoryKinds()) ?? null,
    },
    {
      name: "stack_memory_list",
      description: "List recent runtime memory entries of one kind from the Stack guidance ledgers.",
      inputSchema: objectSchema(
        {
          kind: enumProperty(["papercut", "mistake", "learning", "desire"], "Memory kind."),
          recent: stringProperty("Optional max entries to return (default 20)."),
        },
        ["kind"],
      ),
      handler: async (args) => {
        const recentRaw = optionalString(args, "recent")
        const recent = recentRaw ? Number.parseInt(recentRaw, 10) : 20
        return toJsonValue(await stackdListMemories(requiredString(args, "kind"), Number.isFinite(recent) && recent > 0 ? recent : 20)) ?? null
      },
    },
    {
      name: "stack_assembly_create",
      description:
        "Create an AssemblyLine — the process layer above Efforts — via stackd. One station schema, preset ship (intake→…→prod→readout) or effort (intake→…→monitor→follow_up). Bindings reference Efforts, meta-threads, actors, evidence artifacts, and the external Jstack ship bundle path (a linked record, not a second source of truth).",
      inputSchema: objectSchema(
        {
          title: stringProperty("Line title."),
          preset: enumProperty(["ship", "effort"], "Station preset."),
          owner: stringProperty("Owning actor id."),
          actor_id: stringProperty("Actor recording the creation. Defaults to operator."),
          effort_ids: arrayProperty("Optional bound Stack Effort ids."),
          meta_thread_ids: arrayProperty("Optional bound meta-thread ids."),
          worker_ids: arrayProperty("Optional bound worker actor ids (manifest-associated workers only)."),
          gardener_ids: arrayProperty("Optional bound gardener actor ids."),
          monitor_ids: arrayProperty("Optional bound monitor actor ids (monitors audit and recommend; they do not own gate verdicts)."),
          evidence_paths: arrayProperty("Optional evidence artifact paths."),
          ship_bundle_path: stringProperty("Optional external Jstack markdown ship bundle path (linked record)."),
        },
        ["title", "preset", "owner"],
      ),
      handler: async (args) => {
        const bindings: StackdAssemblyBindings = {
          effort_ids: optionalStringArray(args, "effort_ids") ?? [],
          meta_thread_ids: optionalStringArray(args, "meta_thread_ids") ?? [],
          worker_ids: optionalStringArray(args, "worker_ids") ?? [],
          gardener_ids: optionalStringArray(args, "gardener_ids") ?? [],
          monitor_ids: optionalStringArray(args, "monitor_ids") ?? [],
          evidence_paths: optionalStringArray(args, "evidence_paths") ?? [],
          ship_bundle_path: optionalString(args, "ship_bundle_path") ?? null,
        }
        const result = await stackdAssemblyCreate({
          title: requiredString(args, "title"),
          preset: requiredString(args, "preset") as StackdAssemblyPreset,
          owner: requiredString(args, "owner"),
          bindings,
          actor_id: optionalString(args, "actor_id"),
        })
        return toJsonValue(result) ?? null
      },
    },
    {
      name: "stack_assembly_list",
      description:
        "List AssemblyLine snapshots from stackd: line id, preset, current station, owner, age, open gate, next action.",
      inputSchema: objectSchema({}),
      handler: async () => toJsonValue(await stackdAssemblyList()) ?? null,
    },
    {
      name: "stack_assembly_get",
      description: "Read one AssemblyLine: record, full typed event log, and snapshot projection.",
      inputSchema: objectSchema(
        {
          line_id: stringProperty("AssemblyLine id."),
        },
        ["line_id"],
      ),
      handler: async (args) => toJsonValue(await stackdAssemblyGet(requiredString(args, "line_id"))) ?? null,
    },
    {
      name: "stack_assembly_transition",
      description:
        "Append one typed transition event to an AssemblyLine. Stations complete in preset order; completion requires evidence when the station schema requires it; gate_failed requires verdict (concern|fail) plus next_owner and next_safe_action; shipped requires the preset ship station completed. Invalid transitions return typed errors (unknown_station, invalid_transition, missing_evidence, invalid_gate_event).",
      inputSchema: objectSchema(
        {
          line_id: stringProperty("AssemblyLine id."),
          kind: enumProperty(
            [
              "assembly.station_started",
              "assembly.station_completed",
              "assembly.gate_failed",
              "assembly.gate_passed",
              "assembly.shipped",
              "assembly.follow_up_due",
            ],
            "Transition event kind.",
          ),
          station: stringProperty("Station id. Required for station and gate events."),
          actor_id: stringProperty("Actor issuing the transition."),
          verdict: enumProperty(["pass", "concern", "fail", "n_a"], "Standards gate verdict. Required for gate events."),
          next_owner: stringProperty("Required on gate_failed: actor who owns resolving the gate."),
          next_safe_action: stringProperty("Required on gate_failed: the one concrete next action."),
          evidence_paths: arrayProperty("Evidence artifact paths. Required to complete evidence-bearing stations."),
          due_at: stringProperty("Required on follow_up_due: RFC3339 due timestamp."),
          note: stringProperty("Optional note."),
        },
        ["line_id", "kind", "actor_id"],
      ),
      handler: async (args) => {
        const lineId = requiredString(args, "line_id")
        const transition = assemblyTransitionFromArgs(args)
        return toJsonValue(await stackdAssemblyTransition(lineId, transition)) ?? null
      },
    },
    {
      name: "stack_effort_record_capture",
      description: "Capture terminal/browser/screenshot/video/local/monitor/memory/text/benchmark/optimizer evidence into an Effort finding with capture-oriented source receipt metadata. Use this for ad hoc evidence when no richer adapter exists.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          capture_kind: enumProperty([...STACK_EFFORT_CAPTURE_KINDS], "Capture source kind."),
          kind: enumProperty([...STACK_EFFORT_FINDING_KINDS], "Optional finding kind. Defaults to proof except benchmark defaults to data."),
          title: stringProperty("Capture title."),
          body: stringProperty("Optional markdown body. Useful for terminal/text captures when path is omitted."),
          path: stringProperty("Optional local path. Relative paths first resolve inside the Effort folder, then from Stack workingDir."),
          receipt_path: stringProperty("Optional stack_pull_artifact receipt path. Mutually exclusive with path; records the pulled workspace_path and hosted/saved receipt metadata as the capture source."),
          filename: stringProperty("Optional target filename."),
        },
        ["effort_ref", "capture_kind", "title"],
      ),
      handler: (args) => server.recordEffortCapture(args),
    },
    {
      name: "stack_effort_record_benchmark",
      description: "Record first-class benchmark intake metadata under findings/data with optional local or pulled source receipt provenance. Use this when adopting or downloading a benchmark so source, license, task shape, splits, and metrics survive handoffs.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          title: stringProperty("Optional benchmark intake title. Defaults from name, version, or benchmark id."),
          benchmark_id: stringProperty("Optional benchmark id, slug, or registry key."),
          name: stringProperty("Optional benchmark display name. Defaults from title or benchmark_id."),
          version: stringProperty("Optional benchmark version, snapshot, commit, or date."),
          source: stringProperty("Optional benchmark source URL, repo, registry ref, or citation."),
          license: stringProperty("Optional license or access constraint."),
          task_shape: stringProperty("Optional task shape summary, such as classifier, agentic, non-verifiable, or long-horizon."),
          splits: arrayProperty("Optional split names or split policy, such as train, visible, heldout."),
          metrics: arrayProperty("Optional metric names or score definitions."),
          body: stringProperty("Optional markdown notes about ingestion, caveats, provenance, or processing."),
          path: stringProperty("Optional local benchmark metadata/source path. Relative paths first resolve inside the Effort folder, then from Stack workingDir."),
          receipt_path: stringProperty("Optional stack_pull_artifact receipt path. Mutually exclusive with path; records pulled workspace_path and hosted/saved receipt metadata."),
          filename: stringProperty("Optional target filename under findings/data/."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.recordEffortBenchmark(args),
    },
    {
      name: "stack_effort_record_optimizer_candidate",
      description: "Record a typed optimizer candidate/score artifact under an Effort's findings/proof folder. Use this for GEPA or hosted optimizer candidates when candidate id, score, split, and source artifact provenance matter more than a generic optimizer capture.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          title: stringProperty("Optional candidate title. Defaults from candidate id and score."),
          optimizer_run_id: stringProperty("Optional optimizer or hosted optimizer run id."),
          candidate_id: stringProperty("Optional candidate id/name."),
          score: stringProperty("Optional score or metric value."),
          score_label: stringProperty("Optional score label, such as heldout accuracy or validation reward."),
          split: stringProperty("Optional eval split, such as visible, heldout, or smoke."),
          body: stringProperty("Optional markdown notes about the candidate."),
          path: stringProperty("Optional local candidate artifact path. Relative paths first resolve inside the Effort folder, then from Stack workingDir."),
          receipt_path: stringProperty("Optional stack_pull_artifact receipt path. Mutually exclusive with path; records pulled workspace_path and hosted/saved receipt metadata."),
          filename: stringProperty("Optional target filename."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.recordEffortOptimizerCandidate(args),
    },
    {
      name: "stack_effort_record_run_evidence",
      description: "Record typed run proof under an Effort's findings/proof folder for any run system (smr, tinker, local, ...). This attaches the run/project refs, tags an optional claim label, and preserves pulled-artifact or local source receipt provenance; record it before recording a claim that requires run evidence.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          run_kind: stringProperty("Run evidence kind: an open lowercase identifier for the run system, such as smr for hosted harness runs, tinker for training-style runs, or local for local harness runs."),
          title: stringProperty("Optional evidence title. Defaults from run kind, run id, and metric."),
          run_id: stringProperty("Optional SMR or Tinker run id. When receipt_path is provided, defaults from the receipt run id when available."),
          project_id: stringProperty("Optional Synth project id. When receipt_path is provided, defaults from the receipt project id when available."),
          output_id: stringProperty("Optional WorkProduct/artifact/model output id."),
          artifact_name: stringProperty("Optional artifact or scorecard name."),
          metric: stringProperty("Optional metric/result string, such as heldout accuracy 0.86."),
          acceptance_level: stringProperty("Optional acceptance lane this evidence supports, such as A3 or A4."),
          body: stringProperty("Optional markdown notes about the run evidence."),
          path: stringProperty("Optional local run evidence path. Relative paths first resolve inside the Effort folder, then from Stack workingDir."),
          receipt_path: stringProperty("Optional stack_pull_artifact receipt path. Mutually exclusive with path; records pulled workspace_path and hosted/saved receipt metadata."),
          filename: stringProperty("Optional target filename."),
        },
        ["effort_ref", "run_kind"],
      ),
      handler: (args) => server.recordEffortRunEvidence(args),
    },
    {
      name: "stack_effort_record_release_artifact",
      description: "Record typed release artifact proof under an Effort's findings/proof folder. Use this for Stack release/nightly tarball summaries or manifests so version, target, sha256, size, publishability, and receipt provenance survive handoffs.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          title: stringProperty("Optional release artifact title. Defaults from version and target."),
          version: stringProperty("Optional release or dev version. When path points at package_release_artifact summary JSON, defaults from that file."),
          channel: stringProperty("Optional release channel, such as nightly, dev, or stable."),
          target: stringProperty("Optional target triple, such as aarch64-apple-darwin."),
          archive: stringProperty("Optional archive path or URL."),
          sha256: stringProperty("Optional archive sha256."),
          size: stringProperty("Optional archive size in bytes."),
          manifest: stringProperty("Optional manifest path or URL."),
          release_site: stringProperty("Optional release-site path or URL."),
          publishable: { type: "boolean", description: "Optional publishable flag from the artifact summary." },
          publish_blockers: arrayProperty("Optional publish blockers from the artifact summary."),
          body: stringProperty("Optional markdown notes about packaging, publish caveats, or manifest decisions."),
          path: stringProperty("Optional local release artifact summary/manifest path. Relative paths first resolve inside the Effort folder, then from Stack workingDir."),
          receipt_path: stringProperty("Optional stack_pull_artifact receipt path. Mutually exclusive with path; records pulled workspace_path and hosted/saved receipt metadata."),
          filename: stringProperty("Optional target filename."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.recordEffortReleaseArtifact(args),
    },
    {
      name: "stack_effort_record_artifact",
      description: "Record the current local Artifact Site page manifest row as typed artifact.webpage evidence under an Effort, including local/hosted/public URLs, sha256, version, and cited splits.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          slug: stringProperty("Local Artifact Site page slug."),
          splits_cited: arrayProperty("Optional split names cited by the artifact page scores."),
          body: stringProperty("Optional markdown note for the evidence body."),
          filename: stringProperty("Optional target filename."),
        },
        ["effort_ref", "slug"],
      ),
      handler: (args) => server.recordEffortArtifact(args),
    },
    {
      name: "stack_effort_update_refs",
      description: "Attach durable external system refs to an Effort manifest as {system, id, lane, role} entries. Use system/id/lane for any external system (smr, tinker, optimizer, factory, project, github.pr, ...); the named *_id fields are conveniences for common systems. This records ids only; use findings for artifact evidence.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          system: stringProperty("Optional external system for a generic ref, such as smr, tinker, optimizer, factory, project, or github.pr. Requires id."),
          id: stringProperty("Optional external id for the generic system ref."),
          lane: stringProperty("Optional lane for the ref: hosted or local. Also applies to the named *_id conveniences."),
          role: stringProperty("Optional free-form role label for the generic ref."),
          factory_id: stringProperty("Optional Synth Factory id to set or replace."),
          hosted_effort_id: stringProperty("Optional hosted/backend Effort id to set or replace."),
          project_id: stringProperty("Optional Synth project id to set or replace."),
          optimizer_run_id: stringProperty("Optional optimizer run id to append if missing."),
          smr_run_id: stringProperty("Optional SMR run id to append if missing."),
          tinker_run_id: stringProperty("Optional Tinker or training-style run id to append if missing."),
          repo_ref: stringProperty("Optional repo/worktree ref to append if missing."),
          initiative_id: stringProperty("Optional initiative id to set or replace."),
        },
        ["effort_ref"],
      ),
      handler: (args) => server.updateEffortRefs(args),
    },
    {
      name: "stack_effort_launch",
      description: "Launch a run for an Effort through an explicit declared capability. Refuses launches whose capability is outside the Effort's scope.capabilities, then records the launch ref on the Effort manifest and ACTIVITY.jsonl. Kinds: optimizer, smr, container, project, factory, training, artifact. Project/factory/container launch through owner-route clients here; training/artifact are scope-only and should use their standalone Stack cloud tools.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          kind: enumProperty([...EFFORT_LAUNCH_KINDS], `Launch kind: ${EFFORT_LAUNCH_KINDS.join(", ")}.`),
          capability: enumProperty([...EFFORT_LAUNCH_CAPABILITIES], "Exact capability id to use. Lane and optimizer derive from this value."),
          config_path: stringProperty("GEPA config TOML path, required for kind=optimizer."),
          tunnel_url: stringProperty("Optional tunnel URL for hosted optimizer runs."),
          container_pool: stringProperty("Optional container pool override for hosted optimizer runs."),
          goal: stringProperty("Launch objective text for kind=smr. Required unless request.objective is supplied."),
          project_id: stringProperty("Optional Synth project id for kind=smr."),
          factory_id: stringProperty("Optional Synth factory id for kind=smr."),
          pool_id: stringProperty("Container pool id, required for kind=container."),
          task_id: stringProperty("Optional task id for kind=container rollouts."),
          split: stringProperty("Dataset split for container.pool.hosted rollout body. Defaults to test."),
          seed: numberProperty("Seed for container.pool.hosted rollout body. Defaults to 7."),
          policy_name: stringProperty("Policy name for container.pool.hosted rollout body. Defaults to stack_effort_launch."),
          policy_config: objectSchema({}, []),
          request: jsonObjectProperty("Raw owner-route request body for smr.hosted, project.hosted, or factory.hosted launches. For smr.hosted this is merged into the Managed Research preflight/trigger payload; for project.hosted it must match SmrRunnableProjectCreateRequest."),
          name: stringProperty("Factory name for factory.hosted when request.name is omitted."),
          description: stringProperty("Optional factory description for factory.hosted."),
          status: stringProperty("Optional factory status for factory.hosted."),
          image_ref: stringProperty("Runtime image ref for container.deploy.hosted when runtime_kind=image_ref."),
          service_url: stringProperty("Service URL for container.deploy.hosted when runtime_kind=service_url."),
          runtime_kind: stringProperty("Runtime release kind for container.deploy.hosted. Defaults to image_ref, or service_url when service_url is supplied."),
          release_name: stringProperty("Optional runtime image release name for container.deploy.hosted."),
          provider: stringProperty("Optional runtime image release provider for container.deploy.hosted."),
          archive_base64: stringProperty("Optional archive payload for docker_context/source_build runtime releases."),
          source_storage_uri: stringProperty("Optional source storage URI for docker_context/source_build runtime releases."),
          dockerfile_path: stringProperty("Dockerfile path for docker_context runtime releases."),
          base_image_ref: stringProperty("Base image ref for source_build runtime releases."),
        },
        ["effort_ref", "kind", "capability"],
      ),
      handler: (args) => server.launchEffort(args),
    },
    {
      name: "stack_effort_update_status",
      description: "Set an Effort status to active, paused, done, or archived. Efforts never use blocked status; record blockers as progress or findings.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Effort id or slug."),
          status: enumProperty([...STACK_EFFORT_STATUSES], "Desired Effort status."),
          confirm: booleanProperty("Required true when status=archived."),
        },
        ["effort_ref", "status"],
      ),
      handler: (args) => server.updateEffortStatus(args),
    },
    {
      name: "stack_meta_threads_list",
      description: "List Stack meta-threads with lifecycle and goal state. Defaults to lifecycle=live; use all or archived for broader views.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        lifecycle: enumProperty(["live", "archived", "all"], "Optional lifecycle filter. Defaults to live."),
        limit: numberProperty("Maximum meta-threads to return. Defaults to 50, max 200."),
      }),
      handler: (args) => server.listMetaThreads(args),
    },
    {
      name: "stack_meta_thread_get",
      description: "Read one Stack meta-thread manifest with derived lifecycle and head-thread summary fields.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          meta_thread_id: stringProperty("Stack meta-thread id."),
        },
        ["meta_thread_id"],
      ),
      handler: (args) => server.getMetaThread(args),
    },
    {
      name: "stack_meta_thread_create",
      description: "Bind an existing Stack session/thread to a durable Stack meta-thread through stackd. Optionally assigns an active goal and binds the new meta-thread into an Effort at creation time.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Existing Stack session/thread id to bind."),
          effort_ref: stringProperty("Optional Effort id or slug to bind at creation time. Writes effort_ref on the meta-thread and appends the meta-thread ref to the Effort."),
          title: stringProperty("Short meta-thread title. Defaults to objective when omitted."),
          objective: stringProperty("Optional goal objective to assign to the meta-thread."),
          status: enumProperty(["active", "done", "paused"], "Optional goal status when objective is provided. Defaults to active."),
          acceptance_criteria: { type: "array", items: { type: "string" }, description: "Optional goal acceptance criteria." },
          blockers: { type: "array", items: { type: "string" }, description: "Optional blocker notes recorded on the active goal without changing status to blocked." },
          role: stringProperty("Optional segment role. Defaults to implement."),
          model: stringProperty("Optional worker model. Defaults to the configured worker model."),
          reasoning_effort: stringProperty("Optional reasoning effort. Defaults to configured worker effort."),
          harness: stringProperty("Optional harness name. Defaults to configured harness."),
          source: stringProperty("Optional provenance source. Defaults to gardener."),
          source_ref: stringProperty("Optional provenance reference, such as a source meta-thread id."),
          repo_refs: { type: "array", items: { type: "string" }, description: "Optional repo refs." },
          worktree_refs: { type: "array", items: { type: "string" }, description: "Optional worktree refs. Defaults to the configured workspace root." },
          gardener_thread_id: stringProperty("Optional gardener thread id that requested creation."),
          monitor_profile: stringProperty("Optional monitor profile."),
          actor_role: enumProperty(["gardener", "operator"], "Actor role. Defaults to gardener."),
        },
        ["thread_id"],
      ),
      handler: (args) => server.createMetaThread(args),
    },
    {
      name: "stack_worker_thread_create",
      description: "Create a new local Stack worker session, then bind it to a durable stackd meta-thread and, optionally, an Effort. Use this when the gardener needs to spawn a real thread that appears in Threads/Lights and belongs to a durable workstream.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        effort_ref: stringProperty("Optional Effort id or slug to bind at creation time. Writes effort_ref on the meta-thread and appends the meta-thread ref to the Effort."),
        title: stringProperty("Short thread/meta-thread title. Defaults to objective or 'new worker thread'."),
        objective: stringProperty("Optional goal objective to assign immediately."),
        status: enumProperty(["active", "done", "paused"], "Optional goal status when objective is provided. Defaults to active."),
        acceptance_criteria: { type: "array", items: { type: "string" }, description: "Optional goal acceptance criteria." },
        blockers: { type: "array", items: { type: "string" }, description: "Optional blocker notes recorded on the active goal without changing status to blocked." },
        workspace_root: stringProperty("Optional workspace root. Defaults to Stack's configured workspace root."),
        role: stringProperty("Optional segment role. Defaults to implement."),
        model: stringProperty("Optional worker model. Defaults to the configured worker model."),
        reasoning_effort: stringProperty("Optional reasoning effort. Defaults to configured worker effort."),
        harness: stringProperty("Optional harness name. Defaults to configured harness."),
        source: stringProperty("Optional provenance source. Defaults to gardener."),
        source_ref: stringProperty("Optional provenance reference, such as the source meta-thread id."),
        repo_refs: { type: "array", items: { type: "string" }, description: "Optional repo refs." },
        worktree_refs: { type: "array", items: { type: "string" }, description: "Optional worktree refs. Defaults to the new session workspace root." },
        gardener_thread_id: stringProperty("Optional gardener thread id that requested creation."),
        monitor_profile: stringProperty("Optional monitor profile."),
        actor_role: enumProperty(["gardener", "operator"], "Actor role. Defaults to gardener."),
      }),
      handler: (args) => server.createWorkerThread(args),
    },
    {
      name: "stack_worker_run",
      description: "Start a background Codex run for a durable Stack worker through the Rust stackd runner. Returns worker_run.started immediately; the runner takes turns until the goal is done, a blocker is recorded, a pause is requested, an error, or the turn budget is reached (default 3, cap 25). Poll stack_worker_run_status for liveness — do not assume the worker finished when this returns.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Stack worker thread/session id."),
          objective: stringProperty("Optional objective for the run. Defaults to the worker meta-thread active goal."),
          max_turns: { type: "integer", description: "Optional turn budget for this run (default 3, hard cap 25)." },
          monitor_profile: stringProperty("Optional monitor profile; auto-enables the sidecar and is recorded on the worker_run.started event."),
        },
        ["thread_id"],
      ),
      handler: (args) => server.workerRun(args),
    },
    {
      name: "stack_worker_run_status",
      description: "Read authoritative worker execution liveness from stackd. A durable worker with turns=0 is idle even when its meta-thread goal is active.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Stack worker thread/session id."),
        },
        ["thread_id"],
      ),
      handler: (args) => server.workerRunStatus(args),
    },
    {
      name: "stack_worker_continue",
      description: "Resume or nudge a paused/idle durable Stack worker run through the Rust stackd runner. Runs until done, blocker, pause, error, or the turn budget.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Stack worker thread/session id."),
          note: stringProperty("Optional continuation note for the next worker turn."),
          max_turns: { type: "integer", description: "Optional turn budget for this continuation." },
        },
        ["thread_id"],
      ),
      handler: (args) => server.workerContinue(args),
    },
    {
      name: "stack_worker_pause",
      description: "Request that a background worker run stop after the current turn. Leaves the lane resumable with stack_worker_continue.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Stack worker thread/session id."),
          reason: stringProperty("Short reason for pausing the worker run."),
        },
        ["thread_id", "reason"],
      ),
      handler: (args) => server.workerPause(args),
    },
    {
      name: "stack_meta_thread_update_goal",
      description: "Assign or update the goal on an existing durable Stack meta-thread through stackd. Use this instead of create when the thread is already bound.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          meta_thread_id: stringProperty("Existing Stack meta-thread id."),
          objective: stringProperty("Optional new goal objective."),
          status: enumProperty(["active", "done", "paused"], "Optional goal status. Defaults to existing status or active in stackd."),
          acceptance_criteria: { type: "array", items: { type: "string" }, description: "Optional replacement goal acceptance criteria." },
          blockers: { type: "array", items: { type: "string" }, description: "Optional blocker notes recorded on the goal without changing status to blocked." },
          actor_role: enumProperty(["gardener", "operator"], "Actor role. Defaults to gardener."),
        },
        ["meta_thread_id"],
      ),
      handler: (args) => server.updateMetaThreadGoal(args),
    },
    {
      name: "stack_meta_thread_set_lifecycle",
      description: "Set a Stack meta-thread lifecycle to live or archived through stackd owner routes. Gardener/operator only; monitor is rejected. Archive requires confirm=true.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          meta_thread_id: stringProperty("Stack meta-thread id."),
          status: enumProperty(["live", "archived"], "Desired lifecycle status."),
          reason: stringProperty("Optional short operator/gardener reason."),
          actor_id: stringProperty("Optional actor id. Defaults to actor_role."),
          actor_role: enumProperty(["gardener", "operator", "monitor"], "Actor role. Defaults to gardener; monitor is rejected."),
          confirm: { type: "boolean", description: "Required true when status=archived." },
        },
        ["meta_thread_id", "status"],
      ),
      handler: (args) => server.setMetaThreadLifecycle(args),
    },
    {
      name: "stack_meta_thread_set_title",
      description: "Set the human-editable Stack meta-thread title through the stackd owner route. Gardener, monitor, and operator may rename; durable ids never change.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          meta_thread_id: stringProperty("Stack meta-thread id."),
          title: stringProperty("New short title, max 48 characters."),
          reason: stringProperty("Optional short rename reason."),
          actor_id: stringProperty("Optional actor id. Defaults to actor_role."),
          actor_role: enumProperty(["gardener", "operator", "monitor", "remote_gardener"], "Actor role. Defaults to gardener."),
        },
        ["meta_thread_id", "title"],
      ),
      handler: (args) => server.setMetaThreadTitle(args),
    },
    {
      name: "stack_message_live_run",
      description: "Send an operator message to a live SMR run through the backend runtime-message owner route.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the SMR run ref after a successful message."),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id for context payload."),
          body: stringProperty("Operator message body."),
        },
        ["run_id", "body"],
      ),
      handler: (args) => server.messageLiveRun(args),
    },
    {
      name: "stack_message_factory_project",
      description: "Send an operator message through the selected Factory's backend-owned message route.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the Factory ref after a successful message."),
          factory_id: stringProperty("Factory id."),
          factory_name: stringProperty("Optional display name."),
          project_id: stringProperty("Optional project id for message metadata only. The backend resolves the routable project."),
          body: stringProperty("Operator message body."),
        },
        ["factory_id", "body"],
      ),
      handler: (args) => server.messageFactoryProject(args),
    },
    {
      name: "stack_wake_factory",
      description: "Wake due Factory work through the backend-owned wake-due route. Requires confirm=true and records a runtime receipt.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the Factory ref after a successful wake."),
          factory_id: stringProperty("Factory id."),
          factory_name: stringProperty("Optional display name."),
          project_id: stringProperty("Optional project id for receipt correlation."),
          confirm: { type: "boolean", description: "Required true to wake due Factory work." },
        },
        ["factory_id", "confirm"],
      ),
      handler: (args) => server.wakeFactory(args),
    },
    {
      name: "stack_control_factory",
      description: "Pause or resume a Factory through the backend-owned Factory patch route. Requires confirm=true and records a runtime receipt.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records the Factory ref after a successful pause or resume."),
          factory_id: stringProperty("Factory id."),
          factory_name: stringProperty("Optional display name."),
          project_id: stringProperty("Optional project id for receipt correlation."),
          action: enumProperty(["pause-factory", "resume-factory"], "Control action."),
          confirm: { type: "boolean", description: "Required true to pause or resume a Factory." },
        },
        ["factory_id", "action", "confirm"],
      ),
      handler: (args) => server.controlFactory(args),
    },
    {
      name: "stack_control_live_run",
      description: "Pause, resume, or stop a live SMR run through backend owner routes.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id for project-scoped control."),
          action: enumProperty(["pause-run", "resume-run", "stop-run"], "Control action."),
        },
        ["run_id", "action"],
      ),
      handler: (args) => server.controlLiveRun(args),
    },
    {
      name: "stack_cancel_hosted_optimizer",
      description: "Request cancellation for a hosted optimizer run through the optimizer owner route.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("Hosted optimizer run id."),
        },
        ["run_id"],
      ),
      handler: (args) => server.cancelHostedOptimizer(args),
    },
    {
      name: "stack_preview_hosted_optimizer_artifact",
      description: "Preview bounded text from a hosted optimizer artifact through the optimizer owner route.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("Hosted optimizer run id."),
          artifact_name: stringProperty("Hosted optimizer artifact name."),
          max_bytes: numberProperty("Maximum preview bytes to return. Defaults to 8192, max 65536."),
        },
        ["run_id", "artifact_name"],
      ),
      handler: (args) => server.previewHostedOptimizerArtifact(args),
    },
    {
      name: "stack_audit_online_reflexion_receipt",
      description: "Audit receipt completeness for one hosted online Reflexion optimizer run through the optimizer owner route. Use this before citing a run in release/blog evidence.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records run evidence for the audit result."),
          run_id: stringProperty("Hosted online Reflexion optimizer run id."),
          strict: { type: "boolean", description: "If true, the backend returns a non-2xx status unless the audit passes." },
        },
        ["run_id"],
      ),
      handler: (args) => server.auditOnlineReflexionReceipt(args),
    },
    {
      name: "stack_audit_online_reflexion_receipts",
      description: "Audit receipt completeness for a hosted online Reflexion publish-candidate run set through the optimizer owner route. Select by explicit run_ids or recent layer/project receipts.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records a proof finding for the aggregate audit result."),
          run_ids: arrayProperty("Optional explicit hosted online Reflexion optimizer run ids, max 100."),
          layer_id: stringProperty("Optional online Reflexion layer id for recent receipt selection."),
          project_id: stringProperty("Optional Synth project id for recent receipt selection."),
          strict: { type: "boolean", description: "If true, the backend returns a non-2xx status unless every selected run passes." },
          limit: numberProperty("Maximum recent receipts to audit when run_ids is omitted. Defaults to backend behavior, max 100."),
        },
        [],
      ),
      handler: (args) => server.auditOnlineReflexionReceiptSet(args),
    },
    {
      name: "stack_build_online_reflexion_evidence_packet",
      description: "Build a read-only online Reflexion release evidence packet from receipt audits plus explicit eval-lane evidence. Does not approve public copy; public_copy_allowed stays false until owner approval is supplied.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records a proof finding for the evidence packet."),
          run_ids: arrayProperty("Optional explicit hosted online Reflexion optimizer run ids, max 100."),
          layer_id: stringProperty("Optional online Reflexion layer id for recent receipt selection."),
          project_id: stringProperty("Optional Synth project id for recent receipt selection."),
          evidence_notes: jsonObjectProperty("Optional lane evidence keyed by craftax_rotated_121_125, alfworld_6x6_x3, ebr_first_scale_compare, harvey_lab_pilot, and hosted_staging_smoke. A lane is complete only when its value is true, ok=true, or status is pass/complete/ready/succeeded."),
          blog_decision_owner: stringProperty("Human owner for blog/release approval. Defaults to Josh."),
          blog_approved_by_owner: booleanProperty("Set true only after the human owner has approved public release copy. Defaults false."),
          include_receipt_summaries: booleanProperty("Whether to include recent receipt summaries when selecting by layer/project or recent receipts. Defaults true."),
          limit: numberProperty("Maximum recent receipts to audit when run_ids is omitted. Defaults to backend behavior, max 100."),
        },
        [],
      ),
      handler: (args) => server.buildOnlineReflexionEvidencePacket(args),
    },
    {
      name: "stack_download_hosted_optimizer_artifact",
      description: "Download a hosted optimizer artifact through the optimizer owner route into Stack download state.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records run evidence for the downloaded optimizer artifact."),
          run_id: stringProperty("Hosted optimizer run id."),
          artifact_name: stringProperty("Hosted optimizer artifact name."),
        },
        ["run_id", "artifact_name"],
      ),
      handler: (args) => server.downloadHostedOptimizerArtifact(args),
    },
    {
      name: "stack_download_run_output",
      description: "Download a WorkProduct or artifact from an SMR run through backend owner content routes.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records run evidence for the downloaded output."),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id. Required to discover WorkProducts when the run is not in the recent job list."),
          output_kind: enumProperty(["work-product", "artifact"], "Optional output kind. Defaults to first WorkProduct, then first artifact."),
          output_id: stringProperty("Optional WorkProduct or artifact id."),
          index: numberProperty("Zero-based output index within output_kind, or within WorkProducts then artifacts when output_kind is omitted."),
        },
        ["run_id"],
      ),
      handler: (args) => server.downloadRunOutput(args),
    },
    {
      name: "stack_list_run_work_products",
      description: "List WorkProducts for an SMR run using the project-scoped backend owner route, inferring project_id from recent remote runs when possible.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id. Required if the run is not discoverable in recent remote run state."),
        },
        ["run_id"],
      ),
      handler: (args) => server.listRunWorkProducts(args),
    },
    {
      name: "stack_download_work_product",
      description: "Download a specific WorkProduct from an SMR run to Stack download state.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          effort_ref: stringProperty("Optional Effort id or slug. When supplied, records run evidence for the downloaded WorkProduct."),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id. Required if the run is not discoverable in recent remote run state."),
          work_product_id: stringProperty("WorkProduct id to download."),
        },
        ["run_id", "work_product_id"],
      ),
      handler: (args) => server.downloadWorkProduct(args),
    },
    {
      name: "stack_preview_run_output",
      description: "Preview bounded text content from a WorkProduct or artifact through backend owner content routes.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("SMR run id."),
          project_id: stringProperty("Optional project id. Required to discover WorkProducts when the run is not in the recent job list."),
          output_kind: enumProperty(["work-product", "artifact"], "Optional output kind. Defaults to first WorkProduct, then first artifact."),
          output_id: stringProperty("Optional WorkProduct or artifact id."),
          index: numberProperty("Zero-based output index within output_kind, or within WorkProducts then artifacts when output_kind is omitted."),
          max_bytes: numberProperty("Maximum preview bytes to return. Defaults to 8192, max 65536."),
        },
        ["run_id"],
      ),
      handler: (args) => server.previewRunOutput(args),
    },
    {
      name: "stack_list_saved_downloads",
      description: "List persisted Stack download history for the selected environment.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.listSavedDownloads(args),
    },
    {
      name: "stack_preview_saved_download",
      description: "Preview bounded text from a previously downloaded WorkProduct or artifact saved under Stack download state.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          index: numberProperty("Zero-based download history index. Defaults to the newest saved download."),
          run_id: stringProperty("Optional run id filter."),
          output_id: stringProperty("Optional WorkProduct or artifact id filter."),
          path: stringProperty("Optional exact saved path filter from stack_list_saved_downloads."),
          max_bytes: numberProperty("Maximum preview bytes to return. Defaults to 8192, max 65536."),
        },
      ),
      handler: (args) => server.previewSavedDownload(args),
    },
    {
      name: "stack_upload_run_file",
      description: "Upload a local file to a live SMR run through the backend run-file owner route.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          run_id: stringProperty("SMR run id."),
          local_path: stringProperty("Local file path. Relative paths resolve from Stack's configured workingDir."),
          remote_path: stringProperty("Optional run file path. Defaults to the local filename."),
          visibility: enumProperty(["model", "verifier"], "Optional file visibility. Defaults to model, which also notifies/mounts for the run."),
          content_type: stringProperty("Optional content type. Stack infers common text types when omitted."),
          kind: stringProperty("Optional backend file kind metadata."),
        },
        ["run_id", "local_path"],
      ),
      handler: (args) => server.uploadRunFile(args),
    },
    {
      name: "stack_pull_artifact",
      description: "Pull a typed hosted or saved artifact into the workspace and write a provenance receipt.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          artifact_kind: enumProperty([...ROUND_TRIP_ARTIFACT_KINDS], "Artifact kind to pull."),
          source: enumProperty(["hosted_optimizer", "saved_download", "local_file"], "Optional source. Defaults to hosted_optimizer."),
          run_id: stringProperty("Hosted optimizer or SMR run id."),
          project_id: stringProperty("Optional project id for provenance."),
          artifact_name: stringProperty("Hosted optimizer artifact name. If omitted, Stack chooses the best artifact name for artifact_kind from the hosted snapshot."),
          source_path: stringProperty("Local source file path for source=local_file. Relative paths resolve from Stack's workingDir."),
          saved_download_path: stringProperty("Saved download path from stack_list_saved_downloads for source=saved_download."),
          output_id: stringProperty("Optional saved WorkProduct or artifact id filter for source=saved_download."),
          index: numberProperty("Zero-based saved-download index. Defaults to 0."),
          destination_path: stringProperty("Optional workspace destination path. Defaults to .stack/roundtrip/<env>/<run>/<kind>-<artifact>."),
          receipt_path: stringProperty("Optional workspace receipt path. Defaults to .stack/evidence/roundtrip/."),
        },
        ["artifact_kind"],
      ),
      handler: (args) => server.pullArtifact(args),
    },
    {
      name: "stack_apply_artifact",
      description: "Apply a pulled champion_prompt artifact into a harness config and write an apply receipt.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          artifact_kind: enumProperty([...ROUND_TRIP_ARTIFACT_KINDS], "Artifact kind to apply. Currently champion_prompt only."),
          artifact_path: stringProperty("Pulled artifact path. Relative paths resolve from Stack's workingDir."),
          receipt_path: stringProperty("Pull receipt path. When supplied, Stack reads the pulled artifact path from the receipt."),
          target_path: stringProperty("Harness/config path to patch. Relative paths resolve from Stack's workingDir."),
          mode: enumProperty(["toml-string-field", "replace-file"], "Apply mode. Defaults to toml-string-field."),
          toml_field: stringProperty("TOML field path for mode=toml-string-field. Defaults to seed_candidate.stage2_system."),
          prompt_json_path: stringProperty("Optional dot path for prompt text inside a JSON artifact."),
          create_missing: booleanProperty("Create the TOML section or field if it is missing. Defaults to false."),
        },
        ["artifact_kind", "target_path"],
      ),
      handler: (args) => server.applyArtifact(args),
    },
    {
      name: "stack_push_artifact",
      description: "Push a typed workspace artifact to an SMR run-file owner route and write a provenance receipt.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          artifact_kind: enumProperty([...ROUND_TRIP_ARTIFACT_KINDS], "Artifact kind to push."),
          artifact_path: stringProperty("Workspace artifact path to upload. Relative paths resolve from Stack's workingDir."),
          receipt_path: stringProperty("Optional pull receipt path. When supplied, Stack reads the artifact path from the receipt."),
          run_id: stringProperty("SMR run id to receive the file."),
          remote_path: stringProperty("Optional remote run-file path. Defaults to roundtrip/<artifact_kind>/<filename>."),
          visibility: enumProperty(["model", "verifier"], "Optional file visibility. Defaults to model."),
          content_type: stringProperty("Optional content type. Stack infers common text types when omitted."),
        },
        ["artifact_kind", "run_id"],
      ),
      handler: (args) => server.pushArtifact(args),
    },
    {
      name: "stack_skills_list",
      description: "List first-class Stack skills from .stack/skills plus bridged Codex/plugin skill roots.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        query: stringProperty("Optional search query. When set, returns matching skills only."),
        limit: numberProperty("Maximum skills to return. Defaults to 100, max 500."),
      }),
      handler: (args) => server.listSkills(args),
    },
    {
      name: "stack_skills_read",
      description: "Read a first-class skill by id, including SKILL.md content and metadata.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          skill_id: stringProperty("Skill id, skill name, or exact SKILL.md path."),
          max_bytes: numberProperty("Maximum SKILL.md bytes to return. Defaults to 50000, max 200000."),
          thread_id: stringProperty("Optional Stack thread/session id. When present, records a skill.read meta event."),
          actor_id: stringProperty("Optional actor id for the skill.read event."),
          actor_role: enumProperty(["primary", "monitor", "system", "unknown"], "Optional actor role for the skill.read event."),
          reason: stringProperty("Optional reason recorded on the skill.read event."),
        },
        ["skill_id"],
      ),
      handler: (args) => server.readSkill(args),
    },
    {
      name: "stack_skills_search",
      description: "Search first-class Stack skills by id, title, description, owner, and path.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          query: stringProperty("Search terms."),
          limit: numberProperty("Maximum skills to return. Defaults to 20, max 100."),
        },
        ["query"],
      ),
      handler: (args) => server.searchSkills(args),
    },
    {
      name: "stack_guidance_list",
      description: "List Stack guidance from .stack/guidance plus workspace and personal guidance sources.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        scope: enumProperty(["style", "records", "workflows", "all"], "Optional guidance scope. Defaults to all."),
        style_layer: enumProperty(["org", "repo", "personal", "app"], "Optional style layer filter. Defaults to all."),
        limit: numberProperty("Maximum guidance items to return. Defaults to 100, max 500."),
      }),
      handler: (args) => server.listGuidance(args),
    },
    {
      name: "stack_search_guidance",
      description: "Search Stack guidance, workspace style, and personal guidance by query.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          query: stringProperty("Search terms."),
          scope: enumProperty(["style", "records", "workflows", "all"], "Optional guidance scope. Defaults to all."),
          style_layer: enumProperty(["org", "repo", "personal", "app"], "Optional style layer filter. Defaults to all."),
          limit: numberProperty("Maximum guidance hits to return. Defaults to 20, max 100."),
          max_excerpt_bytes: numberProperty("Maximum excerpt bytes per hit. Defaults to 600, max 5000."),
          thread_id: stringProperty("Optional Stack thread/session id. When present, records a guidance.query meta event."),
          actor_id: stringProperty("Optional actor id for the guidance.query event."),
          actor_role: enumProperty(["primary", "monitor", "system", "unknown"], "Optional actor role for the guidance.query event."),
        },
        ["query"],
      ),
      handler: (args) => server.searchGuidance(args),
    },
    {
      name: "stack_guidance_read",
      description: "Read a guidance item by id, relative path, or exact source path; optionally record guidance.read.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          guidance_id: stringProperty("Guidance id, relative path, or exact source path."),
          max_bytes: numberProperty("Maximum markdown bytes to return. Defaults to 50000, max 200000."),
          thread_id: stringProperty("Optional Stack thread/session id. When present, records a guidance.read meta event."),
          actor_id: stringProperty("Optional actor id for the guidance.read event."),
          actor_role: enumProperty(["primary", "monitor", "system", "unknown"], "Optional actor role for the guidance.read event."),
          reason: stringProperty("Optional reason recorded on the guidance.read event."),
        },
        ["guidance_id"],
      ),
      handler: (args) => server.readGuidance(args),
    },
    {
      name: "stack_guidance_record_event",
      description: "Record a guidance lifecycle, usage, or impact event in the local guidance SQLite ledger.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          event_type: enumProperty(
            [
              "guidance.doc_added",
              "guidance.doc_updated",
              "guidance.doc_deleted",
              "guidance.used",
              "guidance.impact_judged",
              "guidance.query",
            ],
            "Guidance event type.",
          ),
          guidance_id: stringProperty("Optional guidance id associated with the event."),
          actor_id: stringProperty("Optional actor id."),
          actor_role: enumProperty(["primary", "monitor", "system", "unknown"], "Optional actor role."),
          thread_id: stringProperty("Optional Stack thread/session id."),
          impact: enumProperty(["helped", "hurt", "neutral", "unknown"], "Required for guidance.impact_judged."),
          confidence: enumProperty(["low", "medium", "high"], "Optional confidence for impact or attribution."),
          reason: stringProperty("Optional concise reason."),
          evidence_event_ids: arrayProperty("Optional event ids, trace ids, or packet ids supporting this record."),
          payload: jsonObjectProperty("Optional structured metadata for this event."),
        },
        ["event_type"],
      ),
      handler: (args) => server.recordGuidanceEvent(args),
    },
    {
      name: "stack_guidance_events",
      description: "List local guidance SQLite ledger events, newest first.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        guidance_id: stringProperty("Optional guidance id filter."),
        event_type: enumProperty(
          [
            "guidance.doc_added",
            "guidance.doc_updated",
            "guidance.doc_deleted",
            "guidance.used",
            "guidance.impact_judged",
            "guidance.query",
          ],
          "Optional guidance event type filter.",
        ),
        thread_id: stringProperty("Optional thread/session id filter."),
        limit: numberProperty("Maximum events to return. Defaults to 50, max 500."),
      }),
      handler: (args) => server.listGuidanceEvents(args),
    },
    {
      name: "stack_local_threads_list",
      description: "List local Stack threads from stackd.",
      inputSchema: objectSchema({}, []),
      handler: (args) => server.listLocalThreads(args),
    },
    {
      name: "stack_local_thread_read",
      description: "Read one local Stack thread from stackd.",
      inputSchema: objectSchema(
        {
          thread_id: stringProperty("Stack thread/session id."),
        },
        ["thread_id"],
      ),
      handler: (args) => server.readLocalThread(args),
    },
    {
      name: "stack_local_thread_trace",
      description: "Return trace/observability summary for one local Stack thread from stackd.",
      inputSchema: objectSchema(
        {
          thread_id: stringProperty("Stack thread/session id."),
        },
        ["thread_id"],
      ),
      handler: (args) => server.traceLocalThread(args),
    },
    {
      name: "stack_local_thread_export",
      description: "Export one local Stack thread through stackd.",
      inputSchema: objectSchema(
        {
          thread_id: stringProperty("Stack thread/session id."),
        },
        ["thread_id"],
      ),
      handler: (args) => server.exportLocalThread(args),
    },
    {
      name: "stack_skills_push_context",
      description: "Record an explicit monitor-to-primary skill context push. Returns the visible message that should be sent to the primary actor.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Stack thread/session id receiving the context push."),
          monitor_actor_id: stringProperty("Monitor actor id issuing the push."),
          target_actor_id: stringProperty("Primary actor id receiving the push."),
          skill_id: stringProperty("Skill id to push."),
          reason: stringProperty("Why the monitor is pushing this skill now."),
          evidence_event_ids: arrayProperty("Optional event ids that justify the push."),
          message: stringProperty("Optional explicit message body. Defaults to a concise skill handoff message."),
        },
        ["thread_id", "monitor_actor_id", "target_actor_id", "skill_id", "reason"],
      ),
      handler: (args) => server.pushSkillContext(args),
    },
  ]
}

function readMessage(buffer: Buffer): { message: ParsedMessage; remaining: Buffer } | undefined {
  if (buffer.length === 0) return undefined
  if (buffer.toString("utf8", 0, Math.min(buffer.length, 15)).startsWith("Content-Length")) {
    const headerEnd = buffer.indexOf("\r\n\r\n")
    if (headerEnd < 0) return undefined
    const header = buffer.toString("ascii", 0, headerEnd)
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    if (!match?.[1]) throw new Error("missing Content-Length")
    const length = Number.parseInt(match[1], 10)
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    if (buffer.length < bodyEnd) return undefined
    const payload = JSON.parse(buffer.toString("utf8", bodyStart, bodyEnd)) as JsonObject
    return { message: { payload, framing: "content-length" }, remaining: buffer.subarray(bodyEnd) }
  }
  const lineEnd = buffer.indexOf("\n")
  if (lineEnd < 0) return undefined
  const line = buffer.toString("utf8", 0, lineEnd).trim()
  const remaining = buffer.subarray(lineEnd + 1)
  if (!line) return { message: { payload: {}, framing: "jsonl" }, remaining }
  return { message: { payload: JSON.parse(line) as JsonObject, framing: "jsonl" }, remaining }
}

function writeMessage(payload: JsonObject, framing: Framing): void {
  const text = JSON.stringify(payload)
  if (framing === "content-length") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(text, "utf8")}\r\n\r\n${text}`)
  } else {
    process.stdout.write(`${text}\n`)
  }
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: JsonValue,
  ) {
    super(message)
  }
}

function response(id: RpcId, result: JsonValue): JsonObject {
  return { jsonrpc: "2.0", id, result }
}

function errorResponse(id: RpcId, error: unknown): JsonObject {
  const rpcError = error instanceof RpcError ? error : new RpcError(-32000, errorMessage(error))
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: rpcError.code,
      message: rpcError.message,
      ...(rpcError.data === undefined ? {} : { data: rpcError.data }),
    },
  }
}

function objectSchema(properties: Record<string, JsonObject>, required: string[] = []): JsonObject {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }
}

function stringProperty(description: string): JsonObject {
  return { type: "string", description }
}

function enumProperty(values: string[], description: string): JsonObject {
  return { type: "string", enum: values, description }
}

function numberProperty(description: string): JsonObject {
  return { type: "number", description }
}

function booleanProperty(description: string): JsonObject {
  return { type: "boolean", description }
}

function arrayProperty(description: string): JsonObject {
  return { type: "array", items: { type: "string" }, description }
}

function jsonObjectProperty(description: string): JsonObject {
  return { type: "object", additionalProperties: true, description }
}

function environmentProperty(): JsonObject {
  return {
    type: "string",
    enum: ["dev", "staging", "prod"],
    description: "Optional Stack environment. Defaults to stack.config.json or STACK_ENVIRONMENT.",
  }
}

function optionalBridgeMode(args: JsonObject): StackBridgeMode | undefined {
  const value = optionalString(args, "mode")
  if (!value) return undefined
  if (value === "local" || value === "remote" || value === "all") return value
  throw new RpcError(-32602, "mode must be local, remote, or all")
}

function optionalArtifactVisibility(args: JsonObject, key: string): "private" | "org" | "public" | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (value === "private" || value === "org" || value === "public") return value
  throw new RpcError(-32602, `${key} must be private, org, or public`)
}

function optionalMetaThreadLifecycle(
  args: JsonObject,
  key: string,
): StackdMetaThreadLifecycleStatus | "all" | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (value === "live" || value === "archived" || value === "all") return value
  throw new RpcError(-32602, `${key} must be live, archived, or all`)
}

function requiredMetaThreadLifecycle(args: JsonObject, key: string): StackdMetaThreadLifecycleStatus {
  const value = requiredString(args, key)
  if (value === "live" || value === "archived") return value
  throw new RpcError(-32602, `${key} must be live or archived`)
}

function optionalEffortStatusOrAll(args: JsonObject, key: string): StackEffortStatus | "all" | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (value === "all" || STACK_EFFORT_STATUSES.includes(value as StackEffortStatus)) return value as StackEffortStatus | "all"
  throw new RpcError(-32602, `${key} must be active, paused, done, archived, or all`)
}

function requiredEffortStatus(args: JsonObject, key: string): StackEffortStatus {
  const value = requiredString(args, key)
  if (STACK_EFFORT_STATUSES.includes(value as StackEffortStatus)) return value as StackEffortStatus
  if (value === "blocked") {
    throw new RpcError(-32602, "Efforts never use status=blocked; keep the Effort active or paused and record the blocker with stack_effort_record_blocker")
  }
  throw new RpcError(-32602, `${key} must be active, paused, done, or archived`)
}

function requiredEffortFindingKind(args: JsonObject, key: string): StackEffortFindingKind {
  const value = requiredString(args, key)
  if (STACK_EFFORT_FINDING_KINDS.includes(value as StackEffortFindingKind)) return value as StackEffortFindingKind
  throw new RpcError(-32602, `${key} must be idea, code, data, proof, or result`)
}

function optionalEffortFindingKind(args: JsonObject, key: string): StackEffortFindingKind | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (STACK_EFFORT_FINDING_KINDS.includes(value as StackEffortFindingKind)) return value as StackEffortFindingKind
  throw new RpcError(-32602, `${key} must be idea, code, data, proof, or result`)
}

function requiredEffortCaptureKind(args: JsonObject, key: string): StackEffortCaptureKind {
  const value = requiredString(args, key)
  if (STACK_EFFORT_CAPTURE_KINDS.includes(value as StackEffortCaptureKind)) return value as StackEffortCaptureKind
  throw new RpcError(-32602, `${key} must be terminal, browser, screenshot, video, local, monitor, memory, text, benchmark, or optimizer`)
}

function requiredEffortRunEvidenceKind(args: JsonObject, key: string): string {
  const value = requiredString(args, key)
  if (/^[a-z][a-z0-9_-]*$/.test(value)) return value
  throw new RpcError(-32602, `${key} must be a lowercase identifier like smr, tinker, or local`)
}

function optionalEffortIdeaOrigin(args: JsonObject, key: string): StackEffortIdeaOrigin | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (STACK_EFFORT_IDEA_ORIGINS.includes(value as StackEffortIdeaOrigin)) return value as StackEffortIdeaOrigin
  throw new RpcError(-32602, `${key} must be HUMAN, AGENT, or MIXED`)
}

function optionalEffortNoteKind(args: JsonObject, key: string): StackEffortNoteKind | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (STACK_EFFORT_NOTE_KINDS.includes(value as StackEffortNoteKind)) return value as StackEffortNoteKind
  throw new RpcError(-32602, `${key} must be human or note`)
}

function resolveEffortSourcePath(config: StackConfig, effortFolderPath: string, rawPath: string): string {
  const inEffort = resolve(effortFolderPath, rawPath)
  if (existsSync(inEffort)) return inEffort
  return resolve(config.workingDir, rawPath)
}

function metaThreadListItem(stackRoot: string, manifest: {
  id: string
  title: string
  lifecycle_status?: string
  archived_at?: string
  archived_by?: string
  archive_reason?: string
  active_goal?: { objective?: string; status?: string }
  smr_run_id?: string
  remote_bindings?: Array<{ kind?: string; smr_run_id?: string }>
  head_thread_id?: string
  head_segment_id?: string
  monitor_profile?: string
  updated_at?: string
}): JsonObject {
  const monitorHeadline = manifest.head_thread_id
    ? latestMonitorHeadline(stackRoot, manifest.head_thread_id)
    : undefined
  return {
    id: manifest.id,
    title: manifest.title,
    lifecycle_status: manifest.lifecycle_status ?? "live",
    archived_at: manifest.archived_at ?? null,
    archived_by: manifest.archived_by ?? null,
    archive_reason: manifest.archive_reason ?? null,
    active_goal: manifest.active_goal
      ? {
          objective: manifest.active_goal.objective ?? "",
          status: manifest.active_goal.status ?? "active",
        }
      : null,
    head_thread_id: manifest.head_thread_id ?? null,
    head_segment_id: manifest.head_segment_id ?? null,
    smr_run_id: manifest.smr_run_id ?? null,
    remote_bindings: manifest.remote_bindings ?? [],
    monitor_profile: manifest.monitor_profile ?? null,
    monitor_headline: monitorHeadline ?? null,
    updated_at: manifest.updated_at ?? null,
  }
}

function latestMonitorHeadline(stackRoot: string, threadId: string): JsonObject | undefined {
  const event = [...readThreadMetaEvents(stackRoot, threadId)]
    .reverse()
    .find((entry) => entry.type === "monitor.goal_status" && entry.payload.for_human === true)
  if (!event) return undefined
  return {
    status: typeof event.payload.status === "string" ? event.payload.status : "working",
    headline: typeof event.payload.headline === "string" ? event.payload.headline : "",
    note: typeof event.payload.note === "string" ? event.payload.note : "",
    observed_at: event.observed_at,
    event_id: event.event_id,
  }
}

function optionalGuidanceScope(args: JsonObject): StackGuidanceScope | undefined {
  const value = optionalString(args, "scope")
  if (!value) return undefined
  if (value === "style" || value === "records" || value === "workflows" || value === "all") return value
  throw new RpcError(-32602, "scope must be style, records, workflows, or all")
}

function optionalStyleLayer(args: JsonObject): StackStyleLayer | undefined {
  const value = optionalString(args, "style_layer")
  if (!value) return undefined
  if (value === "org" || value === "repo" || value === "personal" || value === "app") return value
  throw new RpcError(-32602, "style_layer must be org, repo, personal, or app")
}

function requiredGuidanceEventType(args: JsonObject, key: string): StackGuidanceEventType {
  const value = requiredString(args, key)
  const parsed = parseGuidanceEventType(value)
  if (!parsed) throw new RpcError(-32602, `${key} must be a known guidance event type`)
  return parsed
}

function optionalGuidanceEventType(args: JsonObject, key: string): StackGuidanceEventType | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  const parsed = parseGuidanceEventType(value)
  if (!parsed) throw new RpcError(-32602, `${key} must be a known guidance event type`)
  return parsed
}

function parseGuidanceEventType(value: string): StackGuidanceEventType | undefined {
  if (
    value === "guidance.doc_added" ||
    value === "guidance.doc_updated" ||
    value === "guidance.doc_deleted" ||
    value === "guidance.used" ||
    value === "guidance.impact_judged" ||
    value === "guidance.query"
  ) return value
  return undefined
}

function optionalGuidanceImpact(args: JsonObject): StackGuidanceImpact | undefined {
  const value = optionalString(args, "impact")
  if (!value) return undefined
  if (value === "helped" || value === "hurt" || value === "neutral" || value === "unknown") return value
  throw new RpcError(-32602, "impact must be helped, hurt, neutral, or unknown")
}

function optionalConfidence(args: JsonObject): "low" | "medium" | "high" | undefined {
  const value = optionalString(args, "confidence")
  if (!value) return undefined
  if (value === "low" || value === "medium" || value === "high") return value
  throw new RpcError(-32602, "confidence must be low, medium, or high")
}

function isActiveState(value: string | undefined): boolean {
  const normalized = (value ?? "").toLowerCase()
  return [
    "active",
    "claimed",
    "created",
    "pending",
    "queued",
    "running",
    "started",
    "starting",
    "submitted",
    "waiting",
  ].includes(normalized)
}

function bridgeNextActions(
  mode: StackBridgeMode,
  hasAuth: boolean,
  remoteRunCount: number,
  hostedRunCount: number,
): string[] {
  const actions = ["call stack_status with mode local or remote to narrow the operator view"]
  if (mode !== "local" && !hasAuth) {
    actions.push("set the selected environment auth key or configure authEnvFile before remote actions")
  }
  if (mode !== "local" && hasAuth && remoteRunCount === 0) {
    actions.push("create or select a remote SMR run from the owning evals/synth-dev workflow, then call stack_list_live_smrs")
  }
  if (mode !== "local" && hasAuth && remoteRunCount > 0) {
    actions.push("call stack_list_live_smrs, then preview outputs with stack_preview_run_output")
  }
  if (mode !== "local" && hasAuth && hostedRunCount > 0) {
    actions.push("call stack_list_hosted_optimizer_runs, then preview artifacts with stack_preview_hosted_optimizer_artifact")
  }
  if (mode !== "remote") {
    actions.push("inspect local optimizer status from stack_status before starting local optimizer work")
  }
  return actions
}

function actionResult(result: RemoteActionResult): JsonValue {
  return { ok: result.ok, status: result.status, message: result.message }
}

function actionResultWithData(result: RemoteActionResult, extra: Record<string, unknown> = {}): JsonValue {
  const runtimeEvent = asRecord(toJsonValue(extra.runtime_event))
  const localReceiptWarning =
    runtimeEvent && runtimeEvent.ok === false
      ? [
          `remote action ${result.ok ? "landed" : "returned"}`,
          `local runtime receipt failed: ${readString(runtimeEvent.message) ?? "unknown error"}`,
        ].join("; ")
      : undefined
  return toJsonValue({
    ok: result.ok,
    status: result.status,
    message: localReceiptWarning ? `${result.message}; ${localReceiptWarning}` : result.message,
    data: result.data ?? null,
    ...(localReceiptWarning ? { local_receipt_warning: localReceiptWarning } : {}),
    ...extra,
  }) ?? null
}

function remoteActionPayload(result: RemoteActionResult): Record<string, unknown> {
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    data: result.data ?? null,
  }
}

function remoteRunRef(args: JsonObject): Pick<RemoteSmrRunSummary, "runId" | "projectId"> {
  return {
    runId: requiredString(args, "run_id"),
    projectId: optionalString(args, "project_id"),
  }
}

function requiredApprovalDecision(args: JsonObject): "approve" | "deny" {
  const decision = requiredString(args, "decision")
  if (decision === "approve" || decision === "deny") return decision
  throw new RpcError(-32602, "decision must be approve or deny")
}

type HarnessCommandEvent = {
  eventType: "command.start" | "command.exit" | "command.failed"
  phase: "started" | "completed"
  runId: string
  command: string
  argv: string[]
  cwd: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  exitCode?: number
  timedOut?: boolean
  stdoutTail?: string
  stderrTail?: string
}

function projectHarnessCommandEvent(stackRoot: string, event: HarnessCommandEvent): void {
  projectLogDocumentToVictoriaLogs(stackRoot, {
    _time: event.completedAt ?? event.startedAt,
    _msg: `harness-cmd ${event.phase} ${event.runId}`,
    level: event.eventType === "command.exit" ? "info" : event.eventType === "command.start" ? "info" : "error",
    logger: "stack.harness_cmd",
    slot: process.env.STACK_VL_SLOT ?? "slot1",
    service: "harness-cmd",
    event_domain: "local_optimizer",
    event_type: event.eventType,
    phase: event.phase,
    run_id: event.runId,
    command: event.command,
    argv_preview: event.argv.slice(0, 16).join(" "),
    cwd: event.cwd,
    started_at: event.startedAt,
    ...(event.completedAt ? { completed_at: event.completedAt } : {}),
    ...(event.durationMs !== undefined ? { duration_ms: event.durationMs } : {}),
    ...(event.exitCode !== undefined ? { exit_code: event.exitCode } : {}),
    ...(event.timedOut !== undefined ? { timed_out: event.timedOut } : {}),
    ...(event.stdoutTail ? { stdout_tail: event.stdoutTail } : {}),
    ...(event.stderrTail ? { stderr_tail: event.stderrTail } : {}),
  })
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function tailText(value: string, bytes: number): string {
  if (bytes <= 0) return ""
  const encoded = Buffer.from(value)
  return encoded.length <= bytes ? value : encoded.subarray(encoded.length - bytes).toString("utf8")
}

function hostedOptimizerAuditStatus(data: Record<string, unknown> | undefined): string | undefined {
  const status = data?.status
  return typeof status === "string" && status.trim() ? status.trim() : undefined
}

function hostedOptimizerAuditEvidenceBody(summary: string, data: Record<string, unknown> | undefined): string {
  const payload = JSON.stringify(data ?? {}, null, 2)
  const bounded = payload.length > 12000 ? `${payload.slice(0, 12000)}\n... <truncated>` : payload
  return `${summary}\n\n\`\`\`json\n${bounded}\n\`\`\``
}

function readEnvironmentName(value: string): StackEnvironmentName {
  if (value === "dev" || value === "staging" || value === "prod") return value
  throw new RpcError(-32602, "environment must be dev, staging, or prod")
}

async function resolveLightsThreadTargetId(stackDataRoot: string, threadId: string): Promise<string> {
  const trimmed = threadId.trim()
  if (!trimmed.startsWith("mt_")) return trimmed
  try {
    const manifest = await stackdMetaThread(trimmed)
    const head = manifest?.head_thread_id?.trim()
    if (head) return head
  } catch {
    // fall through to disk read
  }
  const manifest = await readMetaThreadManifest(stackDataRoot, trimmed)
  const head = manifest?.head_thread_id?.trim()
  return head || trimmed
}

function readCurrentGardenerThreadId(stackDataRoot: string): string | undefined {
  const path = join(stackDataRoot, ".stack", "garden", "gardener-thread.json")
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { thread_id?: unknown }
    const threadId = typeof parsed.thread_id === "string" ? parsed.thread_id.trim() : ""
    return threadId || undefined
  } catch {
    return undefined
  }
}

function requiredString(args: JsonObject, key: string): string {
  const value = optionalString(args, key)
  if (!value) throw new RpcError(-32602, `${key} is required`)
  return value
}

function assemblyTransitionFromArgs(args: JsonObject): StackdAssemblyTransitionRequest {
  const kind = requiredString(args, "kind")
  const actorId = requiredString(args, "actor_id")
  const station = optionalString(args, "station")
  const verdict = optionalString(args, "verdict")
  const evidencePaths = optionalStringArray(args, "evidence_paths") ?? []
  const note = optionalString(args, "note")
  const requireStation = (): string => {
    if (!station) throw new RpcError(-32602, `station is required for ${kind}`)
    return station
  }
  if (kind === "assembly.station_started") {
    return { kind, station: requireStation(), actor_id: actorId }
  }
  if (kind === "assembly.station_completed") {
    return { kind, station: requireStation(), actor_id: actorId, evidence_paths: evidencePaths, note }
  }
  if (kind === "assembly.gate_failed") {
    if (verdict !== "concern" && verdict !== "fail") {
      throw new RpcError(-32602, "assembly.gate_failed requires verdict concern or fail")
    }
    const nextOwner = optionalString(args, "next_owner")
    const nextSafeAction = optionalString(args, "next_safe_action")
    if (!nextOwner || !nextSafeAction) {
      throw new RpcError(-32602, "assembly.gate_failed requires next_owner and next_safe_action")
    }
    return {
      kind,
      station: requireStation(),
      actor_id: actorId,
      verdict,
      next_owner: nextOwner,
      next_safe_action: nextSafeAction,
      evidence_paths: evidencePaths,
      note,
    }
  }
  if (kind === "assembly.gate_passed") {
    if (verdict !== "pass" && verdict !== "n_a") {
      throw new RpcError(-32602, "assembly.gate_passed requires verdict pass or n_a")
    }
    return { kind, station: requireStation(), actor_id: actorId, verdict, evidence_paths: evidencePaths, note }
  }
  if (kind === "assembly.shipped") {
    return { kind, actor_id: actorId, evidence_paths: evidencePaths, note }
  }
  if (kind === "assembly.follow_up_due") {
    const dueAt = optionalString(args, "due_at")
    if (!dueAt) throw new RpcError(-32602, "assembly.follow_up_due requires due_at")
    return { kind, actor_id: actorId, due_at: dueAt, note }
  }
  throw new RpcError(-32602, `unknown assembly transition kind: ${kind}`)
}

function requiredHostedOptimizerAlgorithm(
  args: JsonObject,
  key: string,
): "gepa" | "go-ex" | "mapo" | "online-reflexion" {
  const value = requiredString(args, key)
  if (value === "gepa" || value === "go-ex" || value === "mapo" || value === "online-reflexion") return value
  throw new RpcError(-32602, `${key} must be gepa, go-ex, mapo, or online-reflexion`)
}

function optionalString(args: JsonObject, key: string): string | undefined {
  const value = args[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalInteger(args: JsonObject, key: string): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RpcError(-32602, `${key} must be an integer`)
  }
  return value
}

function optionalBoolean(args: JsonObject, key: string): boolean | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "boolean") {
    throw new RpcError(-32602, `${key} must be a boolean`)
  }
  return value
}

function optionalStringArray(args: JsonObject, key: string): string[] | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new RpcError(-32602, `${key} must be an array of strings`)
  }
  return value
}

function optionalJsonObject(args: JsonObject, key: string): Record<string, unknown> | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RpcError(-32602, `${key} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredJsonObject(args: JsonObject, key: string): Record<string, unknown> {
  const value = optionalJsonObject(args, key)
  if (!value) throw new RpcError(-32602, `${key} is required`)
  return value
}

function optionalActorRole(args: JsonObject): "primary" | "monitor" | "system" | "unknown" | undefined {
  const value = optionalString(args, "actor_role")
  if (!value) return undefined
  if (value === "primary" || value === "monitor" || value === "system" || value === "unknown") return value
  throw new RpcError(-32602, "actor_role must be primary, monitor, system, or unknown")
}

function optionalOutputKind(args: JsonObject, key: string): RemoteOutputSelection["kind"] | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (value === "work-product" || value === "artifact") return value
  throw new RpcError(-32602, `${key} must be work-product or artifact`)
}

function optionalFileVisibility(args: JsonObject, key: string): "model" | "verifier" | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (value === "model" || value === "verifier") return value
  throw new RpcError(-32602, `${key} must be model or verifier`)
}

function requiredRoundTripArtifactKind(args: JsonObject, key: string) {
  const value = requiredString(args, key)
  if (isRoundTripArtifactKind(value)) return value
  throw new RpcError(-32602, `${key} must be ${ROUND_TRIP_ARTIFACT_KINDS.join(", ")}`)
}

function optionalRoundTripSourceKind(args: JsonObject, key: string): RoundTripSourceKind | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (value === "hosted_optimizer" || value === "saved_download" || value === "local_file") return value
  throw new RpcError(-32602, `${key} must be hosted_optimizer, saved_download, or local_file`)
}

function optionalRoundTripApplyMode(args: JsonObject, key: string): RoundTripApplyMode | undefined {
  const value = optionalString(args, key)
  if (!value) return undefined
  if (value === "toml-string-field" || value === "replace-file") return value
  throw new RpcError(-32602, `${key} must be toml-string-field or replace-file`)
}

function effortSourceReceiptFromRoundTrip(
  receipt: Awaited<ReturnType<typeof readRoundTripPullReceipt>>,
): StackEffortFindingSourceReceipt {
  return {
    receipt_path: receipt.receipt_path,
    artifact_kind: receipt.artifact_kind,
    source_kind: receipt.source_kind,
    environment: receipt.environment,
    run_id: receipt.run_id ?? null,
    project_id: receipt.project_id ?? null,
    artifact_name: receipt.artifact_name ?? null,
    output_id: receipt.output_id ?? null,
    label: receipt.label ?? null,
    workspace_path: receipt.workspace_path,
    digest: receipt.digest,
    pulled_at: receipt.pulled_at,
  }
}

function selectRemoteOutput(
  run: RemoteSmrRunSummary,
  detail: RemoteRunDetail,
  outputKind: RemoteOutputSelection["kind"] | undefined,
  outputId: string | undefined,
  index: number,
): RemoteOutputSelection | undefined {
  if (outputId) {
    if (outputKind !== "artifact") {
      const workProduct = detail.workProducts.find((item) => item.workProductId === outputId)
      if (workProduct) return { kind: "work-product", run, item: workProduct }
    }
    if (outputKind !== "work-product") {
      const artifact = detail.artifacts.find((item) => item.artifactId === outputId)
      if (artifact) return { kind: "artifact", run, item: artifact }
    }
    return undefined
  }

  if (outputKind === "work-product") {
    const workProduct = detail.workProducts[index]
    return workProduct ? { kind: "work-product", run, item: workProduct } : undefined
  }
  if (outputKind === "artifact") {
    const artifact = detail.artifacts[index]
    return artifact ? { kind: "artifact", run, item: artifact } : undefined
  }

  const workProduct = detail.workProducts[index]
  if (workProduct) return { kind: "work-product", run, item: workProduct }
  const artifact = detail.artifacts[index - detail.workProducts.length]
  return artifact ? { kind: "artifact", run, item: artifact } : undefined
}

function selectedOutputId(selection: RemoteOutputSelection): string {
  return selection.kind === "work-product" ? selection.item.workProductId : selection.item.artifactId
}

function selectedOutputLabel(selection: RemoteOutputSelection): string {
  return selection.kind === "work-product"
    ? selection.item.title ?? selection.item.workProductId
    : selection.item.title ?? selection.item.artifactId
}

function selectSavedDownload(
  downloads: RemoteDownloadRecord[],
  selector: {
    index: number
    runId?: string
    outputId?: string
    path?: string
  },
): RemoteDownloadRecord | undefined {
  let matches = downloads
  if (selector.path) matches = matches.filter((download) => download.path === selector.path)
  if (selector.runId) matches = matches.filter((download) => download.runId === selector.runId)
  if (selector.outputId) matches = matches.filter((download) => download.outputId === selector.outputId)
  if (selector.index < 0) throw new RpcError(-32602, "index must be 0 or greater")
  return matches[selector.index]
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readRpcId(value: JsonValue | undefined): RpcId {
  if (typeof value === "string" || typeof value === "number" || value === null) return value
  return null
}

function asRecord(value: JsonValue | undefined): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value
}

function toJsonObject(value: Record<string, JsonValue>): JsonObject {
  return value
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const items = value.map((item) => toJsonValue(item))
    return items.every((item) => item !== undefined) ? (items as JsonValue[]) : undefined
  }
  if (typeof value === "object") {
    const record: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      const jsonItem = toJsonValue(item)
      if (jsonItem !== undefined) record[key] = jsonItem
    }
    return record
  }
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function defaultAppRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
}

function normalizeMcpHttpPath(value: string): string {
  const trimmed = value.trim() || "/mcp"
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") || "/mcp" : `/${trimmed.replace(/\/+$/, "")}`
}

async function handleHttpRequest(
  appRoot: string,
  server: StackMcpServer,
  req: Request,
  path: string,
  readChain: () => Promise<void>,
  setChain: (next: Promise<void>) => void,
): Promise<Response> {
  if (req.method === "GET") {
    return Response.json({
      ok: true,
      server: SERVER_NAME,
      version: stackVersion(appRoot),
      transport: "streamable-http",
      protocolVersion: PROTOCOL_VERSION,
      path,
    })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return Response.json(errorResponse(null, new RpcError(-32700, "Invalid JSON")), { status: 400 })
  }

  const messages = Array.isArray(payload) ? payload : [payload]
  const responses: JsonObject[] = []
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return Response.json(errorResponse(null, new RpcError(-32600, "Invalid Request")), { status: 400 })
    }
    const prior = readChain()
    let responseMessage: JsonObject | undefined
    const next = prior.then(async () => {
      responseMessage = await server.handleJsonRpc(message as JsonObject)
    })
    setChain(next)
    await next
    if (responseMessage) responses.push(responseMessage)
  }

  if (responses.length === 1) return Response.json(responses[0])
  return Response.json(responses)
}

if (import.meta.main) {
  if (wantsVersionFlag(process.argv)) {
    printStackVersion("stack-mcp")
    process.exit(0)
  }
  const httpArgs = readHttpServeArgs(process.argv.slice(2))
  const appRoot = process.env.STACK_APP_ROOT ?? defaultAppRoot()
  const mcp = new StackMcpServer(appRoot)
  if (httpArgs) {
    const served = await mcp.serveHttp(httpArgs)
    console.log(`stack_mcp_http_ready ${served.url}`)
    await new Promise<void>(() => undefined)
  } else {
    await mcp.serveStdio()
  }
}

function readHttpServeArgs(argv: string[]): { bind?: string; port: number; path?: string } | undefined {
  if (!argv.includes("--http")) return undefined
  let bind = process.env.STACK_MCP_HTTP_BIND ?? "127.0.0.1"
  let port = Number.parseInt(process.env.STACK_MCP_HTTP_PORT ?? "8793", 10)
  let path = process.env.STACK_MCP_HTTP_PATH ?? "/mcp"
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--bind" && argv[index + 1]) bind = argv[++index]
    else if (arg === "--port" && argv[index + 1]) port = Number.parseInt(argv[++index], 10)
    else if (arg === "--path" && argv[index + 1]) path = argv[++index]
  }
  if (!Number.isFinite(port) || port <= 0) throw new Error("invalid MCP HTTP port")
  return { bind, port, path }
}
