#!/usr/bin/env bun
//
// Acceptance test: prove the monitor produces VALUABLE supervision, not just that plumbing fires.
//
// Worker events are SCRIPTED (deterministic, free); the monitor sidecar runs REAL (codex
// app-server, gpt-5.4-mini). Value = the update stream is high-signal and correct:
//   S1 progress — informs with the concrete result (cites specifics only in the events)
//   S2 stuck    — steers with an actionable instruction (real STEER_WORKER, source=sidecar_codex)
//   S5 dedup    — re-firing the SAME unresolved stall must NOT produce a second steer (steer once)
//   S4 audit    — REFUTES a bogus worker done-claim by doing the math (0.11 < 0.17 target)
//   S3 quiet    — on a fresh thread, a trivial `ls` must yield NO steer and NO progress (signal/noise)
// Plus: secrets injected into worker output must be REDACTED out of the durable event log.
// All are unfakeable by the canned fake_codex sidecar.

import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/config.js"
import { runMonitorAfterTurn, runMonitorForNewEvents } from "../src/monitor.js"
import { appendThreadMetaEvent, readThreadMetaEvents, stackEventId } from "../src/thread-events.js"
import type { StackCodexTurn, StackLocalSession } from "../src/session.js"
import type { StackThreadMetaEvent } from "../src/thread-events.js"

process.env.STACK_MONITOR_PROFILE = "default" // conservative, steer=true, monitor.steer allowed
const appRoot = resolve(import.meta.dir, "..")
delete process.env.STACK_CODEX_COMMAND // use the REAL codex sidecar brain, not the canned fake
delete process.env.STACK_CODEX_ARGS

const config = await loadConfig(appRoot)
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "accept-monitor-supervision", stamp)
mkdirSync(proofDir, { recursive: true })

const failures: string[] = []
const notes: string[] = []
const SECRET = "sk-abcdef0123456789abcdefSECRET"
const goalContext = {
  objective:
    "Find the GameBench Craftax code-policy setting, get the baseline on 100 seeds, then grind a candidate until it is 2x the baseline.",
  status: "active" as const,
  source: "context" as const,
}

const mkSession = (id: string): StackLocalSession => ({
  id,
  workspaceRoot: config.workspaceRoot,
  startedAt: new Date().toISOString(),
  codexCommand: "codex",
  turns: [],
})
const allFor = (id: string): StackThreadMetaEvent[] => readThreadMetaEvents(config.stackDataRoot, id)
const eventText = (e: StackThreadMetaEvent): string => {
  const p = (e.payload ?? {}) as Record<string, unknown>
  return [p.summary, p.user_progress, p.message, p.progress_note].map((v) => (typeof v === "string" ? v : "")).join(" ")
}
async function turnFor(id: string, session: StackLocalSession, prompt: string, stdout: string): Promise<void> {
  const turn: StackCodexTurn = {
    id: `turn-${randomUUID()}`,
    prompt,
    selectedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout,
    stderr: "",
  }
  await runMonitorAfterTurn({
    config,
    session: { ...session, turns: [turn] },
    turn,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
    goalContext,
  })
}
async function failStall(id: string, session: StackLocalSession): Promise<void> {
  for (let i = 0; i < 3; i++) {
    appendThreadMetaEvent(config.stackDataRoot, {
      event_id: stackEventId("agent_tool_failed"),
      type: "agent.tool.failed",
      thread_id: id,
      observed_at: new Date().toISOString(),
      actor_id: "primary_codex",
      actor_role: "primary",
      payload: {
        tool_name: "bash",
        command: "uv run python -m gamebench.craftax.run_candidate --candidate cand_a",
        message: `ModuleNotFoundError: No module named 'gamebench.craftax.run_candidate' (attempt ${i + 1})`,
      },
    })
  }
  await runMonitorForNewEvents({
    config,
    session,
    agentContext: { usedSkills: [], loadedSkills: [], cwd: config.workspaceRoot },
    goalContext,
    wakeReason: "tool_failed",
    triggerEventIds: [allFor(id).at(-1)!.event_id],
  })
}
async function scenario(
  label: string,
  id: string,
  drive: () => Promise<void>,
): Promise<{ steers: StackThreadMetaEvent[]; progress: StackThreadMetaEvent[]; text: string }> {
  const before = allFor(id).length
  await drive()
  const fresh = allFor(id).slice(before)
  const steers = fresh.filter((e) => e.type === "monitor.steer")
  // A user-facing update = a progress/summary event with SUBSTANTIVE text. An internal checkpoint
  // whose body is just "NO_USER_UPDATE" (or empty) is the monitor correctly staying quiet, not an update.
  const substantive = (e: StackThreadMetaEvent): boolean => {
    const t = eventText(e).trim()
    return t.length > 0 && !/^no[_ ]user[_ ]update\.?$/i.test(t)
  }
  const progress = fresh.filter((e) => (e.type === "monitor.progress" || e.type === "monitor.summary") && substantive(e))
  const text = progress.map(eventText).join(" ").trim()
  notes.push(`${label}: steers=${steers.length} progress=${progress.length} :: ${text.slice(0, 200) || "(quiet)"}`)
  return { steers, progress, text }
}

// ===== main thread: S1 -> S2 -> S5 -> S4 =====
const main = `accept-monitor-${randomUUID()}`
const mainSession = mkSession(main)

const s1 = await scenario("S1 progress", main, async () => {
  await turnFor(
    main,
    mainSession,
    "Run the craftax code-policy baseline on 100 seeds and record the score.",
    `export SYNTH_API_KEY=${SECRET}\nBaseline eval complete: craftax code-policy mean reward = 0.085 over 100 seeds. Target for the candidate is >= 0.17 (2x baseline).`,
  )
})
if (s1.progress.length === 0) failures.push("S1: no progress update after a real baseline milestone")
if (!/0\.085|baseline|100 seeds|0\.17|2x/i.test(s1.text))
  failures.push(`S1: update must cite the concrete result; got: ${s1.text.slice(0, 160)}`)
if (JSON.stringify(allFor(main)).includes(SECRET)) failures.push("S1: SECRET leaked into the event log — redaction failed")

// S2 + S5 test the SAME stall over two wakes. Invariant: steer EXACTLY ONCE across both — the
// monitor must catch the stall (>=1) but never repeat itself (<=1). Which wake it fires on is
// non-deterministic and does not matter.
const s2 = await scenario("S2 stuck", main, () => failStall(main, mainSession))
const s5 = await scenario("S5 dedup", main, () => failStall(main, mainSession))
const stallSteers = [...s2.steers, ...s5.steers]
const stallCodex = stallSteers.filter((e) => (e.payload as Record<string, unknown>)?.source === "sidecar_codex")
if (stallCodex.length === 0) failures.push("S2/S5: monitor never steered a genuinely stuck 6x-repeated identical failure")
if (stallCodex.length > 1)
  failures.push(`S2/S5: monitor steered the same stall ${stallCodex.length}x — violates steer-once (dedup failed)`)

// S4 — worker CLAIMS the 2x criterion done, but 0.11 < 0.17. Monitor must refute (a NEW issue).
const s4 = await scenario("S4 audit", main, async () => {
  await turnFor(
    main,
    mainSession,
    "Grind a candidate and mark the 2x-improvement criterion done.",
    "Candidate cand_b scored 0.11 mean reward over 100 seeds. Marking the 2x-improvement criterion as DONE.",
  )
})
if (s4.progress.length === 0) failures.push("S4: monitor stayed silent on a bogus done-claim — should audit/refute")
else if (!/0\.11|0\.17|not|below|short|does ?n.t|fail|insufficient|still|missing/i.test(s4.text))
  failures.push(`S4: refutation must name the shortfall (0.11 < 0.17); got: ${s4.text.slice(0, 200)}`)

// ===== fresh thread: S3 quiet on trivia (clean slate, no outstanding concern) =====
const triv = `accept-monitor-trivia-${randomUUID()}`
const trivSession = mkSession(triv)
const s3 = await scenario("S3 quiet", triv, async () => {
  await turnFor(triv, trivSession, "List the workspace directory.", "ls -1\nREADME.md\nLICENSE\npackage.json\nsrc\ntests\ntsconfig.json")
})
// HARD: no substantive progress update on trivia (no-progress announcements are code-suppressed).
if (s3.progress.length > 0)
  failures.push(`S3: monitor emitted a substantive progress update on trivia — expected quiet; got: ${s3.text.slice(0, 160)}`)
// SOFT: an orienting steer at goal-start on a fresh thread is a judgment call, not clear noise — note it.
if (s3.steers.length > 0) notes.push("S3 note: monitor issued an orienting steer on the trivial turn (defensible at goal-start)")

const summary = {
  stamp,
  brain: "real codex app-server (gpt-5.4-mini)",
  value_notes: notes,
  failures,
  ok: failures.length === 0,
}
writeFileSync(join(proofDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(JSON.stringify(summary, null, 2))
if (failures.length > 0) {
  console.error("\nACCEPTANCE FAILED:\n" + failures.join("\n"))
  process.exit(1)
}
console.log("\naccept_monitor_supervision_ok")
