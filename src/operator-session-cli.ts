import type { StackConfig } from "./config.js"
import {
  listOperatorSessions,
  readActiveOperatorSession,
  readOperatorSession,
  readOperatorSessionEvents,
  summarizeOperatorSessions,
} from "./operator-session.js"
import {
  startOperatorSessionRecording,
  stopOperatorSessionRecording,
} from "./operator-session-recording.js"

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
    if (recordAction === "start") {
      try {
        const result = startOperatorSessionRecording({ session: active, kind: "fullscreen" })
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
        const result = stopOperatorSessionRecording({ session: active })
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

  printOperatorSessionUsage()
  return 2
}

function printOperatorSessionUsage(): void {
  console.log("Usage:")
  console.log("  stack session status [--json]")
  console.log("  stack session list [--json]")
  console.log("  stack session show <opesess_id> [--json]")
  console.log("  stack session record start [--json]")
  console.log("  stack session record stop [--json]")
}
