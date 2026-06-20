import {
  Box,
  createCliRenderer,
  Text,
  type CliRenderer,
} from "@opentui/core"
import { randomUUID } from "node:crypto"
import { basename, relative } from "node:path"
import {
  CODEX_MODEL_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
  setCodexModel,
  setCodexReasoningEffort,
  type StackConfig,
} from "../config.js"
import { runCodexTurn } from "../codex/adapter.js"
import type { WorkspaceInfo } from "../local/workspace.js"
import {
  listSessionHistory,
  readSessionLog,
  type StackCodexTurn,
  type StackCodexUsage,
  type StackLocalSession,
  type StackSessionSummary,
  writeSessionLog,
} from "../session.js"

type FocusMode = "agent" | "model" | "effort" | "context" | "tools" | "history"

export type StackAppOptions = {
  config: StackConfig
  workspace: WorkspaceInfo
  session: StackLocalSession
}

type ToolLog = {
  id: string
  name: string
  status: string
  command?: string
  output?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  startedAt?: string
  finishedAt?: string
}

type AppState = {
  focusMode: FocusMode
  selectedIndex: number
  selectedToolIndex: number
  selectedHistoryIndex: number
  status: "idle" | "running" | "error"
  spinnerFrame: number
  lastUsage?: StackCodexUsage
  transcript: string[]
  inputBuffer: string
  toolLogs: ToolLog[]
  history: StackSessionSummary[]
  lastSessionLogPath?: string
}

type CodexRenderedLine = {
  content: string | null
  usage?: StackCodexUsage
  tool?: ToolLog
}

type RenderedTurns = {
  transcript: string[]
  tools: ToolLog[]
  usage?: StackCodexUsage
}

type MountedView = {
  root: ReturnType<typeof Box>
}

type StackKeyEvent = {
  name?: string
  ctrl?: boolean
  sequence?: string
  raw?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}

const FOCUS_ORDER: FocusMode[] = ["agent", "model", "effort", "context", "tools", "history"]

export async function runStackApp(options: StackAppOptions): Promise<void> {
  const state: AppState = {
    focusMode: "agent",
    selectedIndex: 0,
    selectedToolIndex: 0,
    selectedHistoryIndex: 0,
    status: "idle",
    spinnerFrame: 0,
    transcript: ["Stack Prototype 0 ready. Type a prompt and press Enter."],
    inputBuffer: "",
    toolLogs: [],
    history: await listSessionHistory(options.config.sessionLogDir),
  }

  let view: MountedView | undefined
  let remount = () => {
    view?.root.requestRender()
  }

  const refreshHistory = async () => {
    state.history = await listSessionHistory(options.config.sessionLogDir)
    state.selectedHistoryIndex = clampIndex(state.selectedHistoryIndex, state.history.length)
  }

  let spinnerInterval: ReturnType<typeof setInterval> | undefined

  const submitFromCurrentInput = (key?: StackKeyEvent): boolean => {
    if (!view || state.focusMode !== "agent" || state.status === "running") return false
    const prompt = state.inputBuffer.trim()
    if (!prompt) return false
    key?.preventDefault?.()
    key?.stopPropagation?.()
    submitInputValue(prompt, options, state, remount, refreshHistory)
    return true
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    prependInputHandlers: [
      (sequence: string) => {
        return handleRawAgentInput(sequence, state, submitFromCurrentInput, remount)
      },
    ],
  })

  view = mountView(renderer, options, state, undefined)
  remount = () => {
    view = mountView(renderer, options, state, view)
  }

  spinnerInterval = setInterval(() => {
    if (state.status !== "running") return
    state.spinnerFrame += 1
    remount()
  }, 120)

  renderer._internalKeyInput.onInternal("keypress", (key: StackKeyEvent) => {
    if (isEnterKey(key) && submitFromCurrentInput(key)) return
  })

  renderer.keyInput.on("keypress", (key: StackKeyEvent) => {
    if (key.ctrl && key.name === "c") return
    if (key.name === "tab") {
      state.focusMode = nextFocusMode(state.focusMode)
      remount()
      return
    }

    if (key.name === "escape") {
      closeRenderer(renderer, spinnerInterval)
      return
    }

    if (isEnterKey(key) && submitFromCurrentInput(key)) {
      return
    }

    if (state.focusMode === "context") {
      handleContextKey(key, options, state)
      remount()
      return
    }

    if (state.focusMode === "tools") {
      handleToolKey(key, state)
      remount()
      return
    }

    if (state.focusMode === "history") {
      void handleHistoryKey(key, options, state, remount, refreshHistory)
      return
    }

    if (state.focusMode === "model") {
      handleModelKey(key, options.config)
      remount()
      return
    }

    if (state.focusMode === "effort") {
      handleEffortKey(key, options.config)
      remount()
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

    const nextView = createView(renderer, options, state)
    renderer.root.add(nextView.root)
    nextView.root.requestRender()
    return nextView
  }
}

function createView(renderer: CliRenderer, options: StackAppOptions, state: AppState): MountedView {
  const root = Box(
    {
      id: "stack-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
      gap: 1,
    },
    Box(
      {
        border: true,
        borderStyle: "single",
        borderColor: "#4ec9b0",
        title: "Stack Prototype 0",
        padding: 1,
      },
      Text({ content: statusLine(options, state), fg: "#9cdcfe" }),
    ),
    Box(
      {
        flexDirection: "row",
        flexGrow: 1,
        gap: 1,
      },
      Box(
        {
          border: true,
          borderStyle: "single",
          borderColor: state.focusMode === "context" ? "#4ec9b0" : "#555555",
          title: "Local Context",
          width: "28%",
          padding: 1,
        },
        Text({ content: contextText(options.workspace, state), fg: "#d4d4d4" }),
      ),
      Box(
        {
          border: true,
          borderStyle: "single",
          borderColor:
            state.focusMode === "agent" || state.focusMode === "model" || state.focusMode === "effort"
              ? "#4ec9b0"
              : "#555555",
          title: "Agent",
          flexGrow: 1,
          padding: 1,
          flexDirection: "column",
          gap: 1,
        },
        Text({ content: renderTranscript(state.transcript), fg: "#d4d4d4", flexGrow: 1 }),
        agentControlRow(options.config, state),
      ),
      Box(
        {
          border: true,
          borderStyle: "single",
          borderColor: state.focusMode === "history" ? "#4ec9b0" : "#555555",
          title: "Session",
          width: "28%",
          padding: 1,
        },
        Text({ content: sessionText(options, state), fg: "#d4d4d4" }),
      ),
    ),
    Box(
      {
        border: true,
        borderStyle: "single",
        borderColor: state.focusMode === "tools" ? "#4ec9b0" : "#555555",
        title: detailTitle(state),
        height: 8,
        padding: 1,
      },
      Text({ content: detailText(options, state), fg: "#d4d4d4" }),
    ),
    Text({
      content:
        "tab focus | agent: enter send | model/effort: j/k or enter | context/tools/history: j/k | history: enter resume, f fork | esc quit",
      fg: "#8a8a8a",
    }),
  )

  return { root }
}

function agentControlRow(config: StackConfig, state: AppState): ReturnType<typeof Box> {
  return Box(
    {
      flexDirection: "row",
      gap: 1,
    },
    Text({
      content: renderAgentInput(state),
      fg: state.inputBuffer ? "#ffffff" : "#666666",
      bg: state.focusMode === "agent" ? "#161616" : undefined,
      flexGrow: 1,
    }),
    Text({
      content: `model ${config.codexModel}`,
      fg: state.focusMode === "model" ? "#ffffff" : "#9cdcfe",
      bg: state.focusMode === "model" ? "#264f78" : "#161616",
    }),
    Text({
      content: `effort ${config.codexReasoningEffort}`,
      fg: state.focusMode === "effort" ? "#ffffff" : "#9cdcfe",
      bg: state.focusMode === "effort" ? "#264f78" : "#161616",
    }),
  )
}

function submitInputValue(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
): void {
  if (!prompt || state.status === "running") return
  state.inputBuffer = ""
  void submitPrompt(prompt, options, state, refresh, refreshHistory)
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

function isRawEnterSequence(sequence: string): boolean {
  return (
    sequence === "\r" ||
    sequence === "\n" ||
    sequence === "\r\n" ||
    sequence === "\x1bOM" ||
    sequence === "\x1b[13~"
  )
}

function handleRawAgentInput(
  sequence: string,
  state: AppState,
  submit: () => boolean,
  refresh: () => void,
): boolean {
  if (state.focusMode !== "agent") return false

  if (isRawEnterSequence(sequence)) {
    return submit()
  }

  if (sequence === "\t" || sequence === "\x1b" || state.status === "running") {
    return false
  }

  if (sequence === "\x7f" || sequence === "\b") {
    state.inputBuffer = state.inputBuffer.slice(0, -1)
    refresh()
    return true
  }

  if (!isPrintableInput(sequence)) return false

  state.inputBuffer += sequence
  refresh()
  return true
}

function isPrintableInput(sequence: string): boolean {
  for (const char of sequence) {
    const code = char.codePointAt(0)
    if (code === undefined) return false
    if (code < 32 || code === 127) return false
  }
  return sequence.length > 0
}

function renderAgentInput(state: AppState): string {
  if (state.status === "running") return `${runningSpinner(state)} Codex is running...`
  return state.inputBuffer ? `${state.inputBuffer}_` : "Ask local Codex..."
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
    `effort=${options.config.codexReasoningEffort}`,
    `codex=${options.config.codexCommand} ${options.config.codexArgs.join(" ")}`,
    `mode=local`,
    `focus=${state.focusMode}`,
    `status=${state.status}`,
  ].join("   ")
}

function contextText(workspace: WorkspaceInfo, state: AppState): string {
  return [
    `focus=${state.focusMode}`,
    `repo: ${workspace.repoName}`,
    `branch: ${workspace.branch}`,
    "",
    "selected context:",
    ...renderContextFiles(workspace, state.selectedIndex),
  ].join("\n")
}

function sessionText(options: StackAppOptions, state: AppState): string {
  const selectedFiles = options.workspace.files.filter((file) => file.selected)
  return [
    `id: ${options.session.id.slice(0, 8)}`,
    `turns: ${options.session.turns.length}`,
    `status: ${state.status}`,
    `selected: ${selectedFiles.length}`,
    `model: ${options.config.codexModel}`,
    `effort: ${options.config.codexReasoningEffort}`,
    "",
    "usage:",
    ...usageText(state.lastUsage),
    "",
    "log:",
    state.lastSessionLogPath ? relative(options.workspace.root, state.lastSessionLogPath) : "(after first turn)",
    "",
    "history:",
    ...historyText(state),
  ].join("\n")
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

function historyText(state: AppState): string[] {
  if (state.history.length === 0) return ["(none yet)"]
  return state.history.slice(0, 6).map((summary, index) => {
    const cursor = state.focusMode === "history" && index === state.selectedHistoryIndex ? ">" : " "
    const prompt = summary.lastPrompt ? oneLine(summary.lastPrompt, 28) : "(empty)"
    return `${cursor} ${summary.id.slice(0, 8)} ${summary.turnCount}t ${prompt}`
  })
}

function renderContextFiles(workspace: WorkspaceInfo, selectedIndex: number): string[] {
  if (workspace.files.length === 0) return ["(no git-tracked files found)"]
  return workspace.files.slice(0, 15).map((file, index) => {
    const cursor = index === selectedIndex ? ">" : " "
    const checked = file.selected ? "[x]" : "[ ]"
    return `${cursor} ${checked} ${file.path}`
  })
}

function renderTranscript(lines: string[]): string {
  return lines.slice(-80).join("\n")
}

function detailTitle(state: AppState): string {
  if (state.focusMode === "history") return "History"
  return "Turn Detail"
}

function detailText(options: StackAppOptions, state: AppState): string {
  if (state.focusMode === "history") return selectedHistoryText(options, state)
  if (state.toolLogs.length === 0) return "no tool calls yet. Tool command details appear here."

  const tool = state.toolLogs[clampIndex(state.selectedToolIndex, state.toolLogs.length)]
  if (!tool) return "no selected tool"
  const stdout = tool.stdout ?? tool.output
  return [
    `${state.selectedToolIndex + 1}/${state.toolLogs.length} ${tool.name} status=${tool.status} exit=${tool.exitCode ?? "-"}`,
    toolDurationText(tool),
    `command: ${tool.command ?? "(unknown)"}`,
    `stdout: ${truncateDisplay(stdout?.trim() || "(empty)", 900)}`,
    `stderr: ${truncateDisplay(tool.stderr?.trim() || "(empty)", 500)}`,
  ].join("\n")
}

function selectedHistoryText(options: StackAppOptions, state: AppState): string {
  const summary = state.history[state.selectedHistoryIndex]
  if (!summary) return "no session selected"
  return [
    `${summary.id}`,
    `${summary.turnCount} turns   updated ${summary.updatedAt}`,
    `file: ${relative(options.workspace.root, summary.path)}`,
    "",
    `last prompt: ${summary.lastPrompt ?? "(empty)"}`,
    "",
    "Enter resume into this session. f fork turns into the current session.",
  ].join("\n")
}

function toolDurationText(tool: ToolLog): string {
  if (!tool.startedAt || !tool.finishedAt) return "duration: live"
  const elapsed = new Date(tool.finishedAt).getTime() - new Date(tool.startedAt).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return "duration: -"
  return `duration: ${(elapsed / 1000).toFixed(1)}s`
}

function createCodexTranscriptSink(
  emit: (content: string) => void,
  updateUsage: (usage: StackCodexUsage) => void,
  updateTool: (tool: ToolLog) => void,
): {
  write: (chunk: string) => void
  flush: () => void
  readonly hasVisibleOutput: boolean
} {
  let buffer = ""
  let visibleOutput = false

  const emitVisible = (content: string) => {
    if (!content.trim()) return
    visibleOutput = true
    emit(`\n${content}`)
  }

  const processLine = (line: string) => {
    if (!line.trim()) return
    const rendered = renderCodexJsonLine(line)
    if (rendered === undefined) {
      emitVisible(line)
      return
    }
    if (rendered.usage) updateUsage(rendered.usage)
    if (rendered.tool) updateTool(rendered.tool)
    if (rendered.content === null) return
    emitVisible(rendered.content)
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
      return visibleOutput
    },
  }
}

function renderCodexJsonLine(line: string): CodexRenderedLine | undefined {
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return undefined
  }
  return renderCodexEvent(event)
}

function renderCodexEvent(event: unknown): CodexRenderedLine | undefined {
  const record = asRecord(event)
  if (!record) return undefined

  const payload = asRecord(record.payload)
  if ((readString(record.type) === "response_item" || readString(record.type) === "event_msg") && payload) {
    return renderCodexEvent(payload)
  }

  const eventType = readString(record.type) ?? ""
  const item = asRecord(record.item)
  if (item) {
    return renderCodexEvent(item)
  }

  if (eventType === "thread.started" || eventType === "turn.started") {
    return { content: null }
  }

  if (eventType === "turn.completed") {
    return { content: null, usage: readUsage(record) }
  }

  const payloadType = payload ? readString(payload.type) ?? "" : ""
  const type = payloadType || eventType

  if (readString(record.role) === "user" || readString(payload?.role) === "user") {
    return { content: null }
  }

  if (type === "command_execution") {
    const tool = readCommandTool(record)
    const content = tool.status === "completed" ? `[tool] ${tool.name} exit=${tool.exitCode ?? "-"}` : null
    return { content, tool }
  }

  if (type === "function_call") {
    const name = readString(record.name) ?? readString(payload?.name) ?? "tool"
    const args = readString(record.arguments) ?? readString(payload?.arguments)
    return { content: `[tool] ${name}${args ? ` ${oneLine(args, 240)}` : ""}` }
  }

  if (type === "function_call_output") {
    const output = readString(record.output) ?? readString(payload?.output) ?? ""
    return { content: `[tool result] ${truncateDisplay(output, 1200)}` }
  }

  if (type.includes("command") || type.includes("tool") || type.includes("exec")) {
    const name = readString(record.name) ?? readString(payload?.name) ?? type
    const text = extractText(record) ?? extractText(payload)
    return { content: `[tool] ${name}${text ? ` ${oneLine(text, 240)}` : ""}` }
  }

  if (type.includes("message") || type.includes("output_text") || type.includes("assistant")) {
    const text = extractText(record) ?? extractText(payload)
    return text ? { content: truncateDisplay(text, 4000) } : undefined
  }

  if (eventType.includes("error") || type.includes("error")) {
    const text = extractText(record) ?? extractText(payload) ?? JSON.stringify(record)
    return { content: `[error] ${truncateDisplay(text, 1200)}` }
  }

  return undefined
}

function readCommandTool(record: Record<string, unknown>): ToolLog {
  return {
    id: readString(record.id) ?? readString(record.call_id) ?? readString(record.command) ?? randomUUID(),
    name: "command_execution",
    status: readString(record.status) ?? "completed",
    command: readString(record.command),
    output: readString(record.aggregated_output),
    stdout: readString(record.stdout) ?? readString(record.aggregated_output),
    stderr: readString(record.stderr),
    exitCode: readNullableNumber(record.exit_code),
  }
}

function readUsage(record: Record<string, unknown>): StackCodexUsage | undefined {
  const usage = asRecord(record.usage)
  if (!usage) return undefined
  return {
    inputTokens: readNumber(usage.input_tokens),
    cachedInputTokens: readNumber(usage.cached_input_tokens),
    outputTokens: readNumber(usage.output_tokens),
    reasoningOutputTokens: readNumber(usage.reasoning_output_tokens),
  }
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") return value
  const record = asRecord(value)
  if (!record) {
    if (Array.isArray(value)) {
      const parts = value.map(extractText).filter((part): part is string => Boolean(part))
      return parts.length ? parts.join("\n") : undefined
    }
    return undefined
  }

  for (const key of ["text", "message", "content", "output", "response"]) {
    const text = extractText(record[key])
    if (text) return text
  }

  return undefined
}

function handleContextKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
): void {
  if (options.workspace.files.length === 0) return
  if (key.name === "j" || key.name === "down") {
    state.selectedIndex = Math.min(options.workspace.files.length - 1, state.selectedIndex + 1)
  } else if (key.name === "k" || key.name === "up") {
    state.selectedIndex = Math.max(0, state.selectedIndex - 1)
  } else if (key.name === "space") {
    const file = options.workspace.files[state.selectedIndex]
    if (file) file.selected = !file.selected
  }
}

function handleToolKey(key: { name?: string }, state: AppState): void {
  if (state.toolLogs.length === 0) return
  if (key.name === "j" || key.name === "down") {
    state.selectedToolIndex = Math.min(state.toolLogs.length - 1, state.selectedToolIndex + 1)
  } else if (key.name === "k" || key.name === "up") {
    state.selectedToolIndex = Math.max(0, state.selectedToolIndex - 1)
  }
}

async function handleHistoryKey(
  key: { name?: string },
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
): Promise<void> {
  if (state.history.length === 0) return
  if (key.name === "j" || key.name === "down") {
    state.selectedHistoryIndex = Math.min(state.history.length - 1, state.selectedHistoryIndex + 1)
    refresh()
    return
  }
  if (key.name === "k" || key.name === "up") {
    state.selectedHistoryIndex = Math.max(0, state.selectedHistoryIndex - 1)
    refresh()
    return
  }
  if (key.name === "f") {
    await loadSelectedSession(options, state, refresh, refreshHistory, "fork")
    return
  }
  if (key.name === "return" || key.name === "enter") {
    await loadSelectedSession(options, state, refresh, refreshHistory, "resume")
  }
}

function handleModelKey(key: { name?: string }, config: StackConfig): void {
  if (isCycleKey(key)) cycleModel(config, key.name === "k" || key.name === "left" ? -1 : 1)
}

function handleEffortKey(key: { name?: string }, config: StackConfig): void {
  if (isCycleKey(key)) cycleEffort(config, key.name === "k" || key.name === "left" ? -1 : 1)
}

function isCycleKey(key: { name?: string }): boolean {
  return ["j", "k", "left", "right", "up", "down", "space", "return", "enter"].includes(key.name ?? "")
}

function cycleModel(config: StackConfig, direction: number): void {
  const options = uniqueOptions([config.codexModel, ...CODEX_MODEL_OPTIONS])
  const current = Math.max(0, options.indexOf(config.codexModel))
  setCodexModel(config, options[(current + direction + options.length) % options.length] ?? config.codexModel)
}

function cycleEffort(config: StackConfig, direction: number): void {
  const options = uniqueOptions([config.codexReasoningEffort, ...CODEX_REASONING_EFFORT_OPTIONS])
  const current = Math.max(0, options.indexOf(config.codexReasoningEffort))
  setCodexReasoningEffort(
    config,
    options[(current + direction + options.length) % options.length] ?? config.codexReasoningEffort,
  )
}

async function loadSelectedSession(
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
  mode: "resume" | "fork",
): Promise<void> {
  const summary = state.history[state.selectedHistoryIndex]
  if (!summary) return
  try {
    const loaded = await readSessionLog(summary.path)
    const session = mode === "resume" ? loaded : forkSession(options.session, loaded)
    applySession(options, state, session, mode === "resume" ? summary.path : undefined)
    if (mode === "fork") {
      state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir)
      await refreshHistory()
    }
  } catch (error) {
    state.transcript.push(`\n[stack] failed to load session ${basename(summary.path)}: ${errorMessage(error)}`)
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
  options.session.turns = session.turns

  const rendered = renderTurns(session.turns)
  state.transcript = rendered.transcript.length > 0 ? rendered.transcript : ["(session has no visible transcript)"]
  state.toolLogs = rendered.tools
  state.selectedToolIndex = clampIndex(rendered.tools.length - 1, rendered.tools.length)
  state.lastUsage = session.turns.at(-1)?.usage ?? rendered.usage
  state.lastSessionLogPath = path
  state.status = "idle"
}

function renderTurns(turns: StackCodexTurn[]): RenderedTurns {
  const transcript: string[] = []
  const tools: ToolLog[] = []
  let usage: StackCodexUsage | undefined
  for (const turn of turns) {
    for (const line of turn.stdout.split("\n")) {
      if (!line.trim()) continue
      const rendered = renderCodexJsonLine(line)
      if (!rendered) continue
      if (rendered.usage) usage = rendered.usage
      if (rendered.tool) upsertToolLog(tools, rendered.tool)
      if (rendered.content) transcript.push(`\n${rendered.content}`)
    }
  }
  return { transcript, tools, usage }
}

async function submitPrompt(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
  refreshHistory: () => Promise<void>,
): Promise<void> {
  state.status = "running"
  state.spinnerFrame = 0
  state.lastUsage = undefined
  options.session.codexCommand = `${options.config.codexCommand} ${options.config.codexArgs.join(" ")}`
  refresh()

  const selectedFiles = options.workspace.files.filter((file) => file.selected)
  const outputSink = createCodexTranscriptSink(
    (content) => {
      state.transcript.push(content)
      refresh()
    },
    (usage) => {
      state.lastUsage = usage
      refresh()
    },
    (tool) => {
      upsertToolLog(state.toolLogs, tool)
      state.selectedToolIndex = clampIndex(state.toolLogs.length - 1, state.toolLogs.length)
      refresh()
    },
  )

  try {
    const turn = await runCodexTurn({
      config: options.config,
      userPrompt: prompt,
      selectedFiles,
      priorTurns: options.session.turns,
      onOutput: outputSink.write,
    })
    outputSink.flush()
    if (!outputSink.hasVisibleOutput) {
      state.transcript.push("\n(no visible response)")
    }
    turn.usage = state.lastUsage
    options.session.turns.push(turn)
    state.status = turn.exitCode === 0 ? "idle" : "error"
    state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir)
    await refreshHistory()
  } catch (error) {
    outputSink.flush()
    state.status = "error"
    state.transcript.push(`\n[stack] ${errorMessage(error)}`)
    state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir)
    await refreshHistory()
  } finally {
    refresh()
  }
}

function upsertToolLog(tools: ToolLog[], incoming: ToolLog): void {
  const now = new Date().toISOString()
  const index = tools.findIndex((tool) => tool.id === incoming.id)
  if (index < 0) {
    tools.push({
      ...incoming,
      startedAt: incoming.status === "completed" ? now : incoming.startedAt ?? now,
      finishedAt: incoming.status === "completed" ? incoming.finishedAt ?? now : incoming.finishedAt,
    })
    return
  }
  const previous = tools[index]
  tools[index] = {
    ...previous,
    ...incoming,
    startedAt: previous?.startedAt ?? incoming.startedAt ?? now,
    finishedAt: incoming.status === "completed" ? incoming.finishedAt ?? now : previous?.finishedAt,
  }
}

function nextFocusMode(current: FocusMode): FocusMode {
  const index = FOCUS_ORDER.indexOf(current)
  return FOCUS_ORDER[(index + 1) % FOCUS_ORDER.length] ?? "agent"
}

function uniqueOptions(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
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

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  return readNumber(value)
}

function oneLine(value: string, maxLength: number): string {
  return truncateDisplay(value.replace(/\s+/g, " ").trim(), maxLength)
}

function truncateDisplay(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...(truncated ${value.length - maxLength} chars)`
}

function shortPath(path: string): string {
  const rel = relative(process.cwd(), path)
  return rel || "."
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function closeRenderer(renderer: CliRenderer, spinnerInterval?: ReturnType<typeof setInterval>): void {
  if (spinnerInterval) clearInterval(spinnerInterval)
  renderer.stop()
  renderer.destroy()
  process.exit(0)
}
