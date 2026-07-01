#!/usr/bin/env bun
//
// Deterministic test for slash-command error quality. A registered command must never be reported
// as "unknown" (that lie is what made a broken `/goal` impossible to diagnose), and a typo should
// suggest the nearest real command.

import { closestSlashCommand, dispatchSlashCommand } from "../src/tui/slash-commands.js"

const failures: string[] = []
let checks = 0
function check(cond: boolean, msg: string): void {
  checks += 1
  if (!cond) failures.push(msg)
}

// closest-command suggestions
check(closestSlashCommand("gol") === "goal", "typo /gol suggests /goal (not the 1-letter /g)")
check(closestSlashCommand("mointor") === "monitor", "typo /mointor suggests /monitor (not /m)")
check(closestSlashCommand("modl") === "model", "typo /modl suggests /model")
check(closestSlashCommand("goa") === "goal", "prefix /goa suggests /goal")
check(closestSlashCommand("xyzzy") === undefined, "gibberish gets no false suggestion")

// dispatch feedback messages
function feedbackFor(command: string): string {
  let out = ""
  const hooks = new Proxy(
    { feedback: (m: string) => { out = m } },
    { get: (target, prop) => (prop === "feedback" ? (target as { feedback: (m: string) => void }).feedback : () => false) },
  ) as unknown as Parameters<typeof dispatchSlashCommand>[1]
  dispatchSlashCommand(command, hooks)
  return out
}

const goalMsg = feedbackFor("/goal")
check(!/unknown command/i.test(goalMsg), "/goal is NOT reported as unknown (it is a registered command)")
check(/goal/i.test(goalMsg) && /objective|panel|worker input/i.test(goalMsg), "/goal error explains how to use it")

const goalArgsMsg = feedbackFor("/goal build a thing")
check(!/unknown command/i.test(goalArgsMsg), "/goal <args> is not reported as unknown")

const typoMsg = feedbackFor("/mointor")
check(/did you mean \/monitor/i.test(typoMsg), "typo error suggests the nearest command")

const gibberishMsg = feedbackFor("/xyzzy")
check(/unknown command \/xyzzy/i.test(gibberishMsg), "genuinely unknown command still says unknown")
check(!/did you mean/i.test(gibberishMsg), "no bogus suggestion for gibberish")

if (failures.length > 0) {
  console.error(`SLASH ERROR FAILURES (${failures.length}/${checks}):\n` + failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
console.log(`stack_slash_errors_ok (${checks} checks)`)
