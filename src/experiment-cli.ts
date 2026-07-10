import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { StackConfig } from "./config.js"
import {
  compareExperiments,
  readExperimentBundle,
  readExperimentHistory,
  readRemoteResearchSnapshot,
  type RemoteExperimentBundleSummary,
} from "./remote/research.js"

type ParsedArguments = {
  positional: string[]
  json: boolean
  output?: string
}

export async function runExperimentCli(config: StackConfig, argv: string[]): Promise<number> {
  const [noun, action] = argv
  const parsed = parseArguments(argv.slice(2))
  if (noun === "factory" && action === "inspect") {
    const factoryId = parsed.positional[0]
    if (!factoryId) return usageError("usage: stack factory inspect <factory-id> [--json]")
    const snapshot = await readRemoteResearchSnapshot(config)
    const factory = snapshot.factories.find((item) => item.factoryId === factoryId)
    if (!factory) return usageError(`factory not found: ${factoryId}`)
    if (parsed.json) console.log(JSON.stringify(factory, null, 2))
    else {
      console.log(`factory ${factory.name}`)
      console.log(`id ${factory.factoryId}`)
      console.log(`status ${factory.status ?? "-"} runtime ${factory.runtimeState ?? "-"}`)
      if (factory.latestExperiment) printExperiment(factory.latestExperiment)
      else console.log("experiment none")
    }
    return factory.latestExperiment?.acceptedCycle ? 0 : 1
  }

  if (noun === "experiment" && (action === "inspect" || action === "render")) {
    const [projectId, experimentId] = parsed.positional
    if (!projectId || !experimentId) {
      return usageError(
        `usage: stack experiment ${action} <project-id> <experiment-id>${action === "render" ? " --output <report.md>" : " [--json]"}`,
      )
    }
    const bundle = await readExperimentBundle(config, projectId, experimentId)
    if (action === "inspect") {
      if (parsed.json) console.log(JSON.stringify(bundle.raw, null, 2))
      else printExperiment(bundle)
      return bundle.acceptedCycle ? 0 : 1
    }
    const output = resolve(parsed.output ?? `experiment-${experimentId}.md`)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, renderExperiment(bundle), "utf8")
    if (parsed.json) console.log(JSON.stringify({ output, accepted_cycle: bundle.acceptedCycle }, null, 2))
    else console.log(output)
    return bundle.acceptedCycle ? 0 : 1
  }

  if (noun === "experiment" && action === "history") {
    const projectId = parsed.positional[0]
    if (!projectId) return usageError("usage: stack experiment history <project-id> [--json]")
    const history = await readExperimentHistory(config, projectId)
    if (parsed.json) console.log(JSON.stringify(history.raw, null, 2))
    else {
      console.log(`project ${history.projectId}`)
      console.log(`accepted ${history.acceptedCycles} incomplete ${history.incompleteCycles}`)
      for (const bundle of history.bundles) {
        console.log(
          `${bundle.experimentId} ${bundle.status ?? "-"} ${bundle.verdict ?? "-"} accepted=${bundle.acceptedCycle} missing=${bundle.missing.join(",") || "-"}`,
        )
      }
    }
    return history.missingEvidenceAlerts.length === 0 ? 0 : 1
  }

  if (noun === "experiment" && action === "compare") {
    const [projectId, ...experimentIds] = parsed.positional
    if (!projectId || experimentIds.length < 2) {
      return usageError("usage: stack experiment compare <project-id> <experiment-id> <experiment-id> [...] [--json]")
    }
    const comparison = await compareExperiments(config, projectId, experimentIds)
    if (parsed.json) console.log(JSON.stringify(comparison, null, 2))
    else {
      console.log(`project ${projectId} comparable=${comparison.comparable === true}`)
      const reasons = Array.isArray(comparison.not_comparable_reasons)
        ? comparison.not_comparable_reasons.map(String)
        : []
      if (reasons.length > 0) console.log(`reasons ${reasons.join(", ")}`)
      const rows = Array.isArray(comparison.rows) ? comparison.rows : []
      for (const row of rows) {
        const value = row && typeof row === "object" ? row as Record<string, unknown> : {}
        console.log(
          `${String(value.experiment_id ?? "-")} candidate=${String(value.candidate_id ?? "-")} value=${String(value.value ?? "-")} delta=${String(value.delta ?? "-")} verdict=${String(value.verdict ?? "-")}`,
        )
      }
    }
    return comparison.comparable === true ? 0 : 1
  }

  printUsage()
  return action ? 2 : 0
}

function printExperiment(bundle: RemoteExperimentBundleSummary): void {
  console.log(`experiment ${bundle.title ?? bundle.experimentId}`)
  console.log(`id ${bundle.experimentId} project ${bundle.projectId}`)
  console.log(`status ${bundle.status ?? "-"} verdict ${bundle.verdict ?? "-"}`)
  console.log(`integrity ${bundle.integrityState ?? "-"} accepted_cycle=${bundle.acceptedCycle}`)
  console.log(`candidate ${bundle.candidateId ?? "-"} model ${bundle.candidateModel ?? "-"}`)
  console.log(`prompt ${bundle.candidatePrompt ? "inline" : bundle.candidatePromptArtifact ?? "missing"}`)
  console.log(
    `eval ${bundle.metric ?? "-"} baseline=${formatNumber(bundle.baselineValue)} candidate=${formatNumber(bundle.candidateValue)} delta=${formatNumber(bundle.delta)} seeds=${bundle.seedCount}`,
  )
  console.log(`scorer ${bundle.scorerId ?? "-"} traces ${bundle.traceCount}`)
  console.log(`cost ${bundle.costCents ?? 0}c tokens ${bundle.tokens ?? 0}`)
  if (bundle.missing.length > 0) console.log(`missing ${bundle.missing.join(", ")}`)
}

function renderExperiment(bundle: RemoteExperimentBundleSummary): string {
  return [
    `# ${bundle.title ?? `Experiment ${bundle.experimentId}`}`,
    "",
    `- Experiment: \`${bundle.experimentId}\``,
    `- Project: \`${bundle.projectId}\``,
    `- Runs: ${bundle.runIds.map((item) => `\`${item}\``).join(", ") || "-"}`,
    `- Status: ${bundle.status ?? "-"}`,
    `- Verdict: ${bundle.verdict ?? "-"}`,
    `- Integrity: ${bundle.integrityState ?? "-"}`,
    `- Accepted cycle: ${bundle.acceptedCycle}`,
    "",
    "## Hypothesis",
    "",
    bundle.hypothesis ?? "-",
    "",
    "## Candidate",
    "",
    `- ID: ${bundle.candidateId ?? "-"}`,
    `- Model: ${bundle.candidateModel ?? "-"}`,
    `- Prompt: ${bundle.candidatePrompt ? "included below" : bundle.candidatePromptArtifact ?? "missing"}`,
    "",
    ...(bundle.candidatePrompt ? ["```text", bundle.candidatePrompt, "```", ""] : []),
    "## Evaluation",
    "",
    `- Metric: ${bundle.metric ?? "-"}`,
    `- Baseline: ${formatNumber(bundle.baselineValue)}`,
    `- Candidate: ${formatNumber(bundle.candidateValue)}`,
    `- Delta: ${formatNumber(bundle.delta)}`,
    `- Sample size: ${bundle.sampleSize ?? "-"}`,
    `- Seeds: ${bundle.seedCount}`,
    `- Scorer: ${bundle.scorerId ?? "-"}`,
    `- Trace records: ${bundle.traceCount}`,
    `- Cost: ${bundle.costCents ?? 0} cents`,
    `- Tokens: ${bundle.tokens ?? 0}`,
    "",
    "## Missing evidence",
    "",
    bundle.missing.length > 0 ? bundle.missing.map((item) => `- ${item}`).join("\n") : "None.",
    "",
  ].join("\n")
}

function parseArguments(values: string[]): ParsedArguments {
  const parsed: ParsedArguments = { positional: [], json: false }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--json") parsed.json = true
    else if (value === "--output") parsed.output = values[++index]
    else parsed.positional.push(value)
  }
  return parsed
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "-" : String(value)
}

function usageError(message: string): number {
  console.error(message)
  return 2
}

function printUsage(): void {
  console.log("  stack factory inspect <factory-id> [--json]")
  console.log("  stack experiment inspect <project-id> <experiment-id> [--json]")
  console.log("  stack experiment history <project-id> [--json]")
  console.log("  stack experiment compare <project-id> <experiment-id> <experiment-id> [...] [--json]")
  console.log("  stack experiment render <project-id> <experiment-id> [--output <report.md>] [--json]")
}
