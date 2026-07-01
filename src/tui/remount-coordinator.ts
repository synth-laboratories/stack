/**
 * Coalesces OpenTUI full-tree remounts and paint-only refreshes.
 * Stack's TUI rebuilds the entire `stack-root` subtree on many state updates; overlapping
 * async refreshes (optimizer poll, monitor cadence, rate limits) used to mount concurrently
 * and blow native TextBuffer / SyntaxStyle allocation in @opentui/core.
 */

export type RemountCoordinatorBind = {
  mount: () => void
  render: () => void
}

export type RemountCoordinator = {
  bind: (handlers: RemountCoordinatorBind) => void
  /** Debounced full rebuild — use for async poll / background refresh completion. */
  scheduleRemount: () => void
  /** Immediate full rebuild with in-flight coalescing — use for operator input. */
  remountNow: () => void
  /** Paint-only refresh when the tree structure is unchanged (spinner ticks). */
  scheduleRender: () => void
  dispose: () => void
}

const DEFAULT_DEBOUNCE_MS = 24

export function readRemountDebounceMs(): number {
  const raw = process.env.STACK_TUI_REMOUNT_DEBOUNCE_MS?.trim()
  if (!raw) return DEFAULT_DEBOUNCE_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DEBOUNCE_MS
  return parsed
}

export function createRemountCoordinator(debounceMs = readRemountDebounceMs()): RemountCoordinator {
  let handlers: RemountCoordinatorBind | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let renderScheduled = false
  let mountInFlight = false
  let remountQueued = false

  const clearDebounce = () => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
  }

  const runMount = () => {
    if (!handlers) return
    if (mountInFlight) {
      remountQueued = true
      return
    }
    mountInFlight = true
    try {
      handlers.mount()
    } finally {
      mountInFlight = false
      if (remountQueued) {
        remountQueued = false
        queueMicrotask(runMount)
      }
    }
  }

  const scheduleRender = () => {
    if (!handlers) return
    if (renderScheduled) return
    renderScheduled = true
    queueMicrotask(() => {
      renderScheduled = false
      handlers?.render()
    })
  }

  const remountNow = () => {
    clearDebounce()
    runMount()
  }

  const scheduleRemount = () => {
    if (debounceMs <= 0) {
      remountNow()
      return
    }
    clearDebounce()
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      runMount()
    }, debounceMs)
  }

  return {
    bind(nextHandlers) {
      handlers = nextHandlers
    },
    scheduleRemount,
    remountNow,
    scheduleRender,
    dispose() {
      clearDebounce()
      handlers = undefined
    },
  }
}
