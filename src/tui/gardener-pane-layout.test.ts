import { expect, test } from "bun:test"
import {
  gardenerAgentBlockHeight,
  gardenerPlanBlockHeight,
  gardenerTranscriptRowsWithReserve,
} from "./gardener-pane-layout.js"

test("gardenerAgentBlockHeight: separator + header + up to 6 rows + overflow row", () => {
  expect(gardenerAgentBlockHeight(0)).toBe(0)
  expect(gardenerAgentBlockHeight(1)).toBe(3)
  expect(gardenerAgentBlockHeight(3)).toBe(5)
  expect(gardenerAgentBlockHeight(6)).toBe(8)
  expect(gardenerAgentBlockHeight(8)).toBe(9) // separator + header + 6 shown + 1 overflow
})

test("gardenerPlanBlockHeight: header + one row per step", () => {
  expect(gardenerPlanBlockHeight(0)).toBe(0)
  expect(gardenerPlanBlockHeight(4)).toBe(5)
})

// The anti-overlap invariant: the transcript reserves exactly the bottom widgets' height, so the
// composited pane (transcript + plan + agents) fits the viewport with no row written twice.
test("no overlap: transcript + reserved bottom widgets fit the viewport exactly", () => {
  for (const viewportLines of [8, 20, 40, 80]) {
    for (const agents of [0, 1, 3, 6, 9]) {
      for (const steps of [0, 4, 10]) {
        const planH = gardenerPlanBlockHeight(steps)
        const agentH = gardenerAgentBlockHeight(agents)
        const transcript = gardenerTranscriptRowsWithReserve(viewportLines, planH, agentH)
        expect(transcript).toBeGreaterThanOrEqual(1)
        if (viewportLines >= planH + agentH + 1) {
          // Room for the widgets plus at least one transcript row → exact fit, no overflow, no gap.
          expect(transcript + planH + agentH).toBe(viewportLines)
        }
      }
    }
  }
})

// Guards the exact regression from the screenshot: the Agents block was appended below the control
// row while the transcript still filled the whole viewport, so the two composited onto the same
// rows ("Agentse·g3tlive ·o0|donedev").
test("regression: not reserving rows overflows the pane; reserving fixes it", () => {
  const viewportLines = 20
  const agentH = gardenerAgentBlockHeight(3) // 4 rows

  const buggyTranscript = viewportLines // old behavior: transcript took the whole budget
  expect(buggyTranscript + agentH).toBeGreaterThan(viewportLines) // overflow → overlapping text

  const fixedTranscript = gardenerTranscriptRowsWithReserve(viewportLines, 0, agentH)
  expect(fixedTranscript + agentH).toBeLessThanOrEqual(viewportLines) // fits, no overlap
})
