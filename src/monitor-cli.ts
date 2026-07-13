import { join } from "node:path"
import type { StackConfig } from "./config.js"
import { emptyAgentContext } from "./codex/agent-context.js"
import { emptyGoalContext } from "./codex/goal-context.js"
import { mergeMetaThreadGoalContext, readMetaThreadManifest } from "./meta-thread-goal.js"
import { runMonitorForNewEvents } from "./monitor.js"
import { readSessionLog } from "./session.js"

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1]?.trim() || undefined : undefined
}

export async function runMonitorCli(config: StackConfig, argv: string[]): Promise<number> {
  if (argv[1] !== "run-once") {
    console.error("usage: stack monitor run-once --thread-id <id> [--profile <name>] [--wake-reason <reason>]")
    return 2
  }
  const threadId = option(argv, "--thread-id")
  if (!threadId) {
    console.error("stack monitor run-once requires --thread-id")
    return 2
  }

  const session = await readSessionLog(join(config.sessionLogDir, `${threadId}.json`))
  const manifest = session.metaThreadId
    ? await readMetaThreadManifest(config.stackDataRoot, session.metaThreadId)
    : undefined
  const snapshot = await runMonitorForNewEvents({
    config,
    session,
    agentContext: emptyAgentContext(session.workspaceRoot),
    goalContext: mergeMetaThreadGoalContext(emptyGoalContext(), manifest),
    wakeReason: option(argv, "--wake-reason") ?? "external_worker_turn",
    drainQueued: true,
    monitorProfile: option(argv, "--profile") ?? manifest?.monitor_profile,
  })
  console.log(JSON.stringify({
    thread_id: threadId,
    actor_id: snapshot.actorId,
    label: snapshot.label,
    status: snapshot.status,
    wake_count: snapshot.wakeCount,
    queued_count: snapshot.queuedCount,
  }))
  return 0
}
