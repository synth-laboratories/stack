import { randomUUID } from "node:crypto"

export type SubagentStatus =
  | "spawning"
  | "pending_init"
  | "running"
  | "completed"
  | "errored"
  | "closed"
  | "interrupted"
  | "shutdown"
  | "not_found"

export type SubagentLog = {
  id: string
  spawnCallId?: string
  name: string
  agentType?: string
  message?: string
  status: SubagentStatus
  resultText?: string
  errorText?: string
  startedAt?: string
  finishedAt?: string
}

export type MultiAgentCallMeta = {
  toolName: string
  arguments?: string
  startedAt: string
}

export const MULTI_AGENT_TOOL_NAMES = new Set([
  "spawn_agent",
  "wait_agent",
  "close_agent",
  "send_input",
  "resume_agent",
  "spawn_agents_on_csv",
  "report_agent_job_result",
  "list_agents",
])

export function isMultiAgentToolName(name: string | undefined): boolean {
  if (!name) return false
  return MULTI_AGENT_TOOL_NAMES.has(name)
}

export function upsertSubagentLog(subagents: SubagentLog[], incoming: SubagentLog): void {
  const index = subagents.findIndex((entry) => entry.id === incoming.id)
  if (index < 0) {
    subagents.push(incoming)
    return
  }
  const previous = subagents[index]
  subagents[index] = {
    ...previous,
    ...incoming,
    startedAt: previous?.startedAt ?? incoming.startedAt,
    finishedAt: incoming.finishedAt ?? previous?.finishedAt,
  }
}

export function rekeySubagentLog(subagents: SubagentLog[], fromId: string, toId: string): void {
  if (fromId === toId) return
  const index = subagents.findIndex((entry) => entry.id === fromId)
  if (index < 0) return
  const duplicate = subagents.findIndex((entry) => entry.id === toId)
  if (duplicate >= 0 && duplicate !== index) {
    subagents.splice(index, 1)
    return
  }
  const current = subagents[index]
  if (!current) return
  subagents[index] = { ...current, id: toId, spawnCallId: current.spawnCallId ?? fromId }
}

export function parseMultiAgentFunctionCall(
  toolName: string,
  callId: string,
  argumentsText: string | undefined,
  startedAt: string,
): SubagentLog | undefined {
  const args = parseJsonRecord(argumentsText)
  switch (toolName) {
    case "spawn_agent":
    case "spawn_agents_on_csv": {
      const agentType = readString(args?.agent_type) ?? (toolName === "spawn_agents_on_csv" ? "csv batch" : "agent")
      const message =
        readString(args?.message) ??
        readString(args?.instruction) ??
        readString(args?.task_name) ??
        undefined
      const label = readString(args?.task_name) ?? agentType
      return {
        id: callId,
        spawnCallId: callId,
        name: label,
        agentType,
        message,
        status: "spawning",
        startedAt,
      }
    }
    case "wait_agent":
    case "close_agent":
    case "send_input":
    case "resume_agent":
    case "list_agents":
      return undefined
    default:
      return undefined
  }
}

export function applyMultiAgentFunctionOutput(
  subagents: SubagentLog[],
  toolName: string,
  callId: string,
  output: string,
  finishedAt: string,
): void {
  const parsed = parseJsonRecord(output) ?? parseJsonRecord(extractJsonObject(output))
  switch (toolName) {
    case "spawn_agent":
    case "spawn_agents_on_csv":
      applySpawnAgentOutput(subagents, callId, parsed, finishedAt)
      return
    case "wait_agent":
      applyWaitAgentOutput(subagents, parsed, output, finishedAt)
      return
    case "close_agent":
      applyCloseAgentOutput(subagents, parsed, finishedAt)
      return
    case "send_input":
    case "resume_agent":
    case "list_agents":
      return
    default:
      return
  }
}

function applySpawnAgentOutput(
  subagents: SubagentLog[],
  callId: string,
  parsed: Record<string, unknown> | undefined,
  finishedAt: string,
): void {
  const agentId = readString(parsed?.agent_id) ?? readString(parsed?.task_name) ?? callId
  const nickname = readString(parsed?.nickname)
  const taskName = readString(parsed?.task_name)
  const existing =
    subagents.find((entry) => entry.id === callId) ??
    subagents.find((entry) => entry.spawnCallId === callId) ??
    subagents.find((entry) => entry.id === agentId)
  const name = nickname ?? taskName ?? existing?.name ?? existing?.agentType ?? "agent"
  const next: SubagentLog = {
    id: agentId,
    spawnCallId: callId,
    name,
    agentType: existing?.agentType,
    message: existing?.message,
    status: "running",
    startedAt: existing?.startedAt ?? finishedAt,
    finishedAt: undefined,
  }
  if (existing) {
    rekeySubagentLog(subagents, existing.id, agentId)
    upsertSubagentLog(subagents, next)
  } else {
    upsertSubagentLog(subagents, next)
  }
}

function applyWaitAgentOutput(
  subagents: SubagentLog[],
  parsed: Record<string, unknown> | undefined,
  rawOutput: string,
  finishedAt: string,
): void {
  const statusMap = asRecord(parsed?.status)
  if (statusMap) {
    for (const [agentId, statusValue] of Object.entries(statusMap)) {
      applyAgentStatusValue(subagents, agentId, statusValue, finishedAt)
    }
    return
  }
  const message = readString(parsed?.message)
  if (message) {
    for (const subagent of subagents) {
      if (subagent.status === "running" || subagent.status === "spawning") {
        upsertSubagentLog(subagents, {
          ...subagent,
          status: parsed?.timed_out === true ? "running" : "completed",
          resultText: message,
          finishedAt: parsed?.timed_out === true ? undefined : finishedAt,
        })
      }
    }
    return
  }
  if (rawOutput.trim()) {
    for (const subagent of subagents) {
      if (subagent.status === "running" || subagent.status === "spawning") {
        upsertSubagentLog(subagents, {
          ...subagent,
          status: "completed",
          resultText: truncateInline(rawOutput.replace(/\s+/g, " "), 240),
          finishedAt,
        })
      }
    }
  }
}

function applyCloseAgentOutput(
  subagents: SubagentLog[],
  parsed: Record<string, unknown> | undefined,
  finishedAt: string,
): void {
  const target = readString(parsed?.target)
  if (target) {
    const existing = subagents.find((entry) => entry.id === target)
    if (existing) {
      upsertSubagentLog(subagents, {
        ...existing,
        status: "closed",
        finishedAt,
      })
    }
    return
  }
  const previous = parsed?.previous_status
  if (previous !== undefined) {
    for (const subagent of subagents) {
      if (subagent.status !== "closed") {
        upsertSubagentLog(subagents, {
          ...subagent,
          status: "closed",
          finishedAt,
        })
      }
    }
  }
}

function applyAgentStatusValue(
  subagents: SubagentLog[],
  agentId: string,
  statusValue: unknown,
  finishedAt: string,
): void {
  const existing = subagents.find((entry) => entry.id === agentId)
  if (!existing) {
    upsertSubagentLog(subagents, {
      id: agentId,
      name: agentId,
      status: parseAgentStatusValue(statusValue),
      resultText: readCompletedText(statusValue) ?? undefined,
      errorText: readErroredText(statusValue) ?? undefined,
      finishedAt: isTerminalStatus(parseAgentStatusValue(statusValue)) ? finishedAt : undefined,
      startedAt: finishedAt,
    })
    return
  }
  const status = parseAgentStatusValue(statusValue)
  upsertSubagentLog(subagents, {
    ...existing,
    status,
    resultText: readCompletedText(statusValue) ?? existing.resultText,
    errorText: readErroredText(statusValue) ?? existing.errorText,
    finishedAt: isTerminalStatus(status) ? finishedAt : existing.finishedAt,
  })
}

function parseAgentStatusValue(value: unknown): SubagentStatus {
  if (typeof value === "string") {
    if (value === "pending_init") return "pending_init"
    if (value === "running") return "running"
    if (value === "interrupted") return "interrupted"
    if (value === "shutdown") return "shutdown"
    if (value === "not_found") return "not_found"
    return "running"
  }
  const record = asRecord(value)
  if (!record) return "running"
  if ("completed" in record) return "completed"
  if ("errored" in record) return "errored"
  return "running"
}

function readCompletedText(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record || !("completed" in record)) return undefined
  const completed = record.completed
  return typeof completed === "string" ? completed : completed === null ? "(done)" : undefined
}

function readErroredText(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record || !("errored" in record)) return undefined
  return readString(record.errored)
}

function isTerminalStatus(status: SubagentStatus): boolean {
  return status === "completed" || status === "errored" || status === "closed" || status === "shutdown"
}

export function subagentDisplayName(subagent: SubagentLog): string {
  return subagent.name || subagent.agentType || "agent"
}

export function subagentStatusLabel(status: SubagentStatus): string {
  switch (status) {
    case "spawning":
    case "pending_init":
      return "…"
    case "running":
      return "run"
    case "completed":
      return "done"
    case "errored":
      return "fail"
    case "closed":
      return "closed"
    case "interrupted":
      return "stop"
    case "shutdown":
      return "off"
    case "not_found":
      return "missing"
    default:
      return status
  }
}

export function subagentDurationSeconds(subagent: SubagentLog): number | undefined {
  if (!subagent.startedAt || !subagent.finishedAt) return undefined
  const elapsed = new Date(subagent.finishedAt).getTime() - new Date(subagent.startedAt).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined
  return Math.round(elapsed / 100) / 10
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return asRecord(parsed)
  } catch {
    return undefined
  }
}

function extractJsonObject(value: string): string | undefined {
  const start = value.indexOf("{")
  const end = value.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  return value.slice(start, end + 1)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function truncateInline(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

export function createSubagentId(): string {
  return randomUUID()
}
