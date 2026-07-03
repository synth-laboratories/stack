import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export type StackPapercutContext = {
  source: "tui" | "gardener" | "mcp"
  environmentName?: string
  profile?: string
  focusMode?: string
  threadId?: string
  metaThreadId?: string
  taskId?: string
  runId?: string
  projectId?: string
  optimizerRunId?: string
  factoryId?: string
  artifactId?: string
  summary?: string
}

export type StackPapercutCaptureResult = {
  path: string
  timestamp: string
  line: string
  contextLabel: string
}

export async function captureStackPapercut(
  stackRoot: string,
  context: StackPapercutContext,
  now = new Date(),
): Promise<StackPapercutCaptureResult> {
  const timestamp = now.toISOString()
  const path = guidancePapercutPath(stackRoot, now)
  const fields = [
    ["ts", timestamp],
    ["kind", "papercut"],
    ["file", "stack/src/tui/app.ts"],
    ["severity", "LOW"],
    ["source", context.source],
    ["environment", context.environmentName],
    ["profile", context.profile],
    ["focus", context.focusMode],
    ["task_id", context.taskId],
    ["run_id", context.runId],
    ["project_id", context.projectId],
    ["optimizer_run_id", context.optimizerRunId],
    ["factory_id", context.factoryId],
    ["artifact_id", context.artifactId],
    ["thread_id", context.threadId],
    ["meta_thread_id", context.metaThreadId],
  ] as const
  const line = `STACK_MEMORY|${fields
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${field(value)}`)
    .join("|")}`
  const summary = context.summary?.trim() || "Operator papercut captured from Stack TUI."
  const block = `${line}\n${summary}\n`

  await mkdir(dirname(path), { recursive: true })
  try {
    const existing = await readFile(path, "utf8")
    const separator = existing.trim().length > 0 ? "\n\n" : ""
    await appendFile(path, `${separator}${block.trim()}\n`, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await writeFile(path, `${block.trim()}\n`, "utf8")
  }

  return {
    path,
    timestamp,
    line,
    contextLabel: papercutContextLabel(context),
  }
}

export function guidancePapercutPath(stackRoot: string, now = new Date()): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  return join(stackRoot, ".stack", "guidance", "records", "papercuts", `${month}.md`)
}

function papercutContextLabel(context: StackPapercutContext): string {
  const ids = [
    context.runId ? `run ${shortId(context.runId)}` : undefined,
    context.optimizerRunId ? `optimizer ${shortId(context.optimizerRunId)}` : undefined,
    context.taskId ? `task ${shortId(context.taskId)}` : undefined,
    context.factoryId ? `factory ${shortId(context.factoryId)}` : undefined,
  ].filter(Boolean)
  return ids.length > 0 ? ids.join(" · ") : "session context"
}

function field(value: string | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, "_")
    .replace(/[|]/g, "/")
    .slice(0, 160)
}

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value
}
