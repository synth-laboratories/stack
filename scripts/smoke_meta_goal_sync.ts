import { mapCodexGoalStatusToMeta, reconcileMetaGoalStatus } from "../src/meta-thread-goal.js"

let failures = 0
function check(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failures += 1
  }
}

// Vocabulary mapping codex → meta.
check(mapCodexGoalStatusToMeta("complete"), "done", "complete→done")
check(mapCodexGoalStatusToMeta("completed"), "done", "completed→done")
check(mapCodexGoalStatusToMeta("active"), "active", "active→active")
check(mapCodexGoalStatusToMeta("paused"), "paused", "paused→paused")
check(mapCodexGoalStatusToMeta(undefined), undefined, "undefined→undefined")

// The reported bug: agent marked the codex goal complete, meta still shows active.
check(reconcileMetaGoalStatus("complete", "active"), "done", "completion propagates")
check(reconcileMetaGoalStatus("complete", "paused"), "done", "completion overrides operator pause")
check(reconcileMetaGoalStatus("complete", "done"), undefined, "already done → no change")

// Operator-owned holds win over a codex "active".
check(reconcileMetaGoalStatus("active", "paused"), undefined, "codex active does not override pause")
check(reconcileMetaGoalStatus("active", "blocked"), undefined, "codex active does not override blocked")

// Never resurrect a cleared goal.
check(reconcileMetaGoalStatus("active", "cleared"), undefined, "cleared stays cleared")
check(reconcileMetaGoalStatus("complete", "cleared"), undefined, "cleared not resurrected by completion")

// No-ops and mirroring.
check(reconcileMetaGoalStatus("active", "active"), undefined, "in sync → no change")
check(reconcileMetaGoalStatus(undefined, "active"), undefined, "no codex signal → no change")
check(reconcileMetaGoalStatus("paused", "active"), "paused", "codex pause mirrors to meta")

if (failures > 0) {
  console.error(`meta goal sync smoke FAILED (${failures})`)
  process.exit(1)
}
console.log("stack_meta_goal_sync_smoke_ok")
