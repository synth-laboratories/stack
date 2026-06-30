import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  stackdHealthOk,
  stackdLatestCheckpoint,
  stackdResolveCheckpoint,
  stackdSaveCheckpoint,
  type StackdResumeBundle,
  type StackdSaveCheckpointResponse,
} from "./client/stackd.js"
import type { StackLocalSession, StackSessionHarness } from "./session.js"
import type { HarnessResumeState, MetaThreadCheckpointState } from "./checkpoint-state.js"

export type StackResumeCheckpoint = {
  version: 1
  schema?: string
  savedAt: string
  sessionId: string
  metaThreadId?: string
  segmentId?: string
  codexThreadId?: string
  harness?: StackSessionHarness
  codexTransport?: "exec" | "app-server" | "acp"
  goalShutterWorkerPeek?: boolean
  goalShutterSidecarView?: "thread" | "events"
  focusMode?: string
  displayName?: string
  harnessResume?: HarnessResumeState
  metaThreadState?: MetaThreadCheckpointState
}

export const CHECKPOINT_SCHEMA = "stack/checkpoint/v1"

export function checkpointsDir(stackDataRoot: string): string {
  return join(stackDataRoot, ".stack", "checkpoints")
}

export function resumeCheckpointPath(stackDataRoot: string): string {
  return join(checkpointsDir(stackDataRoot), "latest.json")
}

export function legacyResumeCheckpointPath(stackDataRoot: string): string {
  return join(stackDataRoot, ".stack", "resume.json")
}

function threadCheckpointPath(stackDataRoot: string, threadId: string): string {
  return join(checkpointsDir(stackDataRoot), "threads", safeCheckpointSegment(threadId), "latest.json")
}

function metaThreadCheckpointPath(stackDataRoot: string, metaThreadId: string): string {
  return join(checkpointsDir(stackDataRoot), "meta-threads", safeCheckpointSegment(metaThreadId), "latest.json")
}

function safeCheckpointSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
}

export function resumeCheckpointFromCheckpoint(checkpoint: StackResumeCheckpoint): string {
  return checkpoint.sessionId.slice(0, 8)
}

export function resumeTokenFromMetaThreadId(metaThreadId: string): string {
  const numeric = metaThreadId.match(/(\d{6,})/)?.[1]
  if (numeric) return numeric.slice(0, 12)
  return metaThreadId.replace(/^mt_?/i, "").slice(0, 12)
}

export function resumeCommandFromCheckpoint(checkpoint: StackResumeCheckpoint): string {
  return `stack resume ${resumeCheckpointFromCheckpoint(checkpoint)}`
}

export async function writeResumeCheckpoint(
  stackDataRoot: string,
  checkpoint: StackResumeCheckpoint,
): Promise<string> {
  const normalized = normalizeCheckpoint(checkpoint)
  await writeCheckpointFiles(stackDataRoot, normalized)
  if (await stackdHealthOk()) {
    try {
      await stackdSaveCheckpoint(normalized)
    } catch {
      // Local checkpoint files remain authoritative when stackd is offline.
    }
  }
  return resumeCheckpointPath(stackDataRoot)
}

export async function readLatestResumeCheckpoint(stackDataRoot: string): Promise<StackResumeCheckpoint | undefined> {
  try {
    const raw = await readFile(resumeCheckpointPath(stackDataRoot), "utf8")
    return parseCheckpoint(raw)
  } catch {
    try {
      const raw = await readFile(legacyResumeCheckpointPath(stackDataRoot), "utf8")
      return parseCheckpoint(raw)
    } catch {
      if (await stackdHealthOk()) {
        try {
          const latest = await stackdLatestCheckpoint()
          return normalizeCheckpoint(latest as StackResumeCheckpoint)
        } catch {
          return undefined
        }
      }
      return undefined
    }
  }
}

export async function resolveResumeBundle(
  stackDataRoot: string,
  sessionLogDir: string,
  query?: string,
): Promise<StackdResumeBundle | undefined> {
  if (await stackdHealthOk()) {
    try {
      return await stackdResolveCheckpoint(query)
    } catch {
      // fall through to local resolution
    }
  }
  const checkpoint = await resolveResumeCheckpointLocal(stackDataRoot, sessionLogDir, query)
  if (!checkpoint) return undefined
  let session: StackLocalSession
  try {
    session = JSON.parse(await readFile(join(sessionLogDir, `${checkpoint.sessionId}.json`), "utf8")) as StackLocalSession
  } catch {
    return undefined
  }
  return {
    checkpoint,
    session,
    resumeToken: resumeCheckpointFromCheckpoint(checkpoint),
    resumeCommand: resumeCommandFromCheckpoint(checkpoint),
  }
}

export async function resolveResumeCheckpoint(
  stackDataRoot: string,
  sessionLogDir: string,
  query?: string,
): Promise<StackResumeCheckpoint | undefined> {
  const bundle = await resolveResumeBundle(stackDataRoot, sessionLogDir, query)
  return bundle ? normalizeCheckpoint(bundle.checkpoint as StackResumeCheckpoint) : undefined
}

async function resolveResumeCheckpointLocal(
  stackDataRoot: string,
  sessionLogDir: string,
  query?: string,
): Promise<StackResumeCheckpoint | undefined> {
  const trimmed = query?.trim()
  if (!trimmed) return readLatestResumeCheckpoint(stackDataRoot)

  const latest = await readLatestResumeCheckpoint(stackDataRoot)
  if (latest && checkpointMatchesQuery(latest, trimmed)) return latest

  const entries = await readdir(sessionLogDir).catch(() => [] as string[])
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    try {
      const raw = await readFile(join(sessionLogDir, entry), "utf8")
      const session = JSON.parse(raw) as {
        id?: string
        metaThreadId?: string
        segmentId?: string
        codexThreadId?: string
        harness?: StackSessionHarness
        displayName?: string
      }
      if (!session.id) continue
      if (session.id.startsWith(trimmed) || session.metaThreadId?.includes(trimmed)) {
        return normalizeCheckpoint({
          version: 1,
          savedAt: new Date().toISOString(),
          sessionId: session.id,
          metaThreadId: session.metaThreadId,
          segmentId: session.segmentId,
          codexThreadId: session.codexThreadId,
          harness: session.harness,
          displayName: session.displayName,
        })
      }
    } catch {
      continue
    }
  }
  return undefined
}

function checkpointMatchesQuery(checkpoint: StackResumeCheckpoint, query: string): boolean {
  const q = query.toLowerCase()
  if (checkpoint.sessionId.toLowerCase().startsWith(q)) return true
  if (checkpoint.metaThreadId?.toLowerCase().includes(q)) return true
  if (resumeTokenFromMetaThreadId(checkpoint.metaThreadId ?? "").startsWith(q)) return true
  return resumeCheckpointFromCheckpoint(checkpoint).toLowerCase().startsWith(q)
}

export function normalizeCheckpoint(checkpoint: StackResumeCheckpoint): StackResumeCheckpoint {
  return {
    ...checkpoint,
    version: 1,
    schema: checkpoint.schema ?? CHECKPOINT_SCHEMA,
    savedAt: checkpoint.savedAt || new Date().toISOString(),
  }
}

function parseCheckpoint(raw: string): StackResumeCheckpoint | undefined {
  const parsed = JSON.parse(raw) as StackResumeCheckpoint
  if (parsed.version !== 1 || !parsed.sessionId) return undefined
  return normalizeCheckpoint(parsed)
}

export function writeResumeCheckpointSync(stackDataRoot: string, checkpoint: StackResumeCheckpoint): void {
  const normalized = normalizeCheckpoint(checkpoint)
  const payload = `${JSON.stringify(normalized, null, 2)}\n`
  const latest = resumeCheckpointPath(stackDataRoot)
  mkdirSync(checkpointsDir(stackDataRoot), { recursive: true })
  writeFileSync(latest, payload, "utf8")
  writeFileSync(legacyResumeCheckpointPath(stackDataRoot), payload, "utf8")
  mkdirSync(join(checkpointsDir(stackDataRoot), "threads", safeCheckpointSegment(normalized.sessionId)), {
    recursive: true,
  })
  writeFileSync(threadCheckpointPath(stackDataRoot, normalized.sessionId), payload, "utf8")
  if (normalized.metaThreadId) {
    mkdirSync(
      join(checkpointsDir(stackDataRoot), "meta-threads", safeCheckpointSegment(normalized.metaThreadId)),
      { recursive: true },
    )
    writeFileSync(metaThreadCheckpointPath(stackDataRoot, normalized.metaThreadId), payload, "utf8")
  }
}

async function writeCheckpointFiles(stackDataRoot: string, checkpoint: StackResumeCheckpoint): Promise<void> {
  const payload = `${JSON.stringify(checkpoint, null, 2)}\n`
  const latest = resumeCheckpointPath(stackDataRoot)
  await mkdir(checkpointsDir(stackDataRoot), { recursive: true })
  await writeFile(latest, payload, "utf8")
  await writeFile(legacyResumeCheckpointPath(stackDataRoot), payload, "utf8")
  await mkdir(join(checkpointsDir(stackDataRoot), "threads", safeCheckpointSegment(checkpoint.sessionId)), {
    recursive: true,
  })
  await writeFile(threadCheckpointPath(stackDataRoot, checkpoint.sessionId), payload, "utf8")
  if (checkpoint.metaThreadId) {
    await mkdir(
      join(checkpointsDir(stackDataRoot), "meta-threads", safeCheckpointSegment(checkpoint.metaThreadId)),
      { recursive: true },
    )
    await writeFile(metaThreadCheckpointPath(stackDataRoot, checkpoint.metaThreadId), payload, "utf8")
  }
}

export type { StackdResumeBundle, StackdSaveCheckpointResponse }
