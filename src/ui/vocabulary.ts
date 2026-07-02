// UI vocabulary registry — every side-panel id on screen pays rent.
//
// A panel id maps to who may open it, the views it hosts, the MCP lever that opens
// it, the slash command that opens it by hand, and the ui.* events it emits. The
// TUI, the MCP tools, and the smoke all read THIS table; an on-screen label with no
// registry row is a defect (A6, smoke-ui-vocab).

export type UiPanelId = "monitor" | "gardener" | "ops" | "threads"

export type UiPanelOpener = "monitor" | "gardener" | "operator"

export type UiPanelSpec = {
  id: UiPanelId
  /// Actors allowed to tool-open this panel (operator can always open via slash).
  openedBy: readonly UiPanelOpener[]
  views: readonly string[]
  toolName: "stack_ui_open_panel"
  slash: string
  eventTypes: readonly ["ui.panel_opened", "ui.panel_closed", "ui.panel_focus"]
}

const EVENT_TYPES = ["ui.panel_opened", "ui.panel_closed", "ui.panel_focus"] as const

export const UI_PANELS: Record<UiPanelId, UiPanelSpec> = {
  monitor: {
    id: "monitor",
    openedBy: ["monitor", "gardener", "operator"],
    views: ["events", "thread", "tape"],
    toolName: "stack_ui_open_panel",
    slash: "/m",
    eventTypes: EVENT_TYPES,
  },
  gardener: {
    id: "gardener",
    openedBy: ["gardener", "operator"],
    views: ["portfolio", "chat"],
    toolName: "stack_ui_open_panel",
    slash: "/g",
    eventTypes: EVENT_TYPES,
  },
  ops: {
    id: "ops",
    openedBy: ["gardener", "operator"],
    views: ["local", "remote", "hosted"],
    toolName: "stack_ui_open_panel",
    slash: "/ops",
    eventTypes: EVENT_TYPES,
  },
  threads: {
    id: "threads",
    openedBy: ["operator"],
    views: ["list"],
    toolName: "stack_ui_open_panel",
    slash: "/threads",
    eventTypes: EVENT_TYPES,
  },
}

export const UI_PANEL_IDS = Object.keys(UI_PANELS) as UiPanelId[]

export function isUiPanelId(value: string): value is UiPanelId {
  return value in UI_PANELS
}

export function panelOpenAllowed(panel: UiPanelId, opener: UiPanelOpener): boolean {
  return UI_PANELS[panel].openedBy.includes(opener)
}

export function panelViewAllowed(panel: UiPanelId, view: string): boolean {
  return UI_PANELS[panel].views.includes(view)
}
