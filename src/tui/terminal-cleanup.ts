import type { CliRenderer } from "@opentui/core"

const TERMINAL_RESET_SEQUENCES = [
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
  run: (exitCode?: number) => never
}

export function createStackAppShutdown(): StackAppShutdown {
  let finished = false
  const cleanups: Array<() => void> = []

  return {
    register(cleanup) {
      cleanups.push(cleanup)
    },
    run(exitCode = 0): never {
      if (finished) process.exit(exitCode)
      finished = true

      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup()
        } catch {
          // Preserve later cleanup steps even when one handler throws.
        }
      }
      resetTerminalAfterTui()
      process.exit(exitCode)
    },
  }
}

export function registerFatalProcessHandlers(shutdown: StackAppShutdown): void {
  const onFatal = (error: unknown) => {
    if (error instanceof Error) {
      console.error(`stack fatal: ${error.stack ?? error.message}`)
    } else {
      console.error(`stack fatal: ${String(error)}`)
    }
    shutdown.run(1)
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
