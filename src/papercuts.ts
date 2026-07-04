import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

// One-keystroke papercut capture: timestamped, run-context-stamped friction
// entries appended to the guidance papercuts ledger (same monthly files the
// gardener friction mirror writes, so one ledger holds all papercuts).
export type PapercutContext = {
  sessionId?: string
  environment?: string
  taskId?: string
  runId?: string
  note?: string
}

export type PapercutReceipt = {
  path: string
  line: string
}

export function papercutLedgerPath(stackRoot: string, now = new Date()): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  return join(stackRoot, ".stack", "guidance", "records", "papercuts", `${month}.md`)
}

export function appendPapercutEntry(stackRoot: string, context: PapercutContext): PapercutReceipt {
  const now = new Date()
  const line = [
    "STACK_MEMORY",
    `ts=${now.toISOString()}`,
    "kind=papercut",
    "severity=LOW",
    "source=operator",
    `session=${sanitizeField(context.sessionId) ?? "none"}`,
    `task=${sanitizeField(context.taskId) ?? "none"}`,
    `run=${sanitizeField(context.runId) ?? "none"}`,
    `env=${sanitizeField(context.environment) ?? "none"}`,
  ].join("|")
  const note = context.note?.trim() || "operator papercut capture"
  const block = `${line}\n${note}\n`
  const path = papercutLedgerPath(stackRoot, now)
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    appendFileSync(path, `\n${block}`)
  } else {
    writeFileSync(path, block)
  }
  return { path, line }
}

function sanitizeField(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/[|\r\n]/g, "_")
}
