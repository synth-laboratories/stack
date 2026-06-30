import { StyledText, fg, type TextChunk } from "@opentui/core"
import { stackTuiTheme as theme } from "./theme.js"

export type SlashCommandContext = {
  monitorEnabled: boolean
  monitorPanelOpen: boolean
  subagentsEnabled: boolean
  showDetails: boolean
  railsVisible: boolean
  agentViewEnabled: boolean
  environmentName: string
  model?: string
  effort?: string
}

export type SlashCommandSpec = {
  command: string
  aliases?: readonly string[]
  args?: string
  description: string
  describe?: (ctx: SlashCommandContext) => string
}

const SLASH_COMMAND_SPECS: SlashCommandSpec[] = [
  { command: "help", aliases: ["?"], description: "Show all commands" },
  { command: "exit", aliases: ["quit"], description: "Quit Stack" },
  { command: "g", aliases: ["gardener"], args: "[message]", description: "Open gardener or send a message" },
  {
    command: "monitor",
    aliases: ["m"],
    args: "[on|off|show|hide|message]",
    description: "Monitor controls",
    describe: (ctx) =>
      `Monitor ${ctx.monitorEnabled ? "on" : "off"} · panel ${ctx.monitorPanelOpen ? "shown" : "hidden"}`,
  },
  {
    command: "env",
    args: "[dev|staging|prod]",
    description: "Cycle or set environment",
    describe: (ctx) => `Environment (currently ${ctx.environmentName})`,
  },
  {
    command: "model",
    description: "Cycle worker model",
    describe: (ctx) => (ctx.model ? `Cycle worker model (currently ${ctx.model})` : "Cycle worker model"),
  },
  {
    command: "effort",
    description: "Cycle reasoning effort",
    describe: (ctx) => (ctx.effort ? `Cycle reasoning effort (currently ${ctx.effort})` : "Cycle reasoning effort"),
  },
  {
    command: "subagents",
    args: "[on|off]",
    description: "Toggle subagents",
    describe: (ctx) => `Toggle subagents (currently ${ctx.subagentsEnabled ? "on" : "off"})`,
  },
  {
    command: "details",
    aliases: ["d"],
    description: "Toggle verbose transcript",
    describe: (ctx) => `Toggle verbose transcript (currently ${ctx.showDetails ? "on" : "off"})`,
  },
  {
    command: "rails",
    aliases: ["b"],
    description: "Toggle side rails",
    describe: (ctx) => `Toggle side rails (currently ${ctx.railsVisible ? "shown" : "hidden"})`,
  },
  { command: "threads", aliases: ["p"], description: "Toggle threads panel" },
  { command: "actors", description: "Toggle actors panel" },
  { command: "agent", description: "Focus worker chat" },
  {
    command: "agent-view",
    aliases: ["a"],
    description: "Toggle full agent event stream",
    describe: (ctx) => `Toggle agent event stream (currently ${ctx.agentViewEnabled ? "on" : "off"})`,
  },
  { command: "clear", aliases: ["c"], description: "Clear draft input" },
]

export const SLASH_COMMAND_HELP = [
  "Stack slash commands:",
  ...SLASH_COMMAND_SPECS.map((spec) => {
    const names = [spec.command, ...(spec.aliases ?? [])].join("|")
    const args = spec.args ? ` ${spec.args}` : ""
    return `  /${names.padEnd(22)}${args.padEnd(18)}${spec.description}`
  }),
].join("\n")

const SLASH_MENU_MAX_ROWS = 10
const SLASH_MENU_STACKED_BELOW = 56

function commandLabel(spec: SlashCommandSpec): string {
  const args = spec.args ? ` ${spec.args}` : ""
  return `/${spec.command}${args}`
}

function menuOneLine(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}

function matchesQuery(spec: SlashCommandSpec, query: string): boolean {
  if (!query) return true
  const names = [spec.command, ...(spec.aliases ?? [])]
  return names.some((name) => name.startsWith(query))
}

export function slashMenuQuery(buffer: string): string | null {
  const trimmed = buffer.trimStart()
  if (!trimmed.startsWith("/")) return null
  const rest = trimmed.slice(1)
  const spaceIdx = rest.indexOf(" ")
  if (spaceIdx >= 0) return null
  return rest.toLowerCase()
}

export function slashMenuVisible(buffer: string): boolean {
  return slashMenuQuery(buffer) !== null
}

export function filterSlashCommands(query: string): SlashCommandSpec[] {
  return SLASH_COMMAND_SPECS.filter((spec) => matchesQuery(spec, query))
}

export function resolveSlashSubmitPrompt(buffer: string, selectedIndex: number): string {
  const trimmed = buffer.trim()
  const query = slashMenuQuery(trimmed)
  if (query === null) return trimmed
  const matches = filterSlashCommands(query)
  const selected = matches[Math.min(Math.max(0, selectedIndex), Math.max(0, matches.length - 1))]
  if (!selected) return trimmed
  if (query === selected.command || (selected.aliases ?? []).includes(query)) return trimmed
  return `/${selected.command}`
}

export function clampSlashMenuIndex(buffer: string, selectedIndex: number): number {
  const query = slashMenuQuery(buffer)
  if (query === null) return 0
  const matches = filterSlashCommands(query)
  if (matches.length === 0) return 0
  return Math.min(Math.max(0, selectedIndex), matches.length - 1)
}

export function navigateSlashMenu(buffer: string, selectedIndex: number, direction: "up" | "down"): number {
  const query = slashMenuQuery(buffer)
  if (query === null) return 0
  const matches = filterSlashCommands(query)
  if (matches.length === 0) return 0
  const current = clampSlashMenuIndex(buffer, selectedIndex)
  if (direction === "up") return Math.max(0, current - 1)
  return Math.min(matches.length - 1, current + 1)
}

export function completeSlashMenuSelection(buffer: string, selectedIndex: number): string | null {
  const query = slashMenuQuery(buffer)
  if (query === null) return null
  const matches = filterSlashCommands(query)
  const selected = matches[clampSlashMenuIndex(buffer, selectedIndex)]
  if (!selected) return null
  return selected.args ? `/${selected.command} ` : `/${selected.command}`
}

export function renderSlashCommandMenuStyled(
  buffer: string,
  selectedIndex: number,
  ctx: SlashCommandContext,
  columns: number,
): StyledText {
  const query = slashMenuQuery(buffer)
  if (query === null) return new StyledText([])

  const matches = filterSlashCommands(query)
  const chunks: TextChunk[] = []
  const usable = Math.max(20, columns - 2)
  const stacked = usable < SLASH_MENU_STACKED_BELOW

  if (matches.length === 0) {
    chunks.push(fg(theme.fgSecondary)("  no matching commands"))
    return new StyledText(chunks)
  }

  const clampedIndex = clampSlashMenuIndex(buffer, selectedIndex)
  const visible = matches.slice(0, SLASH_MENU_MAX_ROWS)
  const hidden = matches.length - visible.length

  for (const [index, spec] of visible.entries()) {
    const selected = index === clampedIndex
    const label = commandLabel(spec)
    const description = spec.describe?.(ctx) ?? spec.description
    const prefix = selected ? "→ " : "  "
    const prefixStyle = selected ? fg(theme.fgPrimary) : fg(theme.fgMuted)
    const commandStyle = selected ? fg(theme.synth.amber) : fg(theme.fgSecondary)
    const descriptionStyle = selected ? fg(theme.fgAccent) : fg(theme.fgSecondary)

    if (stacked) {
      chunks.push(prefixStyle(prefix), commandStyle(menuOneLine(label, usable - 2)), fg(theme.fgMuted)("\n"))
      chunks.push(
        fg(theme.fgMuted)("     "),
        descriptionStyle(menuOneLine(description, usable - 5)),
        fg(theme.fgMuted)("\n"),
      )
      continue
    }

    const commandWidth = Math.min(
      Math.max(label.length + 2, 20),
      Math.floor(usable * 0.42),
    )
    const descriptionWidth = Math.max(12, usable - commandWidth - 2)
    chunks.push(
      prefixStyle(prefix),
      commandStyle(label.padEnd(commandWidth)),
      descriptionStyle(menuOneLine(description, descriptionWidth)),
      fg(theme.fgMuted)("\n"),
    )
  }

  if (hidden > 0) {
    chunks.push(fg(theme.synth.warmMuted)(`  ↓ ${hidden} more · ↑↓ navigate · tab complete`))
  } else {
    chunks.push(fg(theme.synth.warmMuted)("  ↑↓ navigate · tab complete · enter run"))
  }

  return new StyledText(chunks)
}

export function parseSlashCommand(prompt: string): { name: string; args: string } | null {
  const trimmed = prompt.trim()
  if (!trimmed.startsWith("/")) return null
  const space = trimmed.indexOf(" ")
  if (space === -1) return { name: trimmed.slice(1).toLowerCase(), args: "" }
  return { name: trimmed.slice(1, space).toLowerCase(), args: trimmed.slice(space + 1).trim() }
}

export type SlashDispatchHooks = {
  exit: () => void
  feedback: (message: string) => void
  openGardener: () => void
  messageGardener: (message: string) => void
  openMonitor: () => void
  hideMonitor: () => void
  setMonitorEnabled: (enabled: boolean) => void
  messageMonitor: (message: string) => void
  cycleEnvironment: (direction: number) => void
  setEnvironment: (name: string) => boolean
  cycleModel: () => void
  cycleEffort: () => void
  setSubagents: (enabled: boolean | undefined) => void
  toggleDetails: () => void
  toggleRails: () => void
  toggleThreads: () => void
  toggleActors: () => void
  focusAgent: () => void
  toggleAgentView: () => void
  clearInput: () => void
}

export function dispatchSlashCommand(prompt: string, hooks: SlashDispatchHooks): boolean {
  const parsed = parseSlashCommand(prompt)
  if (!parsed) return false

  const { name, args } = parsed
  switch (name) {
    case "exit":
    case "quit":
      hooks.exit()
      return true
    case "help":
    case "?":
      hooks.feedback(SLASH_COMMAND_HELP)
      return true
    case "g":
    case "gardener":
      if (args) {
        hooks.messageGardener(args)
      } else {
        hooks.openGardener()
      }
      return true
    case "m":
    case "monitor": {
      const verb = args.toLowerCase()
      if (verb === "on") {
        hooks.setMonitorEnabled(true)
        return true
      }
      if (verb === "off") {
        hooks.setMonitorEnabled(false)
        hooks.feedback("monitor off")
        return true
      }
      if (verb === "show") {
        hooks.openMonitor()
        return true
      }
      if (verb === "hide") {
        hooks.hideMonitor()
        return true
      }
      if (args) {
        hooks.messageMonitor(args)
      } else {
        hooks.openMonitor()
      }
      return true
    }
    case "env":
      if (args) {
        if (!hooks.setEnvironment(args)) {
          hooks.feedback(`unknown env ${args} · use dev, staging, or prod`)
        }
      } else {
        hooks.cycleEnvironment(1)
      }
      return true
    case "model":
      hooks.cycleModel()
      hooks.feedback("cycled worker model")
      return true
    case "effort":
      hooks.cycleEffort()
      hooks.feedback("cycled reasoning effort")
      return true
    case "subagents":
      if (args === "on") hooks.setSubagents(true)
      else if (args === "off") hooks.setSubagents(false)
      else hooks.setSubagents(undefined)
      return true
    case "details":
    case "d":
      hooks.toggleDetails()
      return true
    case "rails":
    case "b":
      hooks.toggleRails()
      return true
    case "threads":
    case "p":
      hooks.toggleThreads()
      return true
    case "actors":
      hooks.toggleActors()
      return true
    case "agent":
      hooks.focusAgent()
      return true
    case "agent-view":
    case "a":
      hooks.toggleAgentView()
      return true
    case "clear":
    case "c":
      hooks.clearInput()
      return true
    default:
      hooks.feedback(`unknown command /${name} · type /help`)
      return true
  }
}
