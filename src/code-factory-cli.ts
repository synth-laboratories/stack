import { randomUUID } from "node:crypto"
import type { StackConfig } from "./config.js"
import {
  CodeFactoryAuthError,
  CodeFactoryClient,
  CodeFactoryHttpError,
  createCodeFactoryClientFromEnv,
} from "./code-factory.js"
import type {
  CodeFactoryCommandReceipt,
  CodeFactoryCreateSessionRequest,
  CodeFactoryOrderedEventEnvelope,
  CodeFactorySessionDetail,
  CodeFactorySessionSummary,
} from "./code-factory.js"

type ParsedFlags = {
  args: string[]
  flags: Map<string, string | true>
}

class CodeFactoryCliUsageError extends Error {}

export async function runCodeFactoryCli(_config: StackConfig, argv: string[]): Promise<number> {
  const action = argv[1]
  const parsed = parseFlags(argv.slice(2))
  if (!action || action === "help" || action === "--help" || action === "-h" || parsed.flags.has("help")) {
    printCodeFactoryUsage(action)
    return action ? 0 : 2
  }

  const client = createCodeFactoryClientFromEnv()
  try {
    switch (action) {
      case "list":
      case "ls":
        return await runList(client, parsed)
      case "create":
        return await runCreate(client, parsed)
      case "open":
      case "show":
        return await runShow(client, parsed)
      case "prompt":
        return await runPrompt(client, parsed)
      case "events":
        return await runEvents(client, parsed)
      case "watch":
        return await runWatch(client, parsed)
      case "pause":
      case "resume":
      case "cancel":
        return await runControl(client, action, parsed)
      default:
        throw new CodeFactoryCliUsageError(`unknown Code Factory command: ${action}`)
    }
  } catch (error) {
    if (error instanceof CodeFactoryCliUsageError) {
      console.error(error.message)
      return 2
    }
    if (error instanceof CodeFactoryHttpError) {
      const detail = error.body.trim()
      console.error(`${error.message}${detail ? `: ${detail}` : ""}`)
      return 1
    }
    if (error instanceof CodeFactoryAuthError) {
      console.error(error.message)
      return 1
    }
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

export function printCodeFactoryUsage(action?: string): void {
  console.log("Usage:")
  if (action && !["help", "--help", "-h"].includes(action)) {
    console.log(`  stack code-factory ${action} ...`)
    console.log("")
  }
  console.log("  stack code-factory list [--json]")
  console.log("  stack code-factory create --request-json <json> [--idempotency-key <key>] [--json]")
  console.log("  stack code-factory open|show <session-id> [--after-cursor <n>] [--json]")
  console.log("  stack code-factory prompt <session-id> <prompt> [--idempotency-key <key>] [--json]")
  console.log("  stack code-factory events <session-id> [--after-cursor <n>] [--json]")
  console.log("  stack code-factory watch <session-id> [--after-cursor <n>] [--json]")
  console.log("  stack code-factory pause|resume|cancel <session-id> [--idempotency-key <key>] [--json]")
  console.log("")
  console.log("Reads use STACK_CODE_FACTORY_API_URL (default http://127.0.0.1:8787).")
  console.log("Mutations require STACK_CODE_FACTORY_API_TOKEN or the env named by STACK_CODE_FACTORY_AUTH_ENV.")
  console.log("watch reconnects from the latest event cursor; Ctrl-C stops the client without touching the session.")
}

async function runList(client: CodeFactoryClient, parsed: ParsedFlags): Promise<number> {
  ensureNoPositionalArgs(parsed, "list")
  const sessions = await client.listSessions()
  if (hasFlag(parsed, "json")) {
    console.log(JSON.stringify(sessions, null, 2))
  } else if (sessions.length === 0) {
    console.log("no Code Factory sessions")
  } else {
    for (const session of sessions) printSessionSummary(session)
  }
  return 0
}

async function runCreate(client: CodeFactoryClient, parsed: ParsedFlags): Promise<number> {
  ensureNoPositionalArgs(parsed, "create")
  const rawRequest = requiredFlag(parsed, "request-json", "create requires --request-json <json>")
  const request = parseObjectJson(rawRequest, "--request-json") as CodeFactoryCreateSessionRequest
  const receipt = await client.createSession(request, idempotencyKey(parsed, "create"))
  printReceipt(receipt, hasFlag(parsed, "json"))
  return 0
}

async function runShow(client: CodeFactoryClient, parsed: ParsedFlags): Promise<number> {
  const sessionId = requireSessionId(parsed, "open/show")
  ensureNoTrailingArgs(parsed, "open/show")
  const afterCursor = readCursor(parsed)
  const detail = await client.getSession(sessionId)
  const events = afterCursor === undefined ? detail.events : await client.listEvents(sessionId, afterCursor)
  if (hasFlag(parsed, "json")) {
    console.log(JSON.stringify(afterCursor === undefined ? detail : { ...detail, events }, null, 2))
  } else {
    printSessionDetail(detail, events)
  }
  return 0
}

async function runPrompt(client: CodeFactoryClient, parsed: ParsedFlags): Promise<number> {
  const sessionId = requireSessionId(parsed, "prompt")
  const prompt = flagString(parsed, "prompt") ?? parsed.args.slice(1).join(" ")
  if (!prompt?.trim()) throw new CodeFactoryCliUsageError("usage: stack code-factory prompt <session-id> <prompt> [--json]")
  const receipt = await client.prompt(sessionId, prompt, idempotencyKey(parsed, "prompt"))
  printReceipt(receipt, hasFlag(parsed, "json"))
  return 0
}

async function runEvents(client: CodeFactoryClient, parsed: ParsedFlags): Promise<number> {
  const sessionId = requireSessionId(parsed, "events")
  ensureNoTrailingArgs(parsed, "events")
  const events = await client.listEvents(sessionId, readCursor(parsed))
  if (hasFlag(parsed, "json")) console.log(JSON.stringify(events, null, 2))
  else for (const event of events) printEvent(event)
  return 0
}

async function runWatch(client: CodeFactoryClient, parsed: ParsedFlags): Promise<number> {
  const sessionId = requireSessionId(parsed, "watch")
  ensureNoTrailingArgs(parsed, "watch")
  const controller = new AbortController()
  const onSignal = (): void => controller.abort()
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)
  let eventCount = 0
  try {
    for await (const event of client.watchEvents({
      sessionId,
      afterCursor: readCursor(parsed),
      reconnectDelayMs: readNumber(parsed, "reconnect-delay-ms") ?? 1000,
      signal: controller.signal,
    })) {
      eventCount += 1
      if (hasFlag(parsed, "json")) console.log(JSON.stringify(event))
      else printEvent(event)
      if (hasFlag(parsed, "once")) controller.abort()
    }
  } finally {
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
  }
  if (eventCount === 0 && !controller.signal.aborted) console.log("event stream ended without events")
  return 0
}

async function runControl(
  client: CodeFactoryClient,
  action: "pause" | "resume" | "cancel",
  parsed: ParsedFlags,
): Promise<number> {
  const sessionId = requireSessionId(parsed, action)
  ensureNoTrailingArgs(parsed, action)
  const key = idempotencyKey(parsed, action)
  const receipt = action === "pause"
    ? await client.pause(sessionId, key)
    : action === "resume"
      ? await client.resume(sessionId, key)
      : await client.cancel(sessionId, key)
  printReceipt(receipt, hasFlag(parsed, "json"))
  return 0
}

function printSessionSummary(summary: CodeFactorySessionSummary): void {
  const repositories = summary.repositories
  const locations = repositories.map((repository) => {
    const branch = repository.branch ?? "-"
    return `${repository.repository_id} ${branch} ${repository.base_sha.slice(0, 12)}..${repository.head_sha.slice(0, 12)}`
  })
  console.log(
    `${summary.session.session_id} ${summary.session.state} model=${summary.model.requested.model}/${summary.model.requested.reasoning_effort} thread=${summary.session.codex_thread_id} cursor=${summary.session.last_event_cursor}`,
  )
  console.log(`  ${locations.join("; ") || "repositories=none"}`)
}

function printSessionDetail(detail: CodeFactorySessionDetail, events: CodeFactoryOrderedEventEnvelope[]): void {
  const session = detail.session
  const model = detail.model_receipt
  console.log(`session ${session.session_id}`)
  console.log(`state ${session.state}`)
  console.log(`objective ${session.objective}`)
  console.log(`created ${session.created_at} updated ${session.updated_at} last_cursor ${session.last_event_cursor}`)
  console.log(`thread ${detail.codex_thread.codex_thread_id} provider=${detail.codex_thread.provider} runtime=${detail.codex_thread.runtime}`)
  console.log(
    `model requested=${model.requested.model}/${model.requested.reasoning_effort} observed=${model.observed.model}/${model.observed.reasoning_effort} matches=${model.matches_request}`,
  )
  console.log(`workspace ${detail.workspace_revision.workspace_revision_id} digest=${detail.workspace_revision.workspace_revision_digest}`)
  for (const repository of detail.workspace_revision.repositories) {
    const diff = detail.diffs.find((item) => item.repository_id === repository.repository_id)
    const verification = repository.verification
    console.log(
      `repo ${repository.repository_id} branch=${repository.branch ?? "-"} base=${repository.base_sha} head=${repository.head_sha}`,
    )
    console.log(
      `  verify clean=${verification.clean} committed=${verification.committed} pushed=${verification.pushed} fetchable=${verification.fetchable} base_is_ancestor=${verification.base_is_ancestor}`,
    )
    if (diff) {
      console.log(
        `  diff ${diff.base_sha}..${diff.head_sha} files=${diff.changed_files.length} +${diff.insertions}/-${diff.deletions} digest=${diff.patch_digest} patch=${diff.patch_uri ?? "-"}`,
      )
    }
  }
  if (detail.commits.length > 0) {
    for (const commit of detail.commits) {
      console.log(`commit ${commit.commit_sha} ${commit.commit_message} repo=${commit.repository_id} pushed=${commit.pushed_at}`)
    }
  }
  console.log(`events ${events.length}`)
  for (const event of events) printEvent(event)
  if (detail.cleanup_receipt) {
    console.log(
      `cleanup ${detail.cleanup_receipt.cleanup_receipt_id} status=${detail.cleanup_receipt.status} foreign_resources_touched=${detail.cleanup_receipt.foreign_resources_touched} remaining=${detail.cleanup_receipt.owned_resources_remaining.length}`,
    )
  }
}

function printEvent(event: CodeFactoryOrderedEventEnvelope): void {
  const payload = Object.keys(event.payload).length > 0 ? ` payload=${JSON.stringify(event.payload)}` : ""
  console.log(`#${event.cursor} ${event.occurred_at} ${event.event_type} ${event.event_id}${payload}`)
}

function printReceipt(receipt: CodeFactoryCommandReceipt, json: boolean): void {
  if (json) console.log(JSON.stringify(receipt, null, 2))
  else {
    console.log(`command ${receipt.command} accepted`)
    console.log(`receipt ${receipt.command_receipt_id} request=${receipt.request_id} event=${receipt.event_id}`)
    console.log(`session ${receipt.session_id} replayed=${receipt.replayed} idempotency_key=${receipt.idempotency_key}`)
  }
}

function parseFlags(argv: string[]): ParsedFlags {
  const args: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) {
      args.push(token)
      continue
    }
    const raw = token.slice(2)
    const separator = raw.indexOf("=")
    if (separator >= 0) {
      flags.set(raw.slice(0, separator), raw.slice(separator + 1))
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      flags.set(raw, next)
      index += 1
    } else {
      flags.set(raw, true)
    }
  }
  return { args, flags }
}

function requireSessionId(parsed: ParsedFlags, command: string): string {
  const sessionId = parsed.args[0]
  if (!sessionId || parsed.args.length < 1) {
    throw new CodeFactoryCliUsageError(`usage: stack code-factory ${command} <session-id> [options]`)
  }
  return sessionId
}

function ensureNoPositionalArgs(parsed: ParsedFlags, command: string): void {
  if (parsed.args.length > 0) throw new CodeFactoryCliUsageError(`usage: stack code-factory ${command} [options]`)
}

function ensureNoTrailingArgs(parsed: ParsedFlags, command: string): void {
  if (parsed.args.length > 1) throw new CodeFactoryCliUsageError(`usage: stack code-factory ${command} <session-id> [options]`)
}

function requiredFlag(parsed: ParsedFlags, name: string, message: string): string {
  const value = flagString(parsed, name)
  if (!value) throw new CodeFactoryCliUsageError(message)
  return value
}

function flagString(parsed: ParsedFlags, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function hasFlag(parsed: ParsedFlags, name: string): boolean {
  return parsed.flags.has(name)
}

function readCursor(parsed: ParsedFlags): number | undefined {
  const value = flagString(parsed, "after-cursor")
  if (value === undefined) return undefined
  const cursor = Number(value)
  if (!Number.isInteger(cursor) || cursor < 0) throw new CodeFactoryCliUsageError("--after-cursor must be a non-negative integer")
  return cursor
}

function readNumber(parsed: ParsedFlags, name: string): number | undefined {
  const value = flagString(parsed, name)
  if (value === undefined) return undefined
  const parsedNumber = Number(value)
  if (!Number.isFinite(parsedNumber) || parsedNumber < 0) throw new CodeFactoryCliUsageError(`--${name} must be a non-negative number`)
  return parsedNumber
}

function idempotencyKey(parsed: ParsedFlags, command: string): string {
  return flagString(parsed, "idempotency-key") ?? `stack-code-factory-${command}-${randomUUID()}`
}

function parseObjectJson(value: string, flag: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new CodeFactoryCliUsageError(`${flag} must contain valid JSON`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CodeFactoryCliUsageError(`${flag} must contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}
