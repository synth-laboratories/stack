import { join } from "node:path"
import { stackdGardenerPassComplete } from "./client/stackd.js"
import type { StackConfig } from "./config.js"
import { runGardenerChatTurn } from "./gardener-chat.js"
import { appendGardenerChatMessage } from "./gardener.js"
import { listSessionHistory, readSessionLog } from "./session.js"

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1]?.trim() || undefined : undefined
}

export async function runGardenerCli(config: StackConfig, argv: string[]): Promise<number> {
  if (argv[1] !== "message") {
    console.error("usage: stack gardener message --gardener-thread-id <id> --worker-thread-id <id> (--message <text> | --message-stdin)")
    return 2
  }
  const gardenerThreadId = option(argv, "--gardener-thread-id")
  const workerThreadId = option(argv, "--worker-thread-id")
  if (!gardenerThreadId || !workerThreadId) {
    console.error("stack gardener message requires --gardener-thread-id and --worker-thread-id")
    return 2
  }
  const message = argv.includes("--message-stdin")
    ? (await Bun.stdin.text()).trim()
    : option(argv, "--message")
  if (!message) {
    console.error("stack gardener message requires --message or --message-stdin")
    return 2
  }
  if (!argv.includes("--message-recorded")) {
    appendGardenerChatMessage(config.stackDataRoot, gardenerThreadId, "user", message, {
      source: "gardener-cli",
    })
  }

  const workerSession = await readSessionLog(join(config.sessionLogDir, `${workerThreadId}.json`))
  const workerSummaries = await listSessionHistory(config.sessionLogDir, config.codexPricing)
  const response = await runGardenerChatTurn({
    config,
    gardenerThreadId,
    workerSession,
    workerSummaries,
    workerTargetId: workerThreadId,
    userMessage: message,
  })
  await stackdGardenerPassComplete(gardenerThreadId, "gardener_default", {
    wake_reason: option(argv, "--wake-reason") ?? "operator_chat",
  })
  console.log(JSON.stringify({
    gardener_thread_id: gardenerThreadId,
    worker_thread_id: workerThreadId,
    responded: Boolean(response?.trim()),
  }))
  return 0
}
