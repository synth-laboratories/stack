import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export type StackCodexTurn = {
  id: string
  prompt: string
  selectedPaths: string[]
  startedAt: string
  finishedAt?: string
  exitCode?: number
  usage?: StackCodexUsage
  stdout: string
  stderr: string
}

export type StackCodexUsage = {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
}

export type StackLocalSession = {
  id: string
  workspaceRoot: string
  startedAt: string
  codexCommand: string
  turns: StackCodexTurn[]
}

export function createSession(workspaceRoot: string, codexCommand: string): StackLocalSession {
  return {
    id: randomUUID(),
    workspaceRoot,
    startedAt: new Date().toISOString(),
    codexCommand,
    turns: [],
  }
}

export async function writeSessionLog(session: StackLocalSession, sessionLogDir: string): Promise<string> {
  await mkdir(sessionLogDir, { recursive: true })
  const path = join(sessionLogDir, `${session.id}.json`)
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, "utf8")
  return path
}
