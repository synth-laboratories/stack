import type { CliRenderer } from "@opentui/core"

const TERMINAL_RESET_SEQUENCES = [
  "\u001b[?2004l",
  "\u001b[?1000l",
  "\u001b[?1002l",
  "\u001b[?1003l",
  "\u001b[?1006l",
  "\u001b[?1049l",
  "\u001b[?25h",
  "\u001b[0m",
]

export function resetTerminalAfterTui(): void {
  const payload = TERMINAL_RESET_SEQUENCES.join("")
  for (const stream of [process.stdout, process.stderr]) {
    try {
      stream.write(payload)
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

export function registerFatalProcessHandlers(shutdown: StackAppShutdown): void {
  const onFatal = (error: unknown) => {
    if (error instanceof Error) {
      console.error(`stack fatal: ${error.stack ?? error.message}`)
    } else {
      console.error(`stack fatal: ${String(error)}`)
    }
    void reportStackCrash(error, "tui_fatal").finally(() => {
      shutdown.run(1)
    })
  }

  process.once("uncaughtException", onFatal)
  process.once("unhandledRejection", onFatal)
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
