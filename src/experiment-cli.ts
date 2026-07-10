import type { StackConfig } from "./config.js"
import {
  inspectExperimentBundle,
  loadExperimentBundle,
  renderExperimentBundleArtifact,
} from "./experiment-bundles.js"

type ParsedFlags = {
  args: string[]
  flags: Map<string, string | true>
}

export async function runExperimentCli(config: StackConfig, argv: string[]): Promise<number> {
  const [, action] = argv
  const parsed = parseFlags(argv.slice(2))
  const json = parsed.flags.has("json")
  if (!action || action === "help" || action === "--help" || action === "-h" || parsed.flags.has("help")) {
    printUsage()
    return action ? 0 : 2
  }

  try {
    if (action === "inspect") {
      const bundlePath = parsed.args[0]
      const source = bundleSource(parsed, bundlePath)
      const bundle = await loadExperimentBundle(config, source)
      const inspection = inspectExperimentBundle(bundle)
      if (json) console.log(JSON.stringify({ bundle, inspection }, null, 2))
      else printInspection(inspection)
      return inspection.ok ? 0 : 1
    }

    if (action === "render") {
      const bundlePath = parsed.args[0]
      const source = bundleSource(parsed, bundlePath)
      const result = await renderExperimentBundleArtifact(config, {
        ...source,
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

function bundleSource(parsed: ParsedFlags, bundlePath: string | undefined): {
  bundlePath?: string
  projectId?: string
  experimentId?: string
} {
  const projectId = flagString(parsed, "project-id")
  const experimentId = flagString(parsed, "experiment-id")
  if (bundlePath && (projectId || experimentId)) {
    throw new Error("provide a bundle path or --project-id plus --experiment-id, not both")
  }
  if (bundlePath) return { bundlePath }
  if (!projectId || !experimentId) {
    throw new Error("provide <bundle.json> or both --project-id and --experiment-id")
  }
  return { projectId, experimentId }
}

function printInspection(inspection: ReturnType<typeof inspectExperimentBundle>): void {
  console.log(`${inspection.status} · ${inspection.verdict} · ${inspection.experiment_id}`)
  console.log(`integrity: ${inspection.ok ? "pass" : "fail"} · publishable: ${inspection.publishable ? "yes" : "no"}`)
  console.log(`runs: ${inspection.run_ids.length} · executions: ${inspection.execution_count} · evaluations: ${inspection.evaluation_count} · traces: ${inspection.trace_count} · receipts: ${inspection.receipt_count}`)
  console.log(`bundle sha256: ${inspection.bundle_sha256}`)
  for (const warning of inspection.warnings) console.log(`warning: ${warning}`)
  for (const error of inspection.errors) console.log(`error: ${error}`)
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

function usageError(message: string): number {
  console.error(message)
  return 2
}

function printUsage(): void {
  console.error("Usage:")
  console.error("  stack experiment inspect <bundle.json> [--json]")
  console.error("  stack experiment inspect --project-id <id> --experiment-id <id> [--json]")
  console.error("  stack experiment render <bundle.json> [--slug <slug>] [--title <title>] [--effort <ref>] [--update] [--json]")
  console.error("  stack experiment render --project-id <id> --experiment-id <id> [--slug <slug>] [--update] [--json]")
  console.error("")
  console.error("Rendering creates or updates a normal Stack Artifact Site page. Publish it with stack artifacts publish/share.")
}
