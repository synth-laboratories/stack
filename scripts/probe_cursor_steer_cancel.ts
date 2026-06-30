#!/usr/bin/env bun

import { CursorAcpSession } from "../src/cursor/acp-session.ts"
import { loadConfig } from "../src/config.ts"

const appRoot = process.cwd()
const config = await loadConfig(appRoot)
config.harness = "cursor"
config.cursorModel = "composer-2.5"

async function probeCancel(): Promise<boolean> {
  let output = ""
  const session = new CursorAcpSession({ config, onOutput: (chunk) => { output += chunk } })
  await session.ensureReady()

  const turnPromise = session.runTurn({
    config,
    userPrompt: "Run a long task: list numbers 1 to 100 slowly, one per line. No tools.",
    selectedFiles: [],
    priorTurns: [],
  })

  await new Promise((r) => setTimeout(r, 2500))
  await session.interrupt()
  const turn = await turnPromise
  await session.close()

  const cancelled = turn.exitCode === 130
  console.log(`cancel probe: exit=${turn.exitCode} cancelled=${cancelled}`)
  return cancelled
}

async function probeSteer(): Promise<boolean> {
  let output = ""
  const session = new CursorAcpSession({ config, onOutput: (chunk) => { output += chunk } })
  await session.ensureReady()

  const turnPromise = session.runTurn({
    config,
    userPrompt: "Count from 1 to 30, one number per line. Do not use tools. Take your time.",
    selectedFiles: [],
    priorTurns: [],
  })

  await new Promise((r) => setTimeout(r, 2500))
  const steered = await session.trySteer("STOP. Reply with exactly: STEER_OK only.")
  const turn = await turnPromise
  await session.close()

  const steerOk = output.includes("STEER_OK") || turn.stdout.includes("STEER_OK")
  console.log(`steer probe: trySteer=${steered} steer_ok_in_output=${steerOk}`)
  return steered && steerOk
}

const cancelOk = await probeCancel()
const steerOk = await probeSteer()

console.log(JSON.stringify({ cancelOk, steerOk, steerSupported: false }, null, 2))
if (!cancelOk) process.exit(1)
console.log("stack_cursor_steer_cancel_probe_ok")
