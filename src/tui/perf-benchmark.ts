import type { StackConfig } from "../config.js"
import { harnessSessionCommand, hydrateCodexPricing } from "../config.js"
import { ensureStackCodexSkills } from "../codex/install-skills.js"
import { detectWorkspace } from "../local/workspace.js"
import { createSession } from "../session.js"
import { ensureStackDefaults } from "../seed/defaults.js"
import { assertNoStackProcessPileup } from "../startup-process-guard.js"
import {
  formatTuiPerfTable,
  type TuiPerfScenarioResult,
} from "./perf.js"
import {
  resolvePerfBenchSession,
  takeTuiPerfBenchResults,
  writeBenchReportIfConfigured,
} from "./perf-harness.js"

export async function runTuiPerfBenchmark(config: StackConfig, argv: string[]): Promise<number> {
  const json = argv.includes("--json")
  const strict = argv.includes("--strict")
  if (argv.includes("--micro")) {
    return runMicroTuiPerfBenchmark(argv, json, strict)
  }
  return runRealTuiPerfBenchmark(config, argv, json, strict)
}

async function runRealTuiPerfBenchmark(
  config: StackConfig,
  argv: string[],
  json: boolean,
  strict: boolean,
): Promise<number> {
  process.env.STACK_TUI_PERF = "1"
  process.env.STACK_TUI_PERF_BENCH = "1"
  process.env.STACK_TUI_SMOKE_NO_AUTOMATION = "1"
  assertNoStackProcessPileup(config.appRoot)

  const sessionIdFlag = argv.find((arg) => arg.startsWith("--session="))?.slice("--session=".length)
  ensureStackDefaults(config.stackDataRoot, config.appRoot)
  ensureStackCodexSkills(config.appRoot)
  await hydrateCodexPricing(config)
  const { ensureStackdAutostart } = await import("../stackd-autostart.js")
  await ensureStackdAutostart(config).catch(() => undefined)

  const workspace = await detectWorkspace(config.workingDir)
  const session =
    (await resolvePerfBenchSession(config, sessionIdFlag)) ??
    createSession(config.workspaceRoot, harnessSessionCommand(config))

  const { runStackApp } = await import("./app.js")
  await runStackApp({ config, workspace, session })

  const captured = takeTuiPerfBenchResults()
  if (!captured) {
    console.error("tui_perf_failed: real app benchmark did not produce results")
    return 1
  }

  const { rows, meta } = captured
  writeBenchReportIfConfigured(rows)

  if (json) {
    console.log(
      JSON.stringify(
        {
          mode: "real",
          ...meta,
          tty: Boolean(process.stdout.isTTY),
          scenarios: rows,
        },
        null,
        2,
      ),
    )
  } else {
    console.log("Stack TUI perf benchmark")
    console.log(
      `mode=real iterations=${meta.iterations} transcript_blocks=${meta.transcript_blocks} session=${meta.session_id} session_turns=${meta.session_turns} tty=${process.stdout.isTTY ? "yes" : "no"}`,
    )
    console.log("")
    console.log(formatTuiPerfTable(rows))
    console.log("")
    const failures = rows.filter((row) => row.ok === false)
    if (failures.length > 0 && strict) {
      console.error(`tui_perf_failed: ${failures.map((row) => row.scenario).join(", ")}`)
      return 1
    }
    if (failures.length > 0) {
      console.log(`note: ${failures.length} scenario(s) over budget (rerun with --strict to fail)`)
    }
    console.log("tui_perf_ok")
  }
  return 0
}

async function runMicroTuiPerfBenchmark(argv: string[], json: boolean, strict: boolean): Promise<number> {
  const { spawnSync } = await import("node:child_process")
  const { join } = await import("node:path")
  const script = join(process.cwd(), "scripts", "tui_perf_benchmark.ts")
  const args = ["run", script]
  if (json) args.push("--json")
  if (strict) args.push("--strict")
  for (const arg of argv) {
    if (arg.startsWith("--iterations=")) args.push(arg)
  }
  const result = spawnSync("bun", args, { stdio: "inherit", env: process.env })
  return result.status ?? 1
}
