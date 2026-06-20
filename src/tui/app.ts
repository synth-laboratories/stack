import {
  Box,
  createCliRenderer,
  Input,
  InputRenderableEvents,
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
  lastSessionLogPath?: string
}

type MountedView = {
  root: ReturnType<typeof Box>
  input: ReturnType<typeof Input>
}

export async function runStackApp(options: StackAppOptions): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  const state: AppState = {
    focusMode: "agent",
    selectedIndex: 0,
    status: "idle",
    transcript: ["Stack Prototype 0 ready. Type a prompt and press Enter."],
  }

  let view = mountView(renderer, options, state, undefined)

  const remount = () => {
    view = mountView(renderer, options, state, view)
  }

  renderer.keyInput.on("keypress", (key: { name?: string; ctrl?: boolean }) => {
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

    if (state.focusMode === "context") {
      handleContextKey(key, options, state)
      remount()
    }
  })

  function attachInput(input: ReturnType<typeof Input>): void {
    input.on(InputRenderableEvents.ENTER, (value: string) => {
      const prompt = value.trim()
      if (!prompt || state.status === "running") return
      void submitPrompt(prompt, options, state, remount)
    })
  }

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
    attachInput(nextView.input)
    if (state.focusMode === "agent") nextView.input.focus()
    else nextView.input.blur()
    nextView.root.requestRender()
    return nextView
  }
}

function createView(renderer: CliRenderer, options: StackAppOptions, state: AppState): MountedView {
  const input = Input({
    id: "stack-agent-input",
    placeholder: state.status === "running" ? "Codex is running..." : "Ask local Codex...",
    width: Math.max(30, Math.min(100, renderer.width - 8)),
    backgroundColor: "#161616",
    focusedBackgroundColor: "#242424",
    textColor: "#ffffff",
    cursorColor: "#4ec9b0",
  })

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
        input,
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

  return { root, input }
}

function statusLine(options: StackAppOptions, state: AppState): string {
  return [
    `workspace=${shortPath(options.workspace.root)}`,
    `repo=${options.workspace.repoName}`,
    `branch=${options.workspace.branch}`,
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
