import {
  Box,
  createCliRenderer,
  Text,
  type CliRenderer,
} from "@opentui/core"
import { relative } from "node:path"
import type { StackConfig } from "../config.js"
import { runCodexTurn } from "../codex/adapter.js"
import type { WorkspaceInfo } from "../local/workspace.js"
import { type StackLocalSession, writeSessionLog } from "../session.js"

type FocusMode = "agent" | "context"

export type StackAppOptions = {
  config: StackConfig
  workspace: WorkspaceInfo
  session: StackLocalSession
}

type AppState = {
  focusMode: FocusMode
  selectedIndex: number
  status: "idle" | "running" | "error"
  transcript: string[]
  inputBuffer: string
  lastSessionLogPath?: string
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

export async function runStackApp(options: StackAppOptions): Promise<void> {
  const state: AppState = {
    focusMode: "agent",
    selectedIndex: 0,
    status: "idle",
    transcript: ["Stack Prototype 0 ready. Type a prompt and press Enter."],
    inputBuffer: "",
  }

  let view: MountedView | undefined
  let remount = () => {
    view?.root.requestRender()
  }

  const submitFromCurrentInput = (key?: StackKeyEvent): boolean => {
    if (!view || state.focusMode !== "agent" || state.status === "running") return false
    const prompt = state.inputBuffer.trim()
    if (!prompt) return false
    key?.preventDefault?.()
    key?.stopPropagation?.()
    submitInputValue(prompt, options, state, remount)
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

  renderer._internalKeyInput.onInternal("keypress", (key: StackKeyEvent) => {
    if (isEnterKey(key) && submitFromCurrentInput(key)) return
  })

  renderer.keyInput.on("keypress", (key: StackKeyEvent) => {
    if (key.ctrl && key.name === "c") return
    if (key.name === "tab") {
      state.focusMode = state.focusMode === "agent" ? "context" : "agent"
      remount()
      return
    }

    if (key.name === "escape") {
      closeRenderer(renderer)
      return
    }

    if (isEnterKey(key) && submitFromCurrentInput(key)) {
      return
    }

    if (state.focusMode === "context") {
      handleContextKey(key, options, state)
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
          width: "30%",
          padding: 1,
        },
        Text({ content: contextText(options.workspace, state), fg: "#d4d4d4" }),
      ),
      Box(
        {
          border: true,
          borderStyle: "single",
          borderColor: state.focusMode === "agent" ? "#4ec9b0" : "#555555",
          title: "Agent",
          flexGrow: 1,
          padding: 1,
          flexDirection: "column",
          gap: 1,
        },
        Text({ content: renderTranscript(state.transcript), fg: "#d4d4d4", flexGrow: 1 }),
        Text({
          content: renderAgentInput(state),
          fg: state.inputBuffer ? "#ffffff" : "#666666",
          bg: "#161616",
        }),
      ),
      Box(
        {
          border: true,
          borderStyle: "single",
          borderColor: "#555555",
          title: "Session",
          width: "24%",
          padding: 1,
        },
        Text({ content: sessionText(options, state), fg: "#d4d4d4" }),
      ),
    ),
    Box(
      {
        border: true,
        borderStyle: "single",
        borderColor: "#555555",
        title: "Remote / SMR",
        height: 5,
        padding: 1,
      },
      Text({ content: "not wired yet. Prototype 0 is local OpenTUI + Codex only.", fg: "#8a8a8a" }),
    ),
    Text({
      content: "tab focus | context: j/k move, space select | agent: enter send | esc quit",
      fg: "#8a8a8a",
    }),
  )

  return { root }
}

function submitInputValue(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): void {
  if (!prompt || state.status === "running") return
  state.inputBuffer = ""
  void submitPrompt(prompt, options, state, refresh)
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
  if (state.status === "running") return "Codex is running..."
  return state.inputBuffer ? `${state.inputBuffer}_` : "Ask local Codex..."
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
    "log:",
    state.lastSessionLogPath ? relative(options.workspace.root, state.lastSessionLogPath) : "(after first turn)",
  ].join("\n")
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

async function submitPrompt(
  prompt: string,
  options: StackAppOptions,
  state: AppState,
  refresh: () => void,
): Promise<void> {
  state.status = "running"
  state.transcript.push(`\n> ${prompt}`)
  state.transcript.push("\ncodex:")
  refresh()

  const selectedFiles = options.workspace.files.filter((file) => file.selected)
  try {
    const turn = await runCodexTurn({
      config: options.config,
      userPrompt: prompt,
      selectedFiles,
      priorTurns: options.session.turns,
      onOutput: (chunk) => {
        state.transcript.push(chunk)
        refresh()
      },
    })
    options.session.turns.push(turn)
    state.status = turn.exitCode === 0 ? "idle" : "error"
    state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir)
  } catch (error) {
    state.status = "error"
    state.transcript.push(`\n[stack] ${error instanceof Error ? error.message : String(error)}`)
    state.lastSessionLogPath = await writeSessionLog(options.session, options.config.sessionLogDir)
  } finally {
    refresh()
  }
}

function shortPath(path: string): string {
  const rel = relative(process.cwd(), path)
  return rel || "."
}

function closeRenderer(renderer: CliRenderer): void {
  renderer.destroy()
  process.exit(0)
}
