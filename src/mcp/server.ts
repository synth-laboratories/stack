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
import { appendThreadMetaEvent, stackEventId } from "../thread-events.js"
import { stackdExport, stackdThread, stackdThreads, stackdTrace } from "../client/stackd.js"
import { projectLogDocumentToVictoriaLogs, queryStackLogs } from "../observability/victorialogs.js"
import { readReadmeSmokeEvalLaunch, startReadmeSmokeEval, type StackEvalLaunch } from "../local/evals.js"
import { readOptimizerSnapshot } from "../local/optimizers.js"
import {
  downloadRemoteOutput,
  executeRemoteRunAction,
  openUrlInSystemBrowser,
  previewRemoteOutput,
  previewSavedRemoteDownload,
  readRemoteDownloadHistory,
  sendRemoteFactoryMessage,
  sendRemoteRunMessage,
  uploadRemoteRunFile,
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
  private evalLaunch: StackEvalLaunch | undefined

  constructor(private readonly appRoot: string) {
    this.tools = new Map(buildTools(this).map((tool) => [tool.name, tool]))
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
        setTimeout(() => process.exit(0), 0)
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
    const readmeSmoke = correlateReadmeSmokeRun(
      this.evalLaunch ?? readReadmeSmokeEvalLaunch(config),
      research.jobs,
    )
    this.evalLaunch = readmeSmoke
    return {
      environment: config.environmentName,
      apiBaseUrl: config.environment.apiBaseUrl,
      authEnv: config.environment.authEnv,
      auth,
      hasAuth: auth.hasAuth,
      remoteResearch: research,
      hostedOptimizers: hosted,
      readmeSmoke,
    } satisfies JsonObject
  }

  async agentStatus(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const mode = optionalBridgeMode(args) ?? "all"
    const auth = environmentAuthStatus(config.environment)
    const [local, research, hosted] = await Promise.all([
      mode === "remote" ? Promise.resolve(undefined) : readOptimizerSnapshot(config),
      mode === "local" ? Promise.resolve(undefined) : readRemoteResearchSnapshot(config),
      mode === "local" ? Promise.resolve(undefined) : readHostedOptimizerSnapshot(config),
    ])
    const readmeSmoke = mode === "local" || !research
      ? readReadmeSmokeEvalLaunch(config)
      : correlateReadmeSmokeRun(this.evalLaunch ?? readReadmeSmokeEvalLaunch(config), research.jobs)
    this.evalLaunch = readmeSmoke

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
      remote: research
        ? {
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
        : undefined,
      hosted_optimizers: hosted
        ? {
            status: hosted.status,
            message: hosted.message,
            runs: hosted.runs.length,
            active_runs: hosted.runs.filter((run) => isActiveState(run.status)).length,
            selected_run_id: hosted.runs[0]?.runId,
          }
        : undefined,
      readme_smoke: {
        status: readmeSmoke.status,
        run_id: readmeSmoke.runId,
        project_id: readmeSmoke.projectId,
        message: readmeSmoke.message,
        verification_state: readmeSmoke.verificationState,
        verification_failures: readmeSmoke.verificationFailures ?? [],
      },
      next_actions: bridgeNextActions(mode, auth.hasAuth, research?.jobs.length ?? 0, hosted?.runs.length ?? 0),
    }) ?? null
  }

  async listLiveSmrs(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const snapshot = await readRemoteResearchSnapshot(config)
    return toJsonValue({
      environment: config.environmentName,
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
    const snapshot = await readRemoteResearchSnapshot(config)
    return toJsonValue({
      environment: config.environmentName,
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
    const snapshot = await readHostedOptimizerSnapshot(config)
    return toJsonValue({
      environment: config.environmentName,
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

  async launchReadmeSmoke(args: JsonObject): Promise<JsonValue> {
    return this.startReadmeSmoke(args)
  }

  async messageLiveRun(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const body = requiredString(args, "body")
    const projectId = optionalString(args, "project_id")
    const result = await sendRemoteRunMessage(config, { runId, projectId, state: "unknown" }, body)
    return actionResult(result)
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
    return actionResult(result)
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
    return actionResult(result)
  }

  async cancelHostedOptimizer(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    const runId = requiredString(args, "run_id")
    const result = await cancelHostedOptimizerRun(config, {
      runId,
      algorithm: "unknown",
      status: "unknown",
    })
    return actionResult(result)
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
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      run_id: runId,
      local_path: resolvedLocalPath,
      ...(remotePath ? { remote_path: remotePath } : {}),
      visibility: visibility ?? "model",
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

  async startReadmeSmoke(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    this.evalLaunch = startReadmeSmokeEval(config, this.evalLaunch ?? readReadmeSmokeEvalLaunch(config), (snapshot) => {
      this.evalLaunch = snapshot
    })
    return this.evalLaunch as unknown as JsonValue
  }

  async readmeSmokeStatus(args: JsonObject): Promise<JsonValue> {
    const config = await this.config(args)
    this.evalLaunch = this.evalLaunch ?? readReadmeSmokeEvalLaunch(config)
    const snapshot = await readRemoteResearchSnapshot(config)
    this.evalLaunch = correlateReadmeSmokeRun(this.evalLaunch, snapshot.jobs)
    return this.evalLaunch as unknown as JsonValue
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
      threadEventLogPath = appendThreadMetaEvent(config.appRoot, {
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
      threadEventLogPath = appendThreadMetaEvent(config.appRoot, {
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
      threadEventLogPath = appendThreadMetaEvent(config.appRoot, {
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
    const threadEventLogPath = appendThreadMetaEvent(config.appRoot, {
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

function correlateReadmeSmokeRun(
  launch: StackEvalLaunch,
  jobs: RemoteSmrRunSummary[],
): StackEvalLaunch {
  if (launch.runId || !launch.projectId) return launch
  const run = jobs.find((item) => item.projectId === launch.projectId)
  return run ? { ...launch, runId: run.runId } : launch
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
      name: "stack_list_live_smrs",
      description: "List recent live SMR runs in a concise Codex-friendly shape, including output/message/file counts when loaded.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.listLiveSmrs(args),
    },
    {
      name: "stack_query_logs",
      description: "Query VictoriaLogs through stackd's native LogSQL client for agent-legible cloud, local optimizer, and meta-harness telemetry.",
      inputSchema: objectSchema({
        environment: environmentProperty(),
        slot: stringProperty("Local synth-dev slot id. Defaults to STACK_VL_SLOT or slot1."),
        query: stringProperty("Optional LogSQL query expression. Defaults to * plus supplied field filters."),
        event_domain: enumProperty(["cloud_sdk", "local_optimizer", "meta_harness"], "Optional event_domain filter."),
        service: stringProperty("Optional service filter, e.g. gepa, stackeval, stackd, backend-api."),
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
      description: "List remote Research Factories and routable project/run hints for operator mediation.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.listFactories(args),
    },
    {
      name: "stack_list_hosted_optimizer_runs",
      description: "List hosted optimizer runs with selected detail, artifact names, events, and cancellation hints.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.listHostedOptimizerRuns(args),
    },
    {
      name: "stack_launch_read_smoke",
      description: "Launch the configured README-smoke SMR eval via synth-dev's canonical wrapper. Alias for stack_start_readme_smoke_eval.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.launchReadmeSmoke(args),
    },
    {
      name: "stack_live_status",
      description: "Read Stack live operations status: recent SMR runs, factories, hosted optimizer runs, and README-smoke launcher state.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.liveStatus(args),
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
      name: "stack_start_readme_smoke_eval",
      description: "Start the configured local README-smoke SMR eval via synth-dev's canonical eval wrapper.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.startReadmeSmoke(args),
    },
    {
      name: "stack_readme_smoke_eval_status",
      description: "Read the MCP server's current README-smoke launch status and output tail.",
      inputSchema: objectSchema({ environment: environmentProperty() }),
      handler: (args) => server.readmeSmokeStatus(args),
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

if (import.meta.main) {
  if (wantsVersionFlag(process.argv)) {
    printStackVersion("stack-mcp")
    process.exit(0)
  }
  await new StackMcpServer(process.env.STACK_APP_ROOT ?? defaultAppRoot()).serveStdio()
}
