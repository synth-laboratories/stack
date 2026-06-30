#!/usr/bin/env bun

import {
  formatAuthChipLabel,
  parseRateLimitsFromAppServerResult,
  parseRateLimitsFromSessionJsonl,
  readCodexRateLimits,
} from "../src/codex/rate-limits.ts"

const fixture = [
  JSON.stringify({
    timestamp: "2026-06-26T15:43:42.836Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 9.0, window_minutes: 300, resets_at: 1782493937 },
        secondary: { used_percent: 32.0, window_minutes: 10080, resets_at: 1783026430 },
        plan_type: "pro",
        rate_limit_reached_type: null,
      },
    },
  }),
].join("\n")

const parsed = parseRateLimitsFromSessionJsonl(fixture)
if (!parsed?.primary || parsed.primary.usedPercent !== 9 || parsed.primary.windowMinutes !== 300) {
  console.error("rate limit parse failed for primary window")
  process.exit(1)
}
if (!parsed.secondary || parsed.secondary.usedPercent !== 32 || parsed.secondary.windowMinutes !== 10080) {
  console.error("rate limit parse failed for secondary window")
  process.exit(1)
}

const label = formatAuthChipLabel("ChatGPT", parsed)
for (const required of ["ChatGPT", "5h", "91% left", "reset", "weekly", "68% left", "reset"]) {
  if (!label.includes(required)) {
    console.error(`auth chip label missing ${required}: ${label}`)
    process.exit(1)
  }
}

const appServerFixture = {
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1782713833 },
    secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1783300633 },
    planType: "pro",
    rateLimitReachedType: "rate_limit_reached",
  },
  rateLimitResetCredits: { availableCount: 2 },
}
const appServerParsed = parseRateLimitsFromAppServerResult(appServerFixture)
if (!appServerParsed?.resetCreditsAvailable || appServerParsed.resetCreditsAvailable !== 2) {
  console.error("app-server rate limit parse failed for reset credits")
  process.exit(1)
}
const appServerLabel = formatAuthChipLabel("ChatGPT", appServerParsed)
if (!appServerLabel.includes("2 reset credits")) {
  console.error(`app-server label missing reset credits: ${appServerLabel}`)
  process.exit(1)
}

const latest = await readCodexRateLimits({ codexCommand: "codex" })
if (!latest?.primary || !latest.secondary) {
  console.error("expected live codex rate limits from recent sessions")
  process.exit(1)
}

console.log("stack_rate_limits_smoke_ok")
console.log(formatAuthChipLabel("ChatGPT", latest))
