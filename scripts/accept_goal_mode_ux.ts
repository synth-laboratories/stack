#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import {
  focusStackAgentInput,
  spawnStackTui,
  terminalText,
  waitForScreenText,
  waitForStackPrompt,
} from "./tui_e2e/harness.ts"

const objective =
  "find the gamebench craftax code policy setting, get the baseline code policy score on 100 seeds, then grind another candidate until we get one that is 2x better"

const session = await spawnStackTui({
  monitorEnabled: true,
  withStackd: true,
  cols: 170,
  rows: 48,
  keepSmokeDir: true,
})

const proofDir = join(session.smokeDir, "accept-goal-mode-ux")
mkdirSync(proofDir, { recursive: true })

const failures: string[] = []
const notes: string[] = []

try {
  const { term, workspace } = session
  await waitForStackPrompt(term)
  await focusStackAgentInput(term)
  await Bun.sleep(250)

  term.type(`/goal ${objective}`)
  term.press("Enter")
  await waitForScreenText(term, "Goal ·", 20_000)
  await waitForScreenText(term, "events", 20_000)

  const initialFeed = terminalText(term)
  if (!initialFeed.toLowerCase().includes("gamebench craftax")) failures.push("screen missing Craftax goal")
  const normalizedInitialFeed = initialFeed.replace(/[│└┘┌┐─]+/g, " ")
  if (!/t\s+thread[\s\S]*e\s+events/.test(normalizedInitialFeed)) {
    failures.push("screen missing goal sidecar thread/events controls")
  }
  for (const forbidden of ["NO_USER_UPDATE", "checkpoint advanced", "pause_for_restart", "monitor wake"]) {
    if (initialFeed.includes(forbidden)) failures.push(`default feed leaked runtime/quiet text: ${forbidden}`)
  }

  await Bun.sleep(18_000)
  const eventDir = join(workspace.stackRoot, ".stack", "events", "threads")
  const files = readdirSync(eventDir).filter((file) => file.endsWith(".jsonl"))
  const events = files.flatMap((file) =>
    readFileSync(join(eventDir, file), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  )

  const byType = (type: string) => events.filter((event) => event.type === type)
  const wakes = byType("monitor.wake")
  const summaries = byType("monitor.summary")
  const latestSummary = summaries.at(-1)
  const latestGoal = latestSummary?.payload && typeof latestSummary.payload === "object"
    ? (latestSummary.payload as Record<string, unknown>).goal_snapshot as Record<string, unknown> | undefined
    : undefined

  if (wakes.length < 1) failures.push("missing monitor.wake")
  if (summaries.length < 1) failures.push("missing monitor.summary")
  if (!String(latestGoal?.objective ?? "").toLowerCase().includes("gamebench craftax")) {
    failures.push("latest monitor summary missing Craftax goal snapshot")
  }

  const threadId = String(latestSummary?.thread_id ?? "")
  const actorId = String(latestSummary?.actor_id ?? "")
  const transcriptPath = threadId && actorId
    ? join(workspace.stackRoot, ".stack", "actors", threadId, "monitors", `${actorId}.codex.json`)
    : ""
  if (!transcriptPath || !existsSync(transcriptPath)) {
    failures.push("missing sidecar transcript in stackDataRoot")
  } else {
    const transcript = JSON.parse(readFileSync(transcriptPath, "utf8")) as { turns?: unknown[] }
    if (!Array.isArray(transcript.turns) || transcript.turns.length < 1) failures.push("sidecar transcript has no turns")
  }

  term.press("t")
  await waitForScreenText(term, "Sidecar thread", 8_000)
  await waitForScreenText(term, "Message sidecar", 8_000)
  term.press("m")
  await Bun.sleep(250)
  term.type("what should I watch next?")
  term.press("Enter")
  await Bun.sleep(8_000)

  const postChatFiles = readdirSync(eventDir).filter((file) => file.endsWith(".jsonl"))
  const postChatEvents = postChatFiles.flatMap((file) =>
    readFileSync(join(eventDir, file), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  )
  if (!postChatEvents.some((event) => event.type === "monitor.chat.request")) failures.push("missing monitor.chat.request after sidecar chat")
  if (!postChatEvents.some((event) => event.type === "monitor.chat.reply")) failures.push("missing monitor.chat.reply after sidecar chat")

  notes.push(`smokeDir=${session.smokeDir}`)
  notes.push(`wakeCount=${wakes.length}`)
  notes.push(`summaryCount=${summaries.length}`)
  notes.push(`sidecarTranscript=${transcriptPath}`)

  const summary = {
    ok: failures.length === 0,
    objective,
    notes,
    failures,
  }
  writeFileSync(join(proofDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n")
  console.log(JSON.stringify(summary, null, 2))
  if (failures.length > 0) process.exit(1)
  console.log("accept_goal_mode_ux_ok")
} finally {
  await session.cleanup()
}
