#!/usr/bin/env bun
//
// Deterministic unit tests for the pure monitor-supervision logic — NO LLM, milliseconds.
// This is the fast guardrail: the real-brain behavior is proven by accept_monitor_supervision.ts,
// but these lock the wiring (redaction, dedup signature, steer-once, no-progress suppression) so
// it cannot silently regress. Two root-split bugs already shipped once without a test — not again.

import { boundedTail, redactSecrets } from "../src/core-agent-events.js"
import { isNoProgressAnnouncement, recentSidecarSteerIsSimilar, triggerSignature } from "../src/monitor.js"
import type { StackThreadMetaEvent } from "../src/thread-events.js"

const failures: string[] = []
let checks = 0
function check(cond: boolean, msg: string): void {
  checks += 1
  if (!cond) failures.push(msg)
}

// ---- redactSecrets: worker output must not leak secrets into the durable event log ----
check(!redactSecrets("export SYNTH_API_KEY=sk-abcdef0123456789abcdef").includes("sk-abcdef"), "redact: sk- key masked")
check(redactSecrets("SYNTH_API_KEY=supersecretvalue123").includes("[REDACTED]"), "redact: env KEY assignment masked")
check(redactSecrets("Authorization: Bearer abcdef0123456789ghijkl").includes("[REDACTED_TOKEN]"), "redact: bearer masked")
check(
  redactSecrets("db at postgres://user:pw@host/db").includes("[REDACTED]@"),
  "redact: postgres credentials masked",
)
check(redactSecrets("baseline 0.085 over 100 seeds") === "baseline 0.085 over 100 seeds", "redact: normal text untouched")
// The formats the adversarial review flagged as leaking:
check(!redactSecrets('"SecretAccessKey": "wJalrXUtnFEMI/K7MDENGbPxRfiCYEXAMPLEKEY"').includes("wJalrXUtnFEMI"), "redact: JSON secret field")
check(!redactSecrets("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop").includes("eyJzdWIi"), "redact: JWT")
check(redactSecrets("key sk_live_0123456789abcdefghijkl end").includes("[REDACTED_KEY]"), "redact: stripe sk_ underscore key")
check(redactSecrets("AIza" + "D".repeat(35) + " end").includes("[REDACTED_KEY]"), "redact: google AIza key")
check(redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----").includes("[REDACTED_PRIVATE_KEY]"), "redact: PEM private key block")
check(redactSecrets("db mongodb+srv://user:secretpass@cluster0.mongodb.net").includes("[REDACTED]@"), "redact: url creds any scheme")
check(redactSecrets("Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1").includes("[REDACTED_TOKEN]"), "redact: basic auth")
check(redactSecrets("gho_0123456789abcdefghijklmnop token").includes("[REDACTED_TOKEN]"), "redact: github gho_ token")

// ---- boundedTail: the monitor sees a bounded TAIL of stdout (the result) ----
check(boundedTail("short", 100) === "short", "boundedTail: short unchanged")
check(boundedTail("", 100) === "", "boundedTail: empty -> empty")
check(boundedTail("x".repeat(50), 10).includes("truncated"), "boundedTail: long marked truncated")
check(boundedTail("abcdefghij", 4).endsWith("ghij"), "boundedTail: keeps the tail, not the head")

// ---- triggerSignature: the stable identity of a failing action ----
const failEvt = (cmd: string): StackThreadMetaEvent =>
  ({ type: "agent.tool.failed", payload: { tool_name: "bash", command: cmd } }) as unknown as StackThreadMetaEvent
const turnEvt = (): StackThreadMetaEvent =>
  ({ type: "agent.turn.completed", payload: {} }) as unknown as StackThreadMetaEvent
check(triggerSignature([failEvt("run x")]) === triggerSignature([failEvt("run x")]), "signature: same command stable")
check(triggerSignature([failEvt("run x")]) !== triggerSignature([failEvt("run y")]), "signature: different command differs")
check(triggerSignature([turnEvt()]) === "", "signature: no failures -> empty")
check(triggerSignature([]) === "", "signature: empty batch -> empty")
check(triggerSignature([failEvt("")]) === "", "signature: empty command is skipped (no tool: collapse)")

// ---- recentSidecarSteerIsSimilar: steer once per issue ----
const steerEvt = (msg: string, sig: string): StackThreadMetaEvent =>
  ({
    type: "monitor.steer",
    payload: { source: "sidecar_codex", message: msg, trigger_signature: sig },
  }) as unknown as StackThreadMetaEvent
// Same failure signature dedups even when the monitor rewords the steer completely.
check(
  recentSidecarSteerIsSimilar([steerEvt("worded one way", "bash:run x")], "worded a totally different way", "bash:run x"),
  "dedup: same signature suppresses a reworded steer",
)
// Near-identical prose dedups even without a signature (off-goal steers have none).
check(
  recentSidecarSteerIsSimilar(
    [steerEvt("find the correct craftax candidate entrypoint module", "")],
    "find the correct craftax candidate entrypoint module now",
    "",
  ),
  "dedup: similar prose suppresses (Jaccard)",
)
// A genuinely different issue is NOT suppressed.
check(
  !recentSidecarSteerIsSimilar(
    [steerEvt("fix the missing module path", "sigA")],
    "the candidate score is below the target threshold",
    "sigB",
  ),
  "dedup: different signature + different prose is allowed",
)
check(!recentSidecarSteerIsSimilar([], "anything", "sig"), "dedup: no prior steers -> allowed")
// A non-sidecar (style-regex) steer must not block a sidecar steer.
const styleSteer = { type: "monitor.steer", payload: { source: "style", message: "same words here", trigger_signature: "" } } as unknown as StackThreadMetaEvent
check(!recentSidecarSteerIsSimilar([styleSteer], "same words here", ""), "dedup: only dedups against sidecar steers")
// H3: the prior steer must still be found even when a chatty worker buried it under >40 raw events.
const noise: StackThreadMetaEvent[] = Array.from(
  { length: 60 },
  () => ({ type: "agent.tool.completed", payload: {} }) as unknown as StackThreadMetaEvent,
)
check(
  recentSidecarSteerIsSimilar([steerEvt("worded once", "bash:run x"), ...noise], "reworded", "bash:run x"),
  "dedup: window is over steers, survives 60 intervening raw events",
)
// M1: a persisting failing command dedups even when the failing SET changes between wakes.
check(
  recentSidecarSteerIsSimilar(
    [steerEvt("x", triggerSignature([failEvt("cmd1"), failEvt("cmd2")]))],
    "reworded",
    triggerSignature([failEvt("cmd1")]),
  ),
  "dedup: shared failing command across a changed failing set",
)

// ---- isNoProgressAnnouncement: an update that only announces the ABSENCE of progress is noise ----
check(isNoProgressAnnouncement("No new goal progress; nothing changed since last review"), "noprogress: plain no-progress")
check(isNoProgressAnnouncement("No goal progress this batch"), "noprogress: 'no goal progress' phrasing")
check(isNoProgressAnnouncement("No goal-relevant progress yet; the worker only listed files"), "noprogress: goal-relevant phrasing")
check(isNoProgressAnnouncement("No new benchmark result landed yet"), "noprogress: no new result")
check(!isNoProgressAnnouncement("Baseline landed at 0.085 over 100 seeds"), "noprogress: a real number is signal")
check(!isNoProgressAnnouncement("done-claim refuted: 0.11 is below the 0.17 target"), "noprogress: a refutation is signal")
check(!isNoProgressAnnouncement("Candidate produced; criterion met"), "noprogress: a transition is signal")
// M2: a concern must NOT be swallowed even when phrased as "no progress yet".
check(!isNoProgressAnnouncement("No results yet; the worker is blocked on missing credentials"), "noprogress: a concern (blocked) is kept")
check(!isNoProgressAnnouncement("No new progress; the build keeps failing"), "noprogress: a failure concern is kept")

if (failures.length > 0) {
  console.error(`MONITOR LOGIC FAILURES (${failures.length}/${checks}):\n` + failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
console.log(`stack_monitor_logic_ok (${checks} checks)`)
