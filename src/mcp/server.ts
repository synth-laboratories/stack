#!/usr/bin/env bun

import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  environmentAuthStatus,
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
import { isUiPanelId, panelOpenAllowed, panelViewAllowed, UI_PANEL_IDS, UI_PANELS, type UiPanelOpener } from "../ui/vocabulary.js"
import {
  stackdExport,
  stackdBindMetaThreadRemoteSmrRun,
  stackdMetaThread,
  stackdMetaThreads,
  stackdRuntimeAppendEvent,
  stackdRuntimeEvents,
  stackdRuntimeFactory,
  stackdRuntimeTick,
  stackdTelemetryStatus,
  stackdThread,
  stackdThreads,
  stackdTrace,
  stackdUpdateMetaThreadLifecycle,
  stackdUpdateMetaThreadTitle,
  type StackdFactorySnapshot,
  type StackdMetaThreadLifecycleStatus,
  type StackdRuntimeEventAppendRequest,
  type StackdRuntimeFactoryResponse,
} from "../client/stackd.js"
import { projectLogDocumentToVictoriaLogs, queryStackLogs } from "../observability/victorialogs.js"
import { readCrashReportsView } from "../crash-reports.js"
import { readOptimizerSnapshot } from "../local/optimizers.js"
import { loadGardenerConfig } from "../gardener-config.js"
import {
  createRemoteLaunch,
  decideRemoteRunApproval,
  downloadRemoteOutput,
  executeRemoteFactoryAction,
  executeRemoteRunAction,
  getRemoteLaunch,
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
  type RemoteOutputSelection,
} from "../remote/actions.js"
import {
  cancelHostedOptimizerRun,
  downloadHostedOptimizerArtifact,
  previewHostedOptimizerArtifact,
} from "../remote/optimizers.js"
import { readHostedOptimizerSnapshot } from "../remote/optimizers.js"
import {
  readRemoteResearchSnapshot,
  readRemoteProjectsPanelSnapshot,
  readRemoteRunDetail,
  readRunHostedArtifactStatus,
  type HostedArtifactStatus,
  type RemoteFactorySummary,
  type RemoteRunDetail,
  type RemoteSmrRunSummary,
} from "../remote/research.js"
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

export class StackMcpServer {
  private readonly tools: Map<string, ToolDefinition>
  private httpMode = false

  constructor(private readonly appRoot: string) {
    this.tools = new Map(buildTools(this).map((tool) => [tool.name, tool]))
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
    const threadId = requiredString(args, "thread_id")
    const panel = requiredString(args, "panel")
    if (!isUiPanelId(panel)) {
      throw new RpcError(-32602, `unknown panel '${panel}' — registered panels: ${UI_PANEL_IDS.join(", ")}`)
    }
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
    return { ok: true, event_id: event.event_id, panel, view: view ?? null, thread_id: threadId, path }
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
    if (!taskId && !objective) {
      throw new RpcError(-32602, "task_id or objective is required when dry_run=false")
    }
    const metadata = optionalJsonObject(args, "metadata") ?? {}
    const result = await createRemoteLaunch(config, {
      ...(optionalString(args, "project_id") ? { project_id: optionalString(args, "project_id") } : {}),
      ...(taskId ? { task_id: taskId } : {}),
      ...(objective ? { objective } : {}),
      ...(optionalString(args, "runbook") ? { runbook: optionalString(args, "runbook") } : {}),
      metadata: {
        ...metadata,
        source: "stack_mcp",
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

  async recordRemoteGardenerPass(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
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
      thread_event: threadEvent,
    }) ?? null
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
    const run = remoteRunRef(args)
    const questionId = requiredString(args, "question_id")
    const responseText = requiredString(args, "response_text")
    const result = await respondRemoteRunQuestion(config, run, questionId, responseText)
    return actionResultWithData(result)
  }

  async decideRunApproval(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const run = remoteRunRef(args)
    const approvalId = requiredString(args, "approval_id")
    const decision = requiredApprovalDecision(args)
    const result = await decideRemoteRunApproval(config, run, approvalId, decision, optionalString(args, "comment"))
    return actionResultWithData(result)
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
    const openRes = await openUrlInSystemBrowser(url)
    return {
      ok: openRes.ok,
      run_id: runId,
      opened_url: url,
      prefer,
      status: status.status,
      visibility: status.visibility ?? null,
      message: openRes.message,
      receipt: openRes.ok ? `RECEIPT PASS hosted_url=${status.urlStatus ?? 200} [Open artifact ↗]` : null,
    }
  }

  async listFactories(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
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

  async messageLiveRun(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const body = requiredString(args, "body")
    const projectId = optionalString(args, "project_id")
    const result = await sendRemoteRunMessage(config, { runId, projectId, state: "unknown" }, body)
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
    return actionResultWithData(result, { runtime_event: runtimeEvent })
  }

  async messageFactoryProject(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
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
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_factory.message_sent",
      source: "lever.stack_mcp",
      subject: { kind: "remote_factory", id: factoryId },
      correlation: {
        factory_id: factoryId,
        project_id: projectId ?? factory.canonicalProjectId ?? factory.latestProjectId ?? undefined,
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
    return actionResultWithData(result, { runtime_event: runtimeEvent })
  }

  async wakeFactory(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const factoryId = requiredString(args, "factory_id")
    const projectId = optionalString(args, "project_id")
    const confirm = optionalBoolean(args, "confirm") ?? false
    if (!confirm) {
      return {
        ok: false,
        status: 0,
        message: "confirm=true is required to wake a Factory",
      }
    }
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
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: "lever.remote_factory.wake_requested",
      source: "lever.stack_mcp",
      subject: { kind: "remote_factory", id: factoryId },
      correlation: {
        factory_id: factoryId,
        project_id: projectId ?? factory.canonicalProjectId ?? factory.latestProjectId ?? undefined,
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
    return actionResultWithData(result, { runtime_event: runtimeEvent })
  }

  async controlFactory(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const factoryId = requiredString(args, "factory_id")
    const action = requiredString(args, "action")
    if (action !== "pause-factory" && action !== "resume-factory") {
      throw new RpcError(-32602, "action must be pause-factory or resume-factory")
    }
    const projectId = optionalString(args, "project_id")
    const confirm = optionalBoolean(args, "confirm") ?? false
    if (!confirm) {
      return {
        ok: false,
        status: 0,
        message: "confirm=true is required to pause or resume a Factory",
      }
    }
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
    const runtimeEvent = await recordRuntimeLeverEvent({
      event_type: `lever.remote_factory.${action === "pause-factory" ? "paused" : "resumed"}` as `lever.${string}`,
      source: "lever.stack_mcp",
      subject: { kind: "remote_factory", id: factoryId },
      correlation: {
        factory_id: factoryId,
        project_id: projectId ?? factory.canonicalProjectId ?? factory.latestProjectId ?? undefined,
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
    return actionResultWithData(result, { runtime_event: runtimeEvent })
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

  async downloadHostedOptimizerArtifact(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const artifactName = requiredString(args, "artifact_name")
    const result = await downloadHostedOptimizerArtifact(
      config,
      { runId, algorithm: "unknown", status: "unknown" },
      artifactName,
    )
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      artifact_name: artifactName,
      ...(result.data ? { download_result: toJsonValue(result.data) ?? null } : {}),
    }
  }

  async downloadRunOutput(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
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
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      output_kind: selection.kind,
      output_id: selectedOutputId(selection),
      output_label: selectedOutputLabel(selection),
      ...(result.data ? { download_result: toJsonValue(result.data) ?? null } : {}),
    }
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
  const deploymentCount = remote?.deployment_count ?? runtimeDeployments.length
  if (!remote || (projects.length === 0 && deploymentCount === 0)) return undefined
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
  if (!remote || runs.length === 0) return undefined
  const runtimeEnvironment = runtimeRemoteEnvironment(remote, config)
  return toJsonValue({
    environment: runtimeEnvironment.environmentName,
    api_base_url: runtimeEnvironment.apiBaseUrl,
    source: "runtime",
    status: remote.auth_status === "ready" ? "ready" : "missing-auth",
    message: `runtime ${runs.length} SMR runs`,
    count: runs.length,
    control_state: snapshot.control_state,
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
        "Open a side panel for human review. The agent panel always stays primary; use this ONLY at review moments (audited goal_met/goal_failed, blocked, a steer you issued, or a risky pending action) and at most once per distinct signature. panel: monitor (sidecar events/thread/tape), gardener (portfolio), ops (local/remote/hosted), threads. Every open emits an audited ui.panel_opened event; the operator's Esc closes it and wins until your next open.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
          thread_id: stringProperty("Worker Stack thread/session id the panel belongs to."),
          panel: { type: "string", enum: [...UI_PANEL_IDS], description: "Registered panel id." },
          view: stringProperty("Optional view within the panel (monitor: events|thread|tape; gardener: portfolio|chat; ops: local|remote|hosted; threads: list)."),
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
      name: "stack_list_remote_projects",
      description: "List remote Synth projects with associated live/recent SMR runs and linked Factory/cloud badges. Uses stackd runtime snapshot first, with direct API fallback.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        tick: { type: "boolean", description: "If true, request one stackd /runtime/tick before reading projects." },
      }),
      handler: (args) => server.listRemoteProjects(args),
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
        objective: stringProperty("Optional cloud launch objective. Required when no task_id is available and dry_run=false."),
        runbook: stringProperty("Optional runbook or launch mode hint."),
        metadata: jsonObjectProperty("Optional structured metadata to carry into the launch request."),
        dry_run: { type: "boolean", description: "Defaults to true. When true, returns the launch packet without creating cloud work." },
        confirm: { type: "boolean", description: "Required as true when dry_run=false." },
      }),
      handler: (args) => server.launchCloudPromotion(args),
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
      description: "Read one Managed Research cloud launch through the launch owner route.",
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
      description: "Terminate one Managed Research cloud launch through the launch owner route.",
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
      name: "stack_live_status",
      description: "Read Stack live operations status: recent SMR runs, factories, and hosted optimizer runs.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.liveStatus(args),
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
      name: "stack_download_hosted_optimizer_artifact",
      description: "Download a hosted optimizer artifact through the optimizer owner route into Stack download state.",
      inputSchema: objectSchema(
        {
          environment: environmentProperty(),
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
    actions.push("call stack_launch_read_smoke to create a live SMR run, then poll stack_readme_smoke_eval_status")
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
  return toJsonValue({
    ok: result.ok,
    status: result.status,
    message: result.message,
    data: result.data ?? null,
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

function readEnvironmentName(value: string): StackEnvironmentName {
  if (value === "dev" || value === "staging" || value === "prod") return value
  throw new RpcError(-32602, "environment must be dev, staging, or prod")
}

function requiredString(args: JsonObject, key: string): string {
  const value = optionalString(args, key)
  if (!value) throw new RpcError(-32602, `${key} is required`)
  return value
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
