import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import type { StackConfig } from "./config.js"

type JsonRecord = Record<string, unknown>

export type JesterkyWorkflowRegisterOptions = {
  specPath: string
  workflowId?: string
}

export type JesterkyWorkflowLaunchOptions = {
  workflowId?: string
  specPath?: string
  args?: JsonRecord
  argsFile?: string
  runId?: string
  actor?: "fake" | "codex"
  model?: string
  codexHome?: string
  cd?: string
  follow?: boolean
  width?: number
  /** Background execution is the default so Stack can render event progress while it runs. */
  background?: boolean
  ownerActorRole?: JesterkyWorkflowOwnerRole
  ownerThreadId?: string
}

export type JesterkyWorkflowOwnerRole = "gardener" | "worker" | "external"

export type JesterkyWorkflowRunStatus = "running" | "done" | "error" | "stale"

export type JesterkyWorkflowRunRecord = {
  schema_version: "stack.jesterky.run.v1"
  owner_actor_role: JesterkyWorkflowOwnerRole
  owner_thread_id?: string
  workflow_id: string
  workflow_name: string
  run_id: string
  run_dir: string
  spec_path: string
  manifest_path: string
  events_path: string
  record_path: string
  status: JesterkyWorkflowRunStatus
  actor?: "fake" | "codex"
  /** Explicit model passed to the workflow actor; absent means the workflow did not declare one. */
  model?: string
  process_id?: number
  heartbeat_at?: string
  last_event_at?: string
  stdout_path?: string
  stderr_path?: string
  started_at: string
  updated_at: string
  completed_at?: string
  exit_status?: number
  manifest_status?: string
  stop_reason?: string
  event_count: number
  latest_event_kind?: string
  current_node?: string
  error?: string
}

export type JesterkyManifestSelection = {
  workflowId?: string
  runId?: string
  manifestPath?: string
}

export type JesterkyCompareOptions = {
  leftManifestPath: string
  rightManifestPath: string
}

export function registerJesterkyWorkflow(
  config: StackConfig,
  options: JesterkyWorkflowRegisterOptions,
): JsonRecord {
  const specPath = resolveStackPath(config, options.specPath)
  const spec = readJson(specPath)
  const specHash = sha256Text(stableJson(spec))
  const workflowName = readWorkflowName(spec) ?? basename(specPath, ".json")
  const workflowId = options.workflowId ?? safeId(`${workflowName}-${specHash.slice(0, 12)}`)
  const workflowDir = jesterkyWorkflowDir(config, workflowId)
  const storedSpecPath = join(workflowDir, "spec.json")
  const metadataPath = join(workflowDir, "metadata.json")

  runJesterky(config, ["validate", specPath])
  mkdirSync(workflowDir, { recursive: true })
  writeJson(storedSpecPath, spec)
  const metadata = {
    schema_version: "stack.jesterky.workflow.v1",
    workflow_id: workflowId,
    workflow_name: workflowName,
    source_spec_path: specPath,
    stored_spec_path: storedSpecPath,
    stack_spec_sha256: specHash,
    registered_at: new Date().toISOString(),
  }
  writeJson(metadataPath, metadata)
  return {
    ok: true,
    workflow_id: workflowId,
    workflow_name: workflowName,
    spec_hash: specHash,
    spec_path: storedSpecPath,
    metadata_path: metadataPath,
  }
}

export function launchJesterkyWorkflow(
  config: StackConfig,
  options: JesterkyWorkflowLaunchOptions,
): JsonRecord {
  const workflow = resolveWorkflow(config, options.workflowId, options.specPath)
  const runId = options.runId ?? `jk_${Date.now()}`
  const runDir = join(workflow.workflowDir, "runs", safeId(runId))
  mkdirSync(runDir, { recursive: true })
  const manifestPath = join(runDir, "manifest.json")
  const eventsPath = join(runDir, "events.ndjson")
  const recordPath = join(runDir, "run.json")
  const stdoutPath = join(runDir, "stdout.log")
  const stderrPath = join(runDir, "stderr.log")
  const ownerActorRole = options.ownerActorRole ?? "external"
  if (ownerActorRole !== "external" && !options.ownerThreadId?.trim()) {
    throw new Error(`owner_thread_id is required when owner_actor_role=${ownerActorRole}`)
  }
  const startedAt = new Date().toISOString()
  const initialRecord: JesterkyWorkflowRunRecord = {
    schema_version: "stack.jesterky.run.v1",
    owner_actor_role: ownerActorRole,
    ...(options.ownerThreadId?.trim() ? { owner_thread_id: options.ownerThreadId.trim() } : {}),
    workflow_id: workflow.workflowId,
    workflow_name: workflow.workflowName,
    run_id: runId,
    run_dir: runDir,
    spec_path: workflow.specPath,
    manifest_path: manifestPath,
    events_path: eventsPath,
    record_path: recordPath,
    status: "running",
    ...(options.actor ? { actor: options.actor } : {}),
    ...(options.model ? { model: options.model } : {}),
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    started_at: startedAt,
    updated_at: startedAt,
    event_count: 0,
  }
  writeJson(recordPath, initialRecord)
  const args = ["run", workflow.specPath, "--out", manifestPath, "--events-out", eventsPath, "--run-id", runId]
  if (options.argsFile) {
    args.push("--args-file", resolveStackPath(config, options.argsFile))
  } else if (options.args) {
    args.push("--args", JSON.stringify(options.args))
  }
  if (options.actor) args.push("--actor", options.actor)
  if (options.model) args.push("--model", options.model)
  if (options.codexHome) args.push("--codex-home", resolveStackPath(config, options.codexHome))
  if (options.cd) args.push("--cd", resolveStackPath(config, options.cd))
  if (options.follow === true) args.push("--follow")
  if (options.follow === false) args.push("--no-follow")
  if (options.width !== undefined) args.push("--width", String(options.width))

  if (options.background !== false) {
    const stdoutFd = openSync(stdoutPath, "a")
    const stderrFd = openSync(stderrPath, "a")
    try {
      const child = spawn(jesterkyCommand(), args, {
        cwd: config.workingDir,
        detached: true,
        stdio: ["ignore", stdoutFd, stderrFd],
      })
      const running = {
        ...initialRecord,
        process_id: child.pid,
        heartbeat_at: new Date().toISOString(),
      }
      writeJson(recordPath, running)
      child.once("exit", (code) => {
        finalizeJesterkyRun(recordPath, code ?? 1)
      })
      child.unref()
      return workflowLaunchResponse(running, { ok: true, status: "running" })
    } catch (error) {
      const completedAt = new Date().toISOString()
      const failed: JesterkyWorkflowRunRecord = {
        ...initialRecord,
        status: "error",
        updated_at: completedAt,
        completed_at: completedAt,
        error: error instanceof Error ? error.message : String(error),
      }
      writeJson(recordPath, failed)
      return workflowLaunchResponse(failed, { ok: false, status: "error" })
    } finally {
      closeSync(stdoutFd)
      closeSync(stderrFd)
    }
  }

  const command = runJesterky(config, args, { allowFailure: true })
  let manifest: JsonRecord | null = null
  let manifestReadError: string | undefined
  if (existsSync(manifestPath)) {
    try {
      manifest = readJson(manifestPath)
    } catch (error) {
      manifestReadError = error instanceof Error ? error.message : String(error)
    }
  }
  const summary = manifest && typeof manifest === "object" ? summarizeManifest(manifest as JsonRecord) : null
  const progress = readJesterkyEventProgress(eventsPath)
  const manifestStatus = manifest ? readString(manifest.status) : undefined
  const stopReason = manifest ? readString(manifest.stop_reason) : undefined
  const invariants = manifest?.invariants as JsonRecord | undefined
  const invariantFailure = invariants?.all_ok === false
  const failedStopReason = stopReason === "node_failed" || stopReason === "goal_unmet" || stopReason === "budget_exhausted"
  const completed = command.status === 0
    && Boolean(manifest)
    && manifestStatus !== "failed"
    && !invariantFailure
    && !failedStopReason
  const completedAt = new Date().toISOString()
  const record: JesterkyWorkflowRunRecord = {
    ...initialRecord,
    status: completed ? "done" : "error",
    updated_at: completedAt,
    completed_at: completedAt,
    exit_status: command.status,
    ...(manifestStatus ? { manifest_status: manifestStatus } : {}),
    ...(stopReason ? { stop_reason: stopReason } : {}),
    ...progress,
    ...(!completed
      ? {
          error:
            command.stderr ||
            command.stdout ||
            (manifestReadError
              ? `jesterky manifest could not be read: ${manifestReadError}`
              : invariantFailure
              ? "jesterky manifest invariants failed"
              : failedStopReason
                ? `jesterky stopped with ${stopReason}`
                : "jesterky run did not produce a completed manifest"),
        }
      : {}),
  }
  writeJson(recordPath, record)
  return {
    ...workflowLaunchResponse(record, { ok: completed, status: command.status }),
    summary,
    stdout: command.stdout,
    stderr: command.stderr,
  }
}

export function listJesterkyWorkflowRuns(
  config: StackConfig,
  options: { limit?: number } = {},
): JesterkyWorkflowRunRecord[] {
  const records: JesterkyWorkflowRunRecord[] = []
  for (const collection of ["workflows", "ad-hoc"]) {
    const collectionDir = join(jesterkyRoot(config), collection)
    if (!existsSync(collectionDir)) continue
    for (const workflowEntry of readdirSync(collectionDir, { withFileTypes: true })) {
      if (!workflowEntry.isDirectory()) continue
      const runsDir = join(collectionDir, workflowEntry.name, "runs")
      if (!existsSync(runsDir)) continue
      for (const runEntry of readdirSync(runsDir, { withFileTypes: true })) {
        if (!runEntry.isDirectory()) continue
        const recordPath = join(runsDir, runEntry.name, "run.json")
        if (!existsSync(recordPath)) continue
        try {
          const parsed = readJson(recordPath)
          const record = parseJesterkyRunRecord(parsed)
          if (!record) continue
          records.push(reconcileJesterkyRun(record))
        } catch {
          // One partially written or manually edited record must not hide the remaining workflow rail.
        }
      }
    }
  }
  records.sort((left, right) => {
    if (left.status === "running" && right.status !== "running") return -1
    if (right.status === "running" && left.status !== "running") return 1
    return Date.parse(right.updated_at) - Date.parse(left.updated_at)
  })
  return records.slice(0, Math.max(1, options.limit ?? 100))
}

function workflowLaunchResponse(
  record: JesterkyWorkflowRunRecord,
  outcome: { ok: boolean; status: number | "running" | "error" },
): JsonRecord {
  return {
    ok: outcome.ok,
    status: outcome.status,
    workflow_id: record.workflow_id,
    run_id: record.run_id,
    run_dir: record.run_dir,
    manifest_path: record.manifest_path,
    events_path: record.events_path,
    run_record_path: record.record_path,
    owner_actor_role: record.owner_actor_role,
    owner_thread_id: record.owner_thread_id ?? null,
    actor: record.actor ?? null,
    model: record.model ?? null,
    process_id: record.process_id ?? null,
  }
}

function reconcileJesterkyRun(record: JesterkyWorkflowRunRecord): JesterkyWorkflowRunRecord {
  if (record.status !== "running") return record
  if (record.process_id && isProcessAlive(record.process_id)) {
    const now = new Date().toISOString()
    const next = { ...record, ...readJesterkyEventProgress(record.events_path), heartbeat_at: now }
    if (JSON.stringify(next) !== JSON.stringify(record)) writeJson(record.record_path, next)
    return next
  }
  if (record.process_id) {
    return finalizeJesterkyRun(record.record_path) ?? staleJesterkyRun(record)
  }
  const progress = readJesterkyEventProgress(record.events_path)
  const lastActivity = progress.last_event_at ?? record.heartbeat_at ?? record.updated_at
  if (Date.now() - Date.parse(lastActivity) < jesterkyStaleMs()) {
    return { ...record, ...progress }
  }
  return staleJesterkyRun({ ...record, ...progress })
}

function finalizeJesterkyRun(recordPath: string, exitStatus?: number): JesterkyWorkflowRunRecord | undefined {
  if (!existsSync(recordPath)) return undefined
  let record: JesterkyWorkflowRunRecord | undefined
  try {
    record = parseJesterkyRunRecord(readJson(recordPath))
  } catch {
    return undefined
  }
  if (!record || record.status !== "running") return record
  const completedAt = new Date().toISOString()
  let manifest: JsonRecord | undefined
  let manifestReadError: string | undefined
  if (existsSync(record.manifest_path)) {
    try {
      manifest = readJson(record.manifest_path)
    } catch (error) {
      manifestReadError = error instanceof Error ? error.message : String(error)
    }
  }
  const manifestStatus = manifest ? readString(manifest.status) : undefined
  const stopReason = manifest ? readString(manifest.stop_reason) : undefined
  const invariantFailure = (manifest?.invariants as JsonRecord | undefined)?.all_ok === false
  const failedStopReason = stopReason === "node_failed" || stopReason === "goal_unmet" || stopReason === "budget_exhausted"
  const completed = (exitStatus === undefined || exitStatus === 0)
    && Boolean(manifest)
    && manifestStatus !== "failed"
    && !invariantFailure
    && !failedStopReason
  const progress = readJesterkyEventProgress(record.events_path)
  const next: JesterkyWorkflowRunRecord = {
    ...record,
    status: completed ? "done" : "error",
    updated_at: completedAt,
    completed_at: completedAt,
    ...(exitStatus !== undefined ? { exit_status: exitStatus } : {}),
    ...(manifestStatus ? { manifest_status: manifestStatus } : {}),
    ...(stopReason ? { stop_reason: stopReason } : {}),
    ...progress,
    ...(!completed
      ? {
          error: readJesterkyLogTail(record.stderr_path)
            || (manifestReadError ? `jesterky manifest could not be read: ${manifestReadError}` : undefined)
            || (invariantFailure ? "jesterky manifest invariants failed" : undefined)
            || (failedStopReason ? `jesterky stopped with ${stopReason}` : undefined)
            || "jesterky process exited without a completed manifest",
        }
      : {}),
  }
  writeJson(recordPath, next)
  return next
}

function staleJesterkyRun(record: JesterkyWorkflowRunRecord): JesterkyWorkflowRunRecord {
  const now = new Date().toISOString()
  const next: JesterkyWorkflowRunRecord = {
    ...record,
    status: "stale",
    updated_at: now,
    error: "workflow record has no live process or recent heartbeat",
  }
  writeJson(record.record_path, next)
  return next
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function jesterkyStaleMs(): number {
  const parsed = Number.parseInt(process.env.STACK_JESTERKY_STALE_MS ?? "60000", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000
}

function readJesterkyLogTail(path: string | undefined): string | undefined {
  if (!path || !existsSync(path)) return undefined
  try {
    const text = readFileSync(path, "utf8").trim()
    return text ? text.slice(-2_000) : undefined
  } catch {
    return undefined
  }
}

export function inspectJesterkyRun(config: StackConfig, selection: JesterkyManifestSelection): JsonRecord {
  const manifestPath = resolveManifestPath(config, selection)
  const manifest = readJson(manifestPath)
  const args = ["visualize", manifestPath]
  if (selection.workflowId) {
    const workflow = resolveWorkflow(config, selection.workflowId, undefined)
    args.push("--spec", workflow.specPath)
  }
  const width = readPositiveInteger(selection as JsonRecord, "width")
  if (width !== undefined) args.push("--width", String(width))
  const visual = runJesterky(config, args, { allowFailure: true })
  return {
    ok: true,
    manifest_path: manifestPath,
    summary: summarizeManifest(manifest),
    visualize_status: visual.status,
    visualization: visual.stdout,
    visualize_error: visual.stderr || null,
  }
}

export function replayJesterkyRun(config: StackConfig, selection: JesterkyManifestSelection): JsonRecord {
  const manifestPath = resolveManifestPath(config, selection)
  const args = ["replay", manifestPath]
  if (selection.workflowId) {
    const workflow = resolveWorkflow(config, selection.workflowId, undefined)
    args.push("--spec", workflow.specPath)
  }
  const command = runJesterky(config, args, { allowFailure: true })
  return {
    ok: command.status === 0,
    status: command.status,
    manifest_path: manifestPath,
    stdout: command.stdout,
    stderr: command.stderr,
  }
}

export function compareJesterkyManifests(config: StackConfig, options: JesterkyCompareOptions): JsonRecord {
  const leftPath = resolveStackPath(config, options.leftManifestPath)
  const rightPath = resolveStackPath(config, options.rightManifestPath)
  const left = readJson(leftPath)
  const right = readJson(rightPath)
  const leftTrace = traceRows(left)
  const rightTrace = traceRows(right)
  const leftByAddr = new Map(leftTrace.map((row) => [String(row.addr), row]))
  const rightByAddr = new Map(rightTrace.map((row) => [String(row.addr), row]))
  const addresses = [...new Set([...leftByAddr.keys(), ...rightByAddr.keys()])].sort()
  const nodeDiffs = addresses
    .map((addr): JsonRecord | undefined => {
      const leftRow = leftByAddr.get(addr)
      const rightRow = rightByAddr.get(addr)
      if (!leftRow) return { addr, kind: "added", right: rightRow }
      if (!rightRow) return { addr, kind: "removed", left: leftRow }
      const changed = stableJson(leftRow.outputs) !== stableJson(rightRow.outputs)
        || stableJson(leftRow.score) !== stableJson(rightRow.score)
        || stableJson(leftRow.signal) !== stableJson(rightRow.signal)
      return changed ? { addr, kind: "changed", left: leftRow, right: rightRow } : undefined
    })
    .filter((diff): diff is JsonRecord => Boolean(diff))
  return {
    ok: true,
    left_manifest_path: leftPath,
    right_manifest_path: rightPath,
    left_summary: summarizeManifest(left),
    right_summary: summarizeManifest(right),
    node_diff_count: nodeDiffs.length,
    node_diffs: nodeDiffs.slice(0, 200),
  }
}

function resolveWorkflow(config: StackConfig, workflowId?: string, specPath?: string): {
  workflowId: string
  workflowName: string
  workflowDir: string
  specPath: string
} {
  if (workflowId) {
    const workflowDir = jesterkyWorkflowDir(config, workflowId)
    const specPath = join(workflowDir, "spec.json")
    if (!existsSync(specPath)) throw new Error(`jesterky workflow not registered: ${workflowId}`)
    const metadataPath = join(workflowDir, "metadata.json")
    const metadata = existsSync(metadataPath) ? readJson(metadataPath) : undefined
    const workflowName = readString(metadata?.workflow_name) ?? readWorkflowName(readJson(specPath)) ?? workflowId
    return { workflowId, workflowName, workflowDir, specPath }
  }
  if (!specPath) throw new Error("workflow_id or spec_path is required")
  const resolvedSpecPath = resolveStackPath(config, specPath)
  const spec = readJson(resolvedSpecPath)
  const specHash = sha256Text(stableJson(spec))
  const workflowName = readWorkflowName(spec) ?? basename(resolvedSpecPath, ".json")
  return {
    workflowId: safeId(`${workflowName}-${specHash.slice(0, 12)}`),
    workflowName,
    workflowDir: join(jesterkyRoot(config), "ad-hoc", safeId(`${workflowName}-${specHash.slice(0, 12)}`)),
    specPath: resolvedSpecPath,
  }
}

function parseJesterkyRunRecord(value: JsonRecord): JesterkyWorkflowRunRecord | undefined {
  const ownerActorRole = readString(value.owner_actor_role)
  const status = readString(value.status)
  if (ownerActorRole !== "gardener" && ownerActorRole !== "worker" && ownerActorRole !== "external") return undefined
  if (status !== "running" && status !== "done" && status !== "error" && status !== "stale") return undefined
  const required = {
    workflow_id: readString(value.workflow_id),
    workflow_name: readString(value.workflow_name),
    run_id: readString(value.run_id),
    run_dir: readString(value.run_dir),
    spec_path: readString(value.spec_path),
    manifest_path: readString(value.manifest_path),
    events_path: readString(value.events_path),
    record_path: readString(value.record_path),
    started_at: readString(value.started_at),
    updated_at: readString(value.updated_at),
  }
  if (Object.values(required).some((field) => !field)) return undefined
  return {
    schema_version: "stack.jesterky.run.v1",
    owner_actor_role: ownerActorRole,
    ...(readString(value.owner_thread_id) ? { owner_thread_id: readString(value.owner_thread_id) } : {}),
    workflow_id: required.workflow_id!,
    workflow_name: required.workflow_name!,
    run_id: required.run_id!,
    run_dir: required.run_dir!,
    spec_path: required.spec_path!,
    manifest_path: required.manifest_path!,
    events_path: required.events_path!,
    record_path: required.record_path!,
    status,
    ...(readString(value.actor) === "fake" || readString(value.actor) === "codex"
      ? { actor: readString(value.actor) as "fake" | "codex" }
      : {}),
    ...(readString(value.model) ? { model: readString(value.model) } : {}),
    ...(typeof value.process_id === "number" ? { process_id: value.process_id } : {}),
    ...(readString(value.heartbeat_at) ? { heartbeat_at: readString(value.heartbeat_at) } : {}),
    ...(readString(value.last_event_at) ? { last_event_at: readString(value.last_event_at) } : {}),
    ...(readString(value.stdout_path) ? { stdout_path: readString(value.stdout_path) } : {}),
    ...(readString(value.stderr_path) ? { stderr_path: readString(value.stderr_path) } : {}),
    started_at: required.started_at!,
    updated_at: required.updated_at!,
    ...(readString(value.completed_at) ? { completed_at: readString(value.completed_at) } : {}),
    ...(typeof value.exit_status === "number" ? { exit_status: value.exit_status } : {}),
    ...(readString(value.manifest_status) ? { manifest_status: readString(value.manifest_status) } : {}),
    ...(readString(value.stop_reason) ? { stop_reason: readString(value.stop_reason) } : {}),
    event_count: typeof value.event_count === "number" ? value.event_count : 0,
    ...(readString(value.latest_event_kind) ? { latest_event_kind: readString(value.latest_event_kind) } : {}),
    ...(readString(value.current_node) ? { current_node: readString(value.current_node) } : {}),
    ...(readString(value.error) ? { error: readString(value.error) } : {}),
  }
}

function readJesterkyEventProgress(eventsPath: string): Pick<
  JesterkyWorkflowRunRecord,
  "event_count" | "latest_event_kind" | "current_node" | "last_event_at"
> {
  if (!existsSync(eventsPath)) return { event_count: 0 }
  const lines = readFileSync(eventsPath, "utf8").split(/\r?\n/).filter((line) => line.trim())
  let latestEventKind: string | undefined
  let currentNode: string | undefined
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]!) as JsonRecord
      const kind = event.kind as JsonRecord | undefined
      latestEventKind = readString(kind?.kind) ?? readString(event.kind)
      const addr = event.addr as JsonRecord | undefined
      const nodePath = addr?.node_path
      if (Array.isArray(nodePath) && nodePath.length > 0) currentNode = String(nodePath[nodePath.length - 1])
      break
    } catch {
      // Ignore an incomplete trailing line while the synchronous launcher is still flushing events.
    }
  }
  return {
    event_count: lines.length,
    ...(lines.length > 0 ? { last_event_at: statSync(eventsPath).mtime.toISOString() } : {}),
    ...(latestEventKind ? { latest_event_kind: latestEventKind } : {}),
    ...(currentNode ? { current_node: currentNode } : {}),
  }
}

function resolveManifestPath(config: StackConfig, selection: JesterkyManifestSelection): string {
  if (selection.manifestPath) return resolveStackPath(config, selection.manifestPath)
  if (!selection.workflowId || !selection.runId) {
    throw new Error("manifest_path or workflow_id plus run_id is required")
  }
  return join(jesterkyWorkflowDir(config, selection.workflowId), "runs", safeId(selection.runId), "manifest.json")
}

function runJesterky(
  config: StackConfig,
  args: string[],
  options: { allowFailure?: boolean } = {},
): { status: number; stdout: string; stderr: string } {
  const command = jesterkyCommand()
  const result = spawnSync(command, args, {
    cwd: config.workingDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const status = result.status ?? 1
  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? result.error?.message ?? ""
  if (status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with ${status}: ${stderr || stdout}`)
  }
  return { status, stdout, stderr }
}

function jesterkyCommand(): string {
  return process.env.STACK_JESTERKY_COMMAND ?? "jesterky"
}

function summarizeManifest(manifest: JsonRecord): JsonRecord {
  const trace = traceRows(manifest)
  const triples = trace.filter((row) => row.is_leaf || row.score !== null)
  return {
    run_id: readString(manifest.run_id),
    workflow_name: readString(manifest.workflow_name),
    spec_hash: readString(manifest.spec_hash),
    status: readString(manifest.status),
    stop_reason: readString(manifest.stop_reason),
    event_count: Array.isArray(manifest.events) ? manifest.events.length : 0,
    recorded_count: Array.isArray(manifest.recorded) ? manifest.recorded.length : 0,
    trace_row_count: trace.length,
    optimizer_triple_count: triples.length,
    scored_node_count: triples.filter((row) => row.score !== null).length,
    goals: manifest.goals ?? null,
    budgets: manifest.budgets ?? null,
    invariants: manifest.invariants ?? null,
  }
}

function traceRows(manifest: JsonRecord): JsonRecord[] {
  const rows: JsonRecord[] = []
  collectTraceRows(manifest.trace, 0, rows)
  return rows.sort((left, right) => String(left.addr ?? "").localeCompare(String(right.addr ?? "")))
}

function collectTraceRows(node: unknown, depth: number, rows: JsonRecord[]): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return
  const record = node as JsonRecord
  const children = Array.isArray(record.children) ? record.children : []
  rows.push({
    addr: readString(record.addr),
    label: readString(record.label),
    depth,
    is_leaf: children.length === 0,
    inputs: record.inputs ?? null,
    outputs: record.outputs ?? null,
    score: record.score ?? null,
    signal: record.signal ?? null,
    artifact_count: Array.isArray(record.artifacts) ? record.artifacts.length : 0,
  })
  for (const child of children) collectTraceRows(child, depth + 1, rows)
}

function readWorkflowName(spec: JsonRecord): string | undefined {
  return readString(spec.name) ?? readString((spec.workflow as JsonRecord | undefined)?.name)
}

function readPositiveInteger(value: JsonRecord, key: string): number | undefined {
  const raw = value[key]
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined
  return Math.floor(raw)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function resolveStackPath(config: StackConfig, path: string): string {
  return isAbsolute(path) ? path : resolve(config.workingDir, path)
}

function jesterkyRoot(config: StackConfig): string {
  return join(config.stackDataRoot, ".stack", "jesterky")
}

function jesterkyWorkflowDir(config: StackConfig, workflowId: string): string {
  return join(jesterkyRoot(config), "workflows", safeId(workflowId))
}

function safeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "jesterky"
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const object = value as JsonRecord
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}
