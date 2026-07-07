import type { CliRenderer } from "@opentui/core"
import { writeSync } from "node:fs"

const TERMINAL_RESET_SEQUENCES = [
  "\u001b[?2004l",
  "\u001b[?1000l",
  "\u001b[?1002l",
  "\u001b[?1003l",
  "\u001b[?1006l",
  "\u001b[?47l",
  "\u001b[?1047l",
  "\u001b[?1048l",
  "\u001b[?1049l",
  "\u001b[2J",
  "\u001b[3J",
  "\u001b[H",
  "\u001b[?25h",
  "\u001b[0m",
]

const TERMINAL_PREPARE_SEQUENCES = ["\u001b[?1049l", "\u001b[2J", "\u001b[3J", "\u001b[H"]
let terminalExitResetInstalled = false

export function prepareTerminalForTui(): void {
  installTerminalExitReset()
  const payload = TERMINAL_PREPARE_SEQUENCES.join("")
  writeTerminalPayload(payload)
}

export function resetTerminalAfterTui(): void {
  const payload = TERMINAL_RESET_SEQUENCES.join("")
  writeTerminalPayload(payload)
}

export async function gracefulTuiTeardown(renderer: CliRenderer): Promise<void> {
  try {
    renderer.stop()
  } catch {
    // ignore
  }
  try {
    await renderer.destroy()
  } catch {
    // ignore
  }
  stopTerminalInputDrain()
  try {
    process.stdin.pause()
  } catch {
    // ignore
  }
  resetTerminalAfterTui()
  await drainTerminalRepliesAfterTui()
  resetTerminalAfterTui()
}

export async function drainTerminalRepliesAfterTui(): Promise<void> {
  if (!process.stdin.isTTY) return
  await new Promise<void>((resolve) => {
    if (!startTerminalInputDrain()) {
      resolve()
      return
    }
    setTimeout(() => {
      stopTerminalInputDrain()
      resolve()
    }, TERMINAL_REPLY_DRAIN_MS)
  })
}

function installTerminalExitReset(): void {
  if (terminalExitResetInstalled) return
  terminalExitResetInstalled = true
  process.once("exit", () => {
    resetTerminalAfterTui()
  })
}

function writeTerminalPayload(payload: string): void {
  for (const fd of [process.stdout.fd, process.stderr.fd]) {
    if (fd === undefined) continue
    try {
      writeSync(fd, payload)
    } catch {
      // Best-effort cleanup when the TTY is already gone.
    }
  }
}

export type StackAppShutdown = {
  register: (cleanup: () => void) => void
  setShellMessage: (message: string) => void
  run: (exitCode?: number) => void
}

let pendingShellMessage: string | undefined

const TERMINAL_REPLY_DRAIN_MS = 160

export function createStackAppShutdown(): StackAppShutdown {
  let finished = false
  const cleanups: Array<() => void> = []

  return {
    register(cleanup) {
      cleanups.push(cleanup)
    },
    setShellMessage(message) {
      pendingShellMessage = message.trim() || undefined
    },
    run(exitCode = 0): void {
      if (finished) process.exit(exitCode)
      finished = true

      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup()
        } catch {
          // Preserve later cleanup steps even when one handler throws.
        }
      }
      const finishExit = () => {
        stopTerminalInputDrain()
        resetTerminalAfterTui()
        if (pendingShellMessage) {
          try {
            process.stdout.write(`\n${pendingShellMessage}\n\n`)
          } catch {
            // ignore
          }
          pendingShellMessage = undefined
        }
        process.exit(exitCode)
      }

      resetTerminalAfterTui()
      if (!startTerminalInputDrain()) {
        finishExit()
        return
      }
      setTimeout(finishExit, TERMINAL_REPLY_DRAIN_MS)
    },
  }
}

function startTerminalInputDrain(): boolean {
  if (!process.stdin.isTTY) return false
  try {
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.on("data", swallowTerminalInput)
    drainReadableInput()
    return true
  } catch {
    stopTerminalInputDrain()
    return false
  }
}

function stopTerminalInputDrain(): void {
  try {
    process.stdin.off("data", swallowTerminalInput)
  } catch {
    // ignore
  }
  drainReadableInput()
  try {
    process.stdin.setRawMode?.(false)
  } catch {
    // ignore
  }
}

function swallowTerminalInput(_chunk: Buffer): void {
  // Ghostty and other terminals can answer feature/color queries just after
  // Stack leaves the alternate screen. Keep those replies out of the shell.
}

function drainReadableInput(): void {
  try {
    while (process.stdin.read() !== null) {
      // drain
    }
  } catch {
    // ignore
  }
}

import { reportStackCrash } from "../telemetry/crash-report.js"

// EINTR/EAGAIN escaping a sync fs call is a transient syscall interruption,
// not a corrupt-state fatal: the event loop is intact and the caller's next
// poll retries the read. Killing the TUI here took down live eval runs.
function isTransientSyscallError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === "EINTR" || code === "EAGAIN"
}

export function registerFatalProcessHandlers(shutdown: StackAppShutdown): void {
  let fatalHandled = false
  const onFatal = (error: unknown) => {
    if (isTransientSyscallError(error)) {
      console.error(`stack transient syscall interrupt (continuing): ${(error as Error).message}`)
      void reportStackCrash(error, "tui_transient_syscall")
      return
    }
    if (fatalHandled) return
    fatalHandled = true
    if (error instanceof Error) {
      console.error(`stack fatal: ${error.stack ?? error.message}`)
    } else {
      console.error(`stack fatal: ${String(error)}`)
    }
    void reportStackCrash(error, "tui_fatal").finally(() => {
      shutdown.run(1)
    })
  }

  process.on("uncaughtException", onFatal)
  process.on("unhandledRejection", onFatal)
  process.once("SIGTERM", () => shutdown.run(143))
}

export function registerRendererShutdown(
  shutdown: StackAppShutdown,
  renderer: CliRenderer,
  intervals: Array<ReturnType<typeof setInterval> | undefined>,
  extraCleanups: Array<(() => void) | (() => Promise<void>)> = [],
): void {
  shutdown.register(() => {
    for (const interval of intervals) {
      if (interval) clearInterval(interval)
    }
    for (const cleanup of extraCleanups) {
      try {
        const result = cleanup()
        if (result instanceof Promise) {
          void result.catch(() => undefined)
        }
      } catch {
        // ignore
      }
    }
    try {
      renderer.stop()
    } catch {
      // ignore
    }
    try {
      renderer.destroy()
    } catch {
      // ignore
    }
  })
}
