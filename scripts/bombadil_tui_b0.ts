import { always, eventually, extract } from "@antithesishq/bombadil"
export * from "@antithesishq/bombadil/defaults"

import { findTuiCrashArtifacts } from "./tui_crash_guard.ts"

const statusText = extract((state) => state.document.querySelector("#status")?.textContent ?? "")
const detailsText = extract((state) => state.document.querySelector("#details")?.textContent ?? "")

export const stack_b0_scroll_passes = eventually(() => statusText.current.includes("STACK_B0_SCROLL_PASS"))

export const stack_b0_focus_passes = eventually(() => statusText.current.includes("STACK_B0_FOCUS_PASS"))

export const stack_b0_crash_cleanup_passes = eventually(() =>
  statusText.current.includes("STACK_B0_CRASH_CLEANUP_PASS"),
)

export const stack_b0_all_passes = eventually(() => statusText.current.includes("STACK_B0_ALL_PASS"))

export const stack_b0_never_crash_artifacts = always(() => findTuiCrashArtifacts(detailsText.current).length === 0)

export const stack_b0_never_buffer_crash = always(
  () => !findTuiCrashArtifacts(detailsText.current).some((artifact) => artifact.id === "opentui_buffer"),
)

export const stack_b0_never_mouse_leak = always(
  () => !findTuiCrashArtifacts(detailsText.current).some((artifact) => artifact.id === "mouse_sgr_leak"),
)

export const stack_b0_never_memory_crash = always(() => {
  const memoryIds = new Set(["oom", "native_allocator", "core_dump", "heap_corruption"])
  return !findTuiCrashArtifacts(detailsText.current).some((artifact) => memoryIds.has(artifact.id))
})
