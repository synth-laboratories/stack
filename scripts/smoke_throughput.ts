import {
  formatAverageTokensPerSecond,
  refreshSessionThroughput,
  seedEmaFromTurns,
  sessionAverageTokensPerSecond,
  turnTokensPerSecond,
  updateEmaTokensPerSecond,
} from "../src/tui/throughput.ts"

const sampleTurn = {
  startedAt: "2026-06-26T00:00:00.000Z",
  finishedAt: "2026-06-26T00:00:02.000Z",
  usage: { outputTokens: 20, reasoningOutputTokens: 0 },
}

const tps = turnTokensPerSecond(sampleTurn)
if (tps === undefined || Math.abs(tps - 10) > 0.01) {
  console.error(`expected 10 tok/s, got ${tps}`)
  process.exit(1)
}

const ema = updateEmaTokensPerSecond(undefined, 10)
const ema2 = updateEmaTokensPerSecond(ema, 30)
if (ema2 === undefined || ema2 <= 10 || ema2 >= 30) {
  console.error(`ema should sit between samples, got ${ema2}`)
  process.exit(1)
}

const seeded = seedEmaFromTurns([sampleTurn, { ...sampleTurn, usage: { outputTokens: 40 } }])
if (seeded === undefined) {
  console.error("seedEmaFromTurns returned undefined")
  process.exit(1)
}

const sessionAvg = sessionAverageTokensPerSecond([sampleTurn])
if (sessionAvg === undefined || Math.abs(sessionAvg - 10) > 0.01) {
  console.error(`expected session avg 10 tok/s, got ${sessionAvg}`)
  process.exit(1)
}

const snapshot: { averageTokensPerSecond?: number; emaTokensPerSecond?: number } = {}
refreshSessionThroughput(snapshot, [sampleTurn])
if (snapshot.averageTokensPerSecond === undefined || Math.abs(snapshot.averageTokensPerSecond - 10) > 0.01) {
  console.error(`refreshSessionThroughput avg failed: ${snapshot.averageTokensPerSecond}`)
  process.exit(1)
}

refreshSessionThroughput(snapshot, [sampleTurn, { ...sampleTurn, id: "t2", usage: { outputTokens: 40 } }])
if (snapshot.averageTokensPerSecond === undefined) {
  console.error("refreshSessionThroughput after second turn failed")
  process.exit(1)
}

if (formatAverageTokensPerSecond(10.4) !== "avg 10.4 tok/s") {
  console.error("formatAverageTokensPerSecond mismatch for 10.4")
  process.exit(1)
}

console.log("stack_throughput_smoke_ok", snapshot.averageTokensPerSecond?.toFixed(2))
