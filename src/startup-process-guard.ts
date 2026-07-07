import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

type StackProcess = {
  pid: number
  ppid: number
  stat: string
  args: string
}

export function assertNoStackProcessPileup(appRoot: string): void {
  if (process.env.STACK_STARTUP_PROCESS_GUARD === "0") return

  const processes = listStackMainProcesses(appRoot).filter((entry) => entry.pid !== process.pid)
  const orphaned = processes.filter((entry) => entry.ppid === 1)
  const zombies = processes.filter((entry) => entry.stat.includes("Z"))
  const maxLive = readLimit("STACK_MAX_LIVE_INSTANCES", 3)
  const maxOrphaned = readLimit("STACK_MAX_ORPHANED_INSTANCES", 1)

  if (processes.length < maxLive && orphaned.length <= maxOrphaned && zombies.length === 0) return

  const samples = processes
    .slice(0, 8)
    .map((entry) => `  pid=${entry.pid} ppid=${entry.ppid} stat=${entry.stat} ${entry.args}`)
    .join("\n")
  const hint = "hint: stop stale Stack/Bun processes, or set STACK_STARTUP_PROCESS_GUARD=0 for an intentional parallel run"
  throw new Error(
    [
      `refusing to start Stack: found ${processes.length} existing Stack Bun process(es), ${orphaned.length} orphaned, ${zombies.length} zombie`,
      samples,
      hint,
    ]
      .filter(Boolean)
      .join("\n"),
  )
}

function listStackMainProcesses(appRoot: string): StackProcess[] {
  const stackMain = resolve(appRoot, "src", "main.ts")
  let output = ""
  try {
    output = execFileSync("ps", ["axo", "pid=,ppid=,stat=,args="], { encoding: "utf8" })
  } catch {
    return []
  }

  return output
    .split("\n")
    .map((line) => parseProcessLine(line))
    .filter((entry): entry is StackProcess => {
      if (!entry) return false
      if (!entry.args.includes("bun")) return false
      if (entry.args.includes(stackMain)) return true
      return entry.args.includes("src/main.ts") && entry.args.includes("/stack")
    })
}

function parseProcessLine(line: string): StackProcess | undefined {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
  if (!match) return undefined
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    stat: match[3],
    args: match[4],
  }
}

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
