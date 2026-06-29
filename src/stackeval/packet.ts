import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type StackevalPacketPointer = {
  taskId: string
  packetDir: string
  stamp: string
  preset: string
  status: string
  updatedAt?: string
}

export function readActiveStackevalPacket(stackRoot: string): StackevalPacketPointer | undefined {
  const fromEnv = process.env.STACKEVAL_PACKET?.trim()
  if (fromEnv) {
    return pointerFromDir(fromEnv) ?? pointerFromLatestFile(fromEnv)
  }
  const latestPath = join(stackRoot, ".stack", "evidence", "stackeval", "latest.json")
  return pointerFromLatestFile(latestPath)
}

export function stackevalPacketStatusLine(pointer: StackevalPacketPointer | undefined): string | undefined {
  if (!pointer) return undefined
  return `stackeval ${pointer.taskId} ${pointer.preset} ${pointer.status} ${pointer.stamp}`
}

function pointerFromLatestFile(path: string): StackevalPacketPointer | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const taskId = readString(parsed.task_id)
    const packetDir = readString(parsed.packet_dir)
    const stamp = readString(parsed.stamp)
    const preset = readString(parsed.preset)
    const status = readString(parsed.status)
    if (!taskId || !packetDir || !stamp || !preset || !status) return undefined
    return {
      taskId,
      packetDir,
      stamp,
      preset,
      status,
      updatedAt: readString(parsed.updated_at),
    }
  } catch {
    return undefined
  }
}

function pointerFromDir(packetDir: string): StackevalPacketPointer | undefined {
  const metadataPath = join(packetDir, "metadata.json")
  if (!existsSync(metadataPath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>
    const taskId = readString(parsed.task_id)
    const preset = readString(parsed.preset)
    const status = readString(parsed.status) ?? "unknown"
    if (!taskId || !preset) return undefined
    const stamp = packetDir.split("/").at(-1) ?? packetDir
    return {
      taskId,
      packetDir,
      stamp,
      preset,
      status,
      updatedAt: readString(parsed.finished_at) ?? readString(parsed.created_at),
    }
  } catch {
    return undefined
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}
