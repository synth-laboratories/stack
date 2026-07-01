export type StackCrashArtifact = {
  id: string
  label: string
  pattern: RegExp
}

/** SSOT for OpenTUI / Bun / terminal crash signatures in TUI smokes and crash reporting. */
export const STACK_CRASH_ARTIFACTS: readonly StackCrashArtifact[] = [
  {
    id: "opentui_buffer",
    label: "OpenTUI optimized buffer allocation failure",
    pattern: /Failed to create optimized buffer/i,
  },
  {
    id: "mouse_sgr_leak",
    label: "raw SGR mouse tracking sequences leaked into terminal output",
    pattern: /;[0-9]+;[0-9]+;[0-9]+M/,
  },
  {
    id: "segfault",
    label: "segmentation fault",
    pattern: /Segmentation fault|SIGSEGV|signal 11/i,
  },
  {
    id: "abort_trap",
    label: "abort trap / SIGABRT",
    pattern: /Abort trap|SIGABRT|signal 6|libc\+\+\:.*abort/i,
  },
  {
    id: "oom",
    label: "out-of-memory",
    pattern: /out of memory|ENOMEM|JavaScript heap out of memory|allocation failed|Cannot allocate memory/i,
  },
  {
    id: "bun_crash",
    label: "Bun runtime crash",
    pattern: /oh no: Bun has crashed|Bun v[0-9].*panic|panic\(.*\).*at/i,
  },
  {
    id: "stack_fatal",
    label: "Stack fatal shutdown",
    pattern: /stack fatal:/i,
  },
  {
    id: "core_dump",
    label: "core dump",
    pattern: /core dumped|writing core/i,
  },
  {
    id: "heap_corruption",
    label: "heap / allocator corruption",
    pattern: /double free|heap-use-after-free|malloc:.*corruption|free\(\): invalid pointer/i,
  },
  {
    id: "native_allocator",
    label: "native allocator failure",
    pattern: /std::bad_alloc|terminating due to uncaught exception.*bad_alloc/i,
  },
]

export function findStackCrashArtifacts(text: string): StackCrashArtifact[] {
  return STACK_CRASH_ARTIFACTS.filter((artifact) => artifact.pattern.test(text))
}

export function primaryCrashClass(artifacts: StackCrashArtifact[]): string {
  if (artifacts.some((artifact) => artifact.id === "opentui_buffer")) return "opentui_buffer"
  if (artifacts.some((artifact) => artifact.id === "mouse_sgr_leak")) return "mouse_sgr_leak"
  if (artifacts.some((artifact) => artifact.id === "oom" || artifact.id === "native_allocator")) {
    return "memory_exhaustion"
  }
  if (artifacts.some((artifact) => artifact.id === "core_dump" || artifact.id === "heap_corruption")) {
    return "memory_corruption"
  }
  if (artifacts.some((artifact) => artifact.id === "segfault" || artifact.id === "abort_trap")) {
    return "process_crash"
  }
  if (artifacts.some((artifact) => artifact.id === "bun_crash")) return "bun_crash"
  return artifacts[0]?.id ?? "unknown"
}

export function sanitizeCrashMessage(text: string, maxLength = 512): string {
  const normalized = text
    .replace(/\/Users\/[^\s:'"]+/g, "[path]")
    .replace(/\/home\/[^\s:'"]+/g, "[path]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}
