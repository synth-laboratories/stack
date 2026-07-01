// P2 — risky-pending detection. A pure detector over the worker's event stream for imminent
// irreversible/destructive actions, so the monitor can PAUSE + escalate before they run (locked
// decision #1: authority = nudge + pause). The monitor calls this each wake; a non-empty result is
// a risky-pending verdict → emit a pause and escalate to the human/gardener.

import type { StackThreadMetaEvent } from "./thread-events.js"

export type RiskyAction = {
  command: string
  category: string
  reason: string
}

// (pattern, category, reason) — destructive/irreversible or production-affecting.
const RISKY_PATTERNS: Array<{ re: RegExp; category: string; reason: string }> = [
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r\b/i, category: "delete", reason: "recursive force delete" },
  { re: /\bgit\s+reset\s+--hard\b/i, category: "vcs", reason: "discards uncommitted work" },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, category: "vcs", reason: "deletes untracked files" },
  { re: /\bgit\s+push\s+.*--force(?!-with-lease)\b|\bgit\s+push\s+-f\b/i, category: "vcs", reason: "force push overwrites remote history" },
  { re: /\b(drop\s+table|truncate\s+table|delete\s+from)\b/i, category: "db", reason: "destructive SQL" },
  { re: /\bdd\s+if=.*\s+of=\/dev\//i, category: "disk", reason: "raw device write" },
  { re: /\b(kubectl|helm)\s+delete\b/i, category: "infra", reason: "deletes live infra" },
  { re: /\b(terraform|tofu)\s+destroy\b/i, category: "infra", reason: "tears down infra" },
  { re: /\brailway\s+.*\b(down|delete|remove)\b/i, category: "infra", reason: "affects deployed service" },
  { re: /:\s*>\s*\/|>\s*\/etc\//i, category: "system", reason: "overwrites a system path" },
  { re: /\bchmod\s+-R\s+777\b/i, category: "system", reason: "recursive world-writable perms" },
  { re: /--prod\b|\bproduction\b.*\b(deploy|delete|drop|reset)\b/i, category: "prod", reason: "production-affecting action" },
]

function commandsFromEvent(event: StackThreadMetaEvent): string[] {
  const p = event.payload as Record<string, unknown>
  const out: string[] = []
  for (const key of ["command", "cmd", "input", "arguments", "tool_input"]) {
    const v = p[key]
    if (typeof v === "string") out.push(v)
    else if (Array.isArray(v)) out.push(v.filter((x) => typeof x === "string").join(" "))
  }
  return out
}

// Scan a bounded recent window of worker tool activity for imminent risky actions. Looks at
// tool.started (about-to-run) and tool.call events; a completed harmless read never matches.
export function detectRiskyPending(
  events: readonly StackThreadMetaEvent[],
  windowSize = 24,
): RiskyAction[] {
  const recent = events.slice(-windowSize)
  const found: RiskyAction[] = []
  const seen = new Set<string>()
  for (const event of recent) {
    if (!event.type.startsWith("agent.tool")) continue
    for (const command of commandsFromEvent(event)) {
      for (const { re, category, reason } of RISKY_PATTERNS) {
        if (!re.test(command)) continue
        const key = `${category}:${command.slice(0, 80)}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ command: command.slice(0, 160), category, reason })
      }
    }
  }
  return found
}

export function riskyPendingSummary(actions: readonly RiskyAction[]): string | undefined {
  if (actions.length === 0) return undefined
  const a = actions[0]!
  const more = actions.length > 1 ? ` (+${actions.length - 1} more)` : ""
  return `worker is about to run a ${a.reason}: \`${a.command}\`${more} — pause + confirm`
}
