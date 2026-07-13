/** High-contrast charcoal palette. Synth warmth is reserved for actions and state. */
export const stackTuiTheme = {
  fgPrimary: "#f7f8fa",
  fgSecondary: "#d9dde3",
  fgMuted: "#b3bac4",
  fgPlaceholder: "#9da6b2",
  fgAccent: "#dce1e8",
  fgAccentStrong: "#ffffff",
  /** Typed command input — always high contrast on dark input bg. */
  fgInput: "#f5f7fa",
  fgOnAccent: "#0b0b0c",
  bgCanvas: "#1e2229",
  bgSubtle: "#282d36",
  bgPanel: "#1e2229",
  bgInput: "#343944",
  bgInputFocused: "#3b414d",
  bgChipActive: "#4a5260",
  borderInactive: "#4d5562",
  borderActive: "#98a2b1",
  fgDivider: "#4b525e",
  chipInactive: "#aab1bb",
  /** Warm Synth spectrum — state and scan hierarchy, not decoration-only. */
  synth: {
    orange: "#fd6600",
    orangeDark: "#ca5200",
    amber: "#e0a000",
    gold: "#e0c000",
    yellow: "#f7a41d",
    red: "#f85149",
    warmMuted: "#9a7344",
    warmDim: "#6b5340",
  },
  /** Meta-goal lifecycle: active green, paused yellow, blocked orange, done blue. */
  goalLifecycle: {
    active: "#3fb950",
    paused: "#f7a41d",
    blocked: "#fd6600",
    done: "#58a6ff",
    cleared: "#6e7681",
  },
  /** Per-role transcript colors: planning reads warm; tools stay quiet. */
  transcript: {
    userLabel: "#f1f1f1",
    userBody: "#ffffff",
    agentLabel: "#ffffff",
    agentBody: "#f1f3f5",
    planningLabel: "#e0a000",
    planningBody: "#e8dcc0",
    thinkingLabel: "#c08000",
    thinkingBody: "#b8a888",
    toolLabel: "#d9dde3",
    toolBody: "#cbd1d9",
    stackLabel: "#ca5200",
    stackBody: "#c4a882",
    subagentLabel: "#9a7344",
    subagentBody: "#9a9080",
    meta: "#a0a8b4",
    heading: "#ffffff",
    inlineCode: "#b7c4f3",
    codeText: "#edf0f4",
    codeKeyword: "#d6a4e8",
    codeString: "#f0b98d",
    codeNumber: "#b9d99a",
    codeComment: "#9aaa8f",
    codeFunction: "#82b7ff",
    codeType: "#f0c674",
    codeOperator: "#89ddff",
    link: "#9fc5ff",
    bullet: "#d7ba7d",
    semanticIdentifier: "#aebbea",
    semanticPath: "#83c7de",
    semanticSuccess: "#9fd18b",
    semanticWarning: "#e8bf76",
    semanticError: "#ef8585",
    diffAdd: "#89d185",
    diffRemove: "#f48771",
    diffHunk: "#75beff",
  },
} as const

export function goalLifecycleStatusColor(status: string | undefined): string {
  const normalized = (status ?? "active").trim().toLowerCase()
  const colors = stackTuiTheme.goalLifecycle
  if (normalized === "blocked") return colors.blocked
  if (normalized === "done" || normalized === "complete" || normalized === "completed") return colors.done
  if (normalized === "paused") return colors.paused
  if (normalized === "cleared") return colors.cleared
  return colors.active
}
