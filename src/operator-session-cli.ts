import type { StackConfig } from "./config.js"
import {
  listOperatorSessions,
  readActiveOperatorSession,
  readOperatorSession,
  readOperatorSessionEvents,
  summarizeOperatorSessions,
} from "./operator-session.js"
import {
  reconcileOperatorSessionCapturesToEffort,
  startOperatorSessionRecording,
  stopOperatorSessionRecording,
} from "./operator-session-recording.js"
import {
  extractOperatorSessionScreencaps,
  formatScreencapSummary,
  parseAtSecondsFlag,
} from "./operator-session-screencaps.js"

function wantsJson(argv: string[]): boolean {
  return argv.includes("--json")
}

function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h")
}

export async function runOperatorSessionCli(config: StackConfig, argv: string[]): Promise<number> {
  const [, action, subaction] = argv
  const json = wantsJson(argv)
  const help = wantsHelp(argv)
  const topHelp = !action || action === "help" || action === "--help" || action === "-h"

  if (topHelp || help) {
    printOperatorSessionUsage()
    return topHelp || help ? 0 : 2
  }

  if (action === "status") {
    const summary = summarizeOperatorSessions(config.stackDataRoot)
    if (json) {
      console.log(JSON.stringify(summary, null, 2))
      return 0
    }
    if (!summary.active) {
      console.log("No active operator session.")
      console.log(`Sessions · local ${summary.counts.local} · cloud ${summary.counts.cloud || "—"}`)
      return 0
    }
    const active = summary.active
    console.log(`operator_session ${active.operator_session_id}`)
    console.log(`status ${active.status}`)
    console.log(`started_at ${active.started_at}`)
    if (active.tagged_effort_slug) console.log(`effort ${active.tagged_effort_slug}`)
    if (active.effort_session_id) console.log(`effort_session ${active.effort_session_id}`)
    console.log(`Sessions · local ${summary.counts.local} · cloud ${summary.counts.cloud || "—"}`)
    return 0
  }

  if (action === "list" || action === "ls") {
    const sessions = listOperatorSessions(config.stackDataRoot)
    if (json) {
      console.log(JSON.stringify(sessions, null, 2))
      return 0
    }
    if (sessions.length === 0) {
      console.log("No operator sessions yet.")
      return 0
    }
    for (const session of sessions) {
      const duration =
        session.duration_ms === null ? "open" : `${Math.round(session.duration_ms / 1000)}s`
      const effort = session.tagged_effort_slug ? ` effort=${session.tagged_effort_slug}` : ""
      console.log(
        `${session.operator_session_id} · ${session.status} · ${duration} · captures=${session.capture_count}${effort}`,
      )
    }
    return 0
  }

  if (action === "show") {
    const operatorSessionId = subaction
    if (!operatorSessionId) {
      console.error("usage: stack session show <opesess_id> [--json]")
      return 2
    }
    const session = readOperatorSession(config.stackDataRoot, operatorSessionId)
    if (!session) {
      console.error(`operator session not found: ${operatorSessionId}`)
      return 1
    }
    const events = readOperatorSessionEvents(config.stackDataRoot, operatorSessionId)
    if (json) {
      console.log(JSON.stringify({ session, events }, null, 2))
      return 0
    }
    console.log(JSON.stringify(session, null, 2))
    console.log(`events ${events.length}`)
    for (const event of events.slice(-20)) {
      console.log(`${event.observed_at} ${event.type}`)
    }
    return 0
  }

  if (action === "record") {
    const recordAction = subaction
    const active = readActiveOperatorSession(config.stackDataRoot)
    if (!active) {
      console.error("no active operator session; launch Stack first")
      return 1
    }
    const display = parseFlagNumber(argv, "--display")
    const device = parseFlagString(argv, "--device")
    if (recordAction === "start") {
      try {
        const result = startOperatorSessionRecording({
          session: active,
          kind: "fullscreen",
          ...(display !== undefined ? { display } : {}),
          ...(device ? { device } : {}),
        })
        if (json) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          console.log(`recording started · ${result.capture.capture_id}`)
          console.log(result.capture.output_path)
        }
        return 0
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        return 1
      }
    }
    if (recordAction === "stop") {
      try {
        const captureId = parseFlagString(argv, "--id")
        const result = stopOperatorSessionRecording({
          session: active,
          ...(captureId ? { captureId } : {}),
        })
        if (json) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          console.log(`recording stopped · ${result.capture.capture_id}`)
          console.log(result.capture.output_path)
        }
        return 0
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        return 1
      }
    }
    console.error("usage: stack session record start|stop [--json]")
    return 2
  }

  if (action === "screencaps" || action === "frames") {
    const operatorSessionId = subaction && !subaction.startsWith("--") ? subaction : undefined
    const session =
      (operatorSessionId ? readOperatorSession(config.stackDataRoot, operatorSessionId) : undefined) ??
      readActiveOperatorSession(config.stackDataRoot)
    if (!session) {
      console.error("no operator session; pass <opesess_id> or launch Stack")
      return 1
    }
    const captureId = parseFlagString(argv, "--capture") ?? parseFlagString(argv, "--id")
    const outputDir = parseFlagString(argv, "--output") ?? parseFlagString(argv, "--out")
    const intervalSec = parseFlagNumber(argv, "--interval")
    const maxFrames = parseFlagNumber(argv, "--max")
    let atSeconds: number[] | undefined
    try {
      atSeconds = parseAtSecondsFlag(parseFlagString(argv, "--at"))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 2
    }
    try {
      const result = extractOperatorSessionScreencaps({
        stackDataRoot: config.stackDataRoot,
        operatorSessionId: session.operator_session_id,
        ...(captureId ? { captureId } : {}),
        ...(outputDir ? { outputDir } : {}),
        ...(intervalSec !== undefined ? { intervalSec } : {}),
        ...(maxFrames !== undefined ? { maxFrames } : {}),
        ...(atSeconds ? { atSeconds } : {}),
      })
      if (json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(formatScreencapSummary(result))
      }
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (action === "link-captures" || action === "link") {
    const operatorSessionId = subaction
    const session =
      (operatorSessionId ? readOperatorSession(config.stackDataRoot, operatorSessionId) : undefined) ??
      readActiveOperatorSession(config.stackDataRoot)
    if (!session) {
      console.error("no operator session; pass <opesess_id> or launch Stack")
      return 1
    }
    if (!session.tagged_effort_slug) {
      console.error(`operator session ${session.operator_session_id} has no tagged effort`)
      return 1
    }
    const result = reconcileOperatorSessionCapturesToEffort(session)
    if (json) {
      console.log(JSON.stringify(result, null, 2))
      return result.failed > 0 ? 1 : 0
    }
    console.log(
      `linked ${result.linked} · skipped ${result.skipped} · failed ${result.failed} · effort ${session.tagged_effort_slug}`,
    )
    for (const entry of result.results) {
      if (entry.ok) {
        console.log(`  ✓ ${entry.captureId} → ${entry.effortPath}`)
      } else if (!entry.skipped) {
        console.log(`  ✗ ${entry.captureId} · ${entry.error}`)
      }
    }
    return result.failed > 0 ? 1 : 0
  }

  printOperatorSessionUsage()
  return 2
}

function printOperatorSessionUsage(): void {
  console.log("Usage:")
  console.log("  stack session status [--json]")
  console.log("  stack session list [--json]")
  console.log("  stack session show <opesess_id> [--json]")
  console.log("  stack session record start [--display <n>] [--device <name>] [--json]")
  console.log("  stack session record stop [--id <capture_id>] [--json]")
  console.log("  stack session link-captures [<opesess_id>] [--json]")
  console.log("  stack session screencaps [<opesess_id>] [--capture <opcap_id>] [--interval <sec>] [--at 0,6,12] [--max <n>] [--output <dir>] [--json]")
}

function parseFlagString(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]?.trim()
  return value || undefined
}

function parseFlagNumber(argv: string[], flag: string): number | undefined {
  const value = parseFlagString(argv, flag)
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : undefined
}
