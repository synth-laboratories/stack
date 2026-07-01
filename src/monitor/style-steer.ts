import { searchStackGuidance } from "../codex/guidance.js"
import type { StackCodexTurn } from "../session.js"
import type { StackThreadMetaEvent } from "../thread-events.js"

export type MonitorSteerStrictness = "off" | "passive" | "conservative" | "aggressive"
export type MonitorSteerSeverity = "none" | "low" | "medium" | "high"

export type SynthStyleViolation = {
  id: string
  summary: string
  guidanceQuery: string
  match: string
}

const VIOLATION_PATTERNS: Array<{
  id: string
  summary: string
  guidanceQuery: string
  pattern: RegExp
}> = [
  {
    id: "no-git-stash",
    summary: "Never use git stash (synthstyle / stack norms)",
    guidanceQuery: "stack norms git stash never",
    pattern: /\bgit stash\b/i,
  },
  {
    id: "no-git-reset-hard",
    summary: "Avoid destructive git reset --hard",
    guidanceQuery: "git reset hard",
    pattern: /\bgit reset --hard\b/i,
  },
  {
    id: "no-cross-authority-postgres",
    summary: "Do not scrape Postgres across authority boundaries",
    guidanceQuery: "postgres redis cross authority",
    pattern: /\b(postgres|redis)\b.*\b(query|scrape|compat)/i,
  },
  {
    id: "no-opportunistic-cleanup",
    summary: "No drive-by or opportunistic cleanup",
    guidanceQuery: "opportunistic cleanup scope",
    pattern: /\b(opportunistic cleanup|drive-by cleanup|unrelated cleanup)\b/i,
  },
  {
    id: "no-secret-paste",
    summary: "Do not print or paste raw secrets",
    guidanceQuery: "raw secrets stack norms",
    pattern: /\b(api[_-]?key|secret|token)\s*=\s*['"]?[a-z0-9_\-]{12,}/i,
  },
]

export function detectSynthStyleViolations(turn: StackCodexTurn): SynthStyleViolation[] {
  const text = `${turn.prompt}\n${turn.stdout}\n${turn.stderr}`
  const hits: SynthStyleViolation[] = []
  for (const entry of VIOLATION_PATTERNS) {
    const match = firstActionableViolationMatch(text, entry.pattern)
    if (!match) continue
    hits.push({
      id: entry.id,
      summary: entry.summary,
      guidanceQuery: entry.guidanceQuery,
      match,
    })
  }
  return hits
}

function firstActionableViolationMatch(text: string, pattern: RegExp): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(pattern)
    if (!match) continue
    if (isNegatedGuidanceLine(line)) continue
    return match[0]
  }
  return undefined
}

function isNegatedGuidanceLine(line: string): boolean {
  const normalized = line.trim().toLowerCase()
  return /\b(do not|don't|never|avoid|must not|should not|cannot|can't|forbidden|disallowed)\b/.test(normalized)
}

export function hasSteeredViolationRule(events: StackThreadMetaEvent[], ruleId: string): boolean {
  return events.some(
    (event) => event.type === "monitor.steer" && readPayloadString(event.payload, "rule_id") === ruleId,
  )
}

export function steerAllowedForStrictness(strictness: MonitorSteerStrictness, severity: MonitorSteerSeverity): boolean {
  if (strictness === "off" || strictness === "passive") return false
  if (strictness === "aggressive") return severityRank(severity) >= severityRank("low")
  return severityRank(severity) >= severityRank("medium")
}

export function severityForStyleViolation(violationId: string): MonitorSteerSeverity {
  if (violationId === "no-git-stash" || violationId === "no-git-reset-hard" || violationId === "no-secret-paste") {
    return "high"
  }
  return "medium"
}

export function buildStyleSteerFromGuidance(input: {
  stackRoot: string
  workspaceRoot: string
  violation: SynthStyleViolation
  excerptMaxBytes?: number
}): {
  guidanceId: string
  excerpt: string
  message: string
  query: string
} | undefined {
  const query = input.violation.guidanceQuery
  const hits = searchStackGuidance(input.stackRoot, query, {
    workspaceRoot: input.workspaceRoot,
    scope: "style",
    limit: 25,
    maxExcerptBytes: input.excerptMaxBytes ?? 400,
  })
  const preferred =
    hits.find((hit) => hit.guidanceId === "app/style/stack-norms") ??
    hits.find((hit) => hit.guidanceId.includes("stack-norms") || hit.guidanceId.includes("mistakes")) ??
    hits[0]
  if (!preferred) return undefined
  const message = [
    "Monitor steer (synth style):",
    `- Rule: ${input.violation.id} — ${input.violation.summary}`,
    `- Observed: ${input.violation.match}`,
    `- Guidance: ${preferred.guidanceId}`,
    preferred.excerpt.trim(),
    "Stop the violating approach; follow the cited norm before continuing.",
  ].join("\n")
  return {
    guidanceId: preferred.guidanceId,
    excerpt: preferred.excerpt,
    message,
    query,
  }
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function severityRank(value: MonitorSteerSeverity): number {
  if (value === "high") return 3
  if (value === "medium") return 2
  if (value === "low") return 1
  return 0
}
