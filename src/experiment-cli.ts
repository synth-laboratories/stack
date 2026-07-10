import type { StackConfig } from "./config.js"
import {
  inspectExperimentBundle,
  loadExperimentBundle,
  renderExperimentBundleArtifact,
} from "./experiment-bundles.js"
import { readRemoteResearchSnapshot, type RemoteExperimentBundleSummary } from "./remote/research.js"

type ParsedFlags = {
  args: string[]
  flags: Map<string, string | true>
}

export async function runExperimentCli(config: StackConfig, argv: string[]): Promise<number> {
  const [noun, action] = argv
  const parsed = parseFlags(argv.slice(2))
  const json = parsed.flags.has("json")
  if (!action || action === "help" || action === "--help" || action === "-h" || parsed.flags.has("help")) {
    printUsage()
    return action ? 0 : 2
  }

  try {
    if (noun === "factory" && action === "inspect") {
      return await inspectFactory(config, parsed, json)
    }
    if (noun !== "experiment") return usageError(`unknown command: ${noun} ${action}`)

    if (action === "inspect") {
      const bundle = await loadExperimentBundle(config, bundleSource(parsed))
      const inspection = inspectExperimentBundle(bundle)
      if (json) console.log(JSON.stringify({ bundle, inspection }, null, 2))
      else printInspection(inspection)
      return inspection.ok ? 0 : 1
    }

    if (action === "render") {
      const result = await renderExperimentBundleArtifact(config, {
        ...bundleSource(parsed),
        slug: flagString(parsed, "slug"),
        title: flagString(parsed, "title"),
        effort: flagString(parsed, "effort"),
        update: parsed.flags.has("update"),
      })
      if (json) {
        console.log(JSON.stringify({
          ok: result.artifact.served.ok,
          inspection: result.inspection,
          artifact: result.artifact.artifact,
          local_url: result.artifact.localUrl,
          page_path: result.artifact.pagePath,
          data_path: result.artifact.dataPath,
          served: result.artifact.served,
        }, null, 2))
      } else {
        printInspection(result.inspection)
        console.log(`${result.artifact.artifact.slug} -> ${result.artifact.localUrl}`)
        if (!result.artifact.served.ok) console.log(`serve warning: ${result.artifact.served.message}`)
      }
      return result.artifact.served.ok ? 0 : 1
    }

    return usageError(`unknown stack experiment command: ${action}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2))
    else console.error(message)
    return 1
  }
}

async function inspectFactory(config: StackConfig, parsed: ParsedFlags, json: boolean): Promise<number> {
  const factoryId = parsed.args[0]
  if (!factoryId) return usageError("usage: stack factory inspect <factory-id> [--json]")
  const snapshot = await readRemoteResearchSnapshot(config)
  const factory = snapshot.factories.find((item) => item.factoryId === factoryId)
  if (!factory) return usageError(`factory not found: ${factoryId}`)
  if (json) {
    console.log(JSON.stringify(factory, null, 2))
  } else {
    console.log(`factory ${factory.name}`)
    console.log(`id ${factory.factoryId}`)
    console.log(`status ${factory.status ?? "not reported"} runtime ${factory.runtimeState ?? "not reported"}`)
    if (factory.latestExperiment) printRemoteExperiment(factory.latestExperiment)
    else console.log("experiment none")
  }
  return factory.latestExperiment?.acceptedCycle ? 0 : 1
}

function bundleSource(parsed: ParsedFlags): {
  bundlePath?: string
  projectId?: string
  experimentId?: string
} {
  if (parsed.args.length > 2) {
    throw new Error("experiment commands accept at most two positional arguments")
  }
  const projectIdFlag = flagString(parsed, "project-id")
  const experimentIdFlag = flagString(parsed, "experiment-id")
  if (parsed.args.length === 2 && !projectIdFlag && !experimentIdFlag) {
    return { projectId: parsed.args[0], experimentId: parsed.args[1] }
  }
  const bundlePath = parsed.args[0]
  if (bundlePath && (projectIdFlag || experimentIdFlag)) {
    throw new Error("provide a bundle path or project id plus experiment id, not both")
  }
  if (bundlePath) return { bundlePath }
  if (!projectIdFlag || !experimentIdFlag) {
    throw new Error("provide <bundle.json>, <project-id> <experiment-id>, or both --project-id and --experiment-id")
  }
  return { projectId: projectIdFlag, experimentId: experimentIdFlag }
}

function printInspection(inspection: ReturnType<typeof inspectExperimentBundle>): void {
  console.log(`${inspection.status} · ${inspection.verdict} · ${inspection.experiment_id}`)
  console.log(`integrity: ${inspection.ok ? "pass" : "fail"} · publishable: ${inspection.publishable ? "yes" : "no"}`)
  console.log(`runs: ${inspection.run_ids.length} · executions: ${inspection.execution_count} · evaluations: ${inspection.evaluation_count} · traces: ${inspection.trace_count} · receipts: ${inspection.receipt_count}`)
  console.log(`bundle sha256: ${inspection.bundle_sha256}`)
  for (const warning of inspection.warnings) console.log(`warning: ${warning}`)
  for (const error of inspection.errors) console.log(`error: ${error}`)
}

function printRemoteExperiment(bundle: RemoteExperimentBundleSummary): void {
  console.log(`experiment ${bundle.title ?? bundle.experimentId}`)
  console.log(`id ${bundle.experimentId} project ${bundle.projectId}`)
  console.log(`status ${bundle.status ?? "not reported"} verdict ${bundle.verdict ?? "not reported"}`)
  console.log(`integrity ${bundle.integrityState ?? "not reported"} accepted_cycle=${bundle.acceptedCycle}`)
  console.log(`candidate ${bundle.candidateId ?? "not reported"} model ${bundle.candidateModel ?? "not reported"}`)
  console.log(`eval ${bundle.metric ?? "not reported"} baseline=${formatNumber(bundle.baselineValue)} candidate=${formatNumber(bundle.candidateValue)} delta=${formatNumber(bundle.delta)} seeds=${bundle.seedCount}`)
}

function parseFlags(argv: string[]): ParsedFlags {
  const args: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) {
      args.push(token)
      continue
    }
    const raw = token.slice(2)
    const separator = raw.indexOf("=")
    if (separator >= 0) {
      flags.set(raw.slice(0, separator), raw.slice(separator + 1))
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      flags.set(raw, next)
      index += 1
    } else {
      flags.set(raw, true)
    }
  }
  return { args, flags }
}

function flagString(parsed: ParsedFlags, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "not reported" : String(value)
}

function usageError(message: string): number {
  console.error(message)
  return 2
}

function printUsage(): void {
  console.error("Usage:")
  console.error("  stack factory inspect <factory-id> [--json]")
  console.error("  stack experiment inspect <bundle.json> [--json]")
  console.error("  stack experiment inspect <project-id> <experiment-id> [--json]")
  console.error("  stack experiment inspect --project-id <id> --experiment-id <id> [--json]")
  console.error("  stack experiment render <bundle.json> [--slug <slug>] [--title <title>] [--effort <ref>] [--update] [--json]")
  console.error("  stack experiment render <project-id> <experiment-id> [--slug <slug>] [--update] [--json]")
  console.error("")
  console.error("Rendering creates or updates a normal Stack Artifact Site page. Publish it with stack artifacts publish/share.")
}
