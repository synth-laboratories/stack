#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  stackdApproveMetaThreadArtifact,
  stackdCreateMetaThread,
  stackdMetaThread,
  stackdSealMetaThreadSegment,
  stackdUpdateMetaThreadGoal,
} from "../src/client/stackd.js"
import type { StackLocalSession } from "../src/session.js"

const appRoot = resolve(import.meta.dir, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const smokeRoot = join(appRoot, ".stack", "evidence", "meta-threads-concurrency", stamp)
const stackRoot = join(smokeRoot, "stack-root")
const sessionLogDir = join(stackRoot, ".stack", "sessions")
const proofDir = join(smokeRoot, "proof")
const port = 19020 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const laneCount = Number(process.env.STACK_META_THREADS_CONCURRENCY_LANES ?? "5")

mkdirSync(sessionLogDir, { recursive: true })
mkdirSync(proofDir, { recursive: true })

const stackdBin = resolve(appRoot, "target/debug/stackd")
const proc = Bun.spawn([stackdBin, "serve", "--port", String(port)], {
  cwd: stackRoot,
  env: {
    ...process.env,
    STACK_ROOT: stackRoot,
    STACK_SESSION_DIR: sessionLogDir,
    STACK_API_URL: baseUrl,
    STACKD_MONITOR_SCHEDULER: "0",
  },
  stdout: "pipe",
  stderr: "pipe",
})

try {
  process.env.STACK_API_URL = baseUrl
  await waitForHealth(`${baseUrl}/health`)

  const lanes = Array.from({ length: laneCount }, (_, index) => index + 1)
  const results = await Promise.all(lanes.map((lane) => runLane(lane)))
  const failures = results.flatMap((result) => result.failures)
  const summary = {
    stamp,
    ok: failures.length === 0,
    lane_count: laneCount,
    failures,
    results,
    proof_dir: smokeRoot,
    stack_api_url: baseUrl,
  }

  writeFileSync(join(proofDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n")

  if (failures.length > 0) {
    console.error(`stack_meta_threads_concurrency_failed: ${failures.join("; ")}`)
    process.exit(1)
  }

  console.log("stack_meta_threads_concurrency_ok")
  console.log(JSON.stringify(summary, null, 2))
} finally {
  proc.kill()
  await proc.exited.catch(() => undefined)
}

async function runLane(lane: number): Promise<{
  lane: number
  failures: string[]
  thread_id: string
  meta_thread_id?: string
  segment_id?: string
  artifact_id?: string
  artifact_path?: string
}> {
  const failures: string[] = []
  const threadId = `thread_${lane}_${randomUUID()}`
  const objective = `Concurrency lane ${lane}: preserve handoff state`
  const session: StackLocalSession = {
    id: threadId,
    workspaceRoot: resolve(appRoot, ".."),
    startedAt: new Date().toISOString(),
    codexCommand: "codex",
    turns: [],
  }
  writeFileSync(join(sessionLogDir, `${threadId}.json`), JSON.stringify(session, null, 2) + "\n")

  const created = await stackdCreateMetaThread({
    title: `Concurrency lane ${lane}`,
    thread_id: threadId,
    role: "implement",
    model: "gpt-5.4-mini",
    reasoning_effort: "medium",
    harness: "codex",
    active_goal: {
      objective,
      status: "active",
      acceptance_criteria: [`[ ] lane ${lane} artifact sealed`],
      blockers: [],
    },
  })
  const createdHeadSegment = created.segments.find((segment) => segment.segmentId === created.head_segment_id)
  if (created.head_thread_id !== threadId) failures.push(`lane ${lane}: head_thread_id mismatch on create`)
  if (createdHeadSegment?.threadId !== threadId) failures.push(`lane ${lane}: head segment threadId mismatch on create`)
  if (created.active_goal?.objective !== objective) failures.push(`lane ${lane}: objective missing on create`)

  const blocker = `lane ${lane} synthetic blocker`
  await stackdUpdateMetaThreadGoal(created.id, { blockers: [blocker] })
  const manifest = await stackdMetaThread(created.id)
  if (!manifest.active_goal?.blockers?.includes(blocker)) failures.push(`lane ${lane}: blocker missing after update`)

  const artifact = await stackdSealMetaThreadSegment(created.id, created.head_segment_id, {
    summary: `Lane ${lane} sealed under parallel load`,
    successor_role: "implement",
    recommended_next_action: "continue_implement",
  })
  if (artifact.createdByThreadId !== threadId) failures.push(`lane ${lane}: artifact thread binding mismatch`)
  const artifactPath = join(stackRoot, artifact.path.replace(/^\.stack\//, ".stack/"))
  const artifactBody = readFileSync(artifactPath, "utf8")
  if (!artifactBody.includes(objective)) failures.push(`lane ${lane}: artifact missing objective`)
  if (!artifactBody.includes(blocker)) failures.push(`lane ${lane}: artifact missing blocker`)

  await stackdApproveMetaThreadArtifact(created.id, artifact.id, { thread_id: threadId })

  return {
    lane,
    failures,
    thread_id: threadId,
    meta_thread_id: created.id,
    segment_id: created.head_segment_id,
    artifact_id: artifact.id,
    artifact_path: artifact.path,
  }
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 20_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = `${response.status} ${await response.text()}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(250)
  }
  throw new Error(`stackd health failed: ${lastError}`)
}
