import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import type { StackConfig } from "./config.js"
import { readLatestArtifacts, writeArtifactPage, type StackArtifactWriteResult } from "./artifacts.js"
import { fetchRemoteExperimentBundle } from "./remote/research.js"

export const EXPERIMENT_BUNDLE_SCHEMA = "smr_experiment_bundle.v1" as const
export const EXPERIMENT_INTEGRITY_SCHEMA = "smr_experiment_bundle_integrity.v1" as const
export const EXPERIMENT_INTEGRITY_STATES = ["collecting", "complete", "incomplete"] as const

export type ExperimentIntegrityState = (typeof EXPERIMENT_INTEGRITY_STATES)[number]

export type ExperimentExecution = Record<string, unknown> & {
  container_run_id: string
  run_id?: string
  container_digest?: string
  scorer_id?: string
  scorer_version?: string
  task_ids: string[]
  status: string
}

export type ExperimentEvaluation = Record<string, unknown> & {
  result_id: string
  run_id?: string
  candidate_id?: string
  metric: string
  metric_direction: string
  value: number
  baseline_value?: number
  delta?: number
  sample_size?: number
  seed_set: Array<string | number>
  split_name?: string
  scorer_id?: string
  scorer_version?: string
  per_example_artifact_id?: string
  cost_cents?: number
  tokens?: number
  wall_time_seconds?: number
  evidence_grade?: string
  truth_status: string
}

export type StackExperimentBundle = {
  schema_version: typeof EXPERIMENT_BUNDLE_SCHEMA
  experiment_id: string
  project_id: string
  factory_id?: string
  effort_id?: string
  run_ids: string[]
  experiment: Record<string, unknown> & {
    title: string
    status: string
    hypothesis: string
    intervention?: string
    comparison?: string
    verdict?: string
    summary?: string
    next_recommended_action?: string
  }
  candidate: Record<string, unknown> & {
    candidate_id?: string
    label?: string
    model?: string
    prompt?: string
    prompt_artifact?: string
    config: Record<string, unknown>
    config_digest?: string
  }
  executions: ExperimentExecution[]
  evaluations: ExperimentEvaluation[]
  trace_index: Array<Record<string, unknown>>
  economics: Record<string, unknown> & {
    cost_cents: number
    tokens: number
    wall_time_seconds: number
  }
  decisions: Record<string, unknown> & {
    verdict?: string
    summary?: unknown
    next_recommended_action?: string
  }
  provenance: Record<string, unknown>
  artifact_index: Array<Record<string, unknown>>
  workspace_layout: Record<string, string>
  integrity: {
    schema_version: typeof EXPERIMENT_INTEGRITY_SCHEMA
    state: ExperimentIntegrityState
    accepted_cycle: boolean
    terminal: boolean
    missing: string[]
    warnings: string[]
  }
  created_at: string
  updated_at: string
}

export type ExperimentBundleInspection = {
  ok: boolean
  terminal: boolean
  publishable: boolean
  errors: string[]
  warnings: string[]
  bundle_sha256: string
  experiment_id: string
  title: string
  status: string
  verdict: string
  integrity_state: ExperimentIntegrityState
  run_ids: string[]
  execution_count: number
  evaluation_count: number
  trace_count: number
  receipt_count: number
  metric_names: string[]
}

export type ExperimentBundleSource = {
  bundlePath?: string
  projectId?: string
  experimentId?: string
}

export type ExperimentArtifactRenderRequest = ExperimentBundleSource & {
  slug?: string
  title?: string
  effort?: string
  update?: boolean
}

export type ExperimentArtifactRenderResult = {
  bundle: StackExperimentBundle
  inspection: ExperimentBundleInspection
  artifact: StackArtifactWriteResult
}

export function readExperimentBundle(config: StackConfig, bundlePath: string): StackExperimentBundle {
  const resolvedPath = isAbsolute(bundlePath) ? bundlePath : resolve(config.workingDir, bundlePath)
  const text = readFileSync(resolvedPath, "utf8")
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`experiment bundle is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseExperimentBundle(raw)
}

export async function loadExperimentBundle(
  config: StackConfig,
  source: ExperimentBundleSource,
): Promise<StackExperimentBundle> {
  if (source.bundlePath && (source.projectId || source.experimentId)) {
    throw new Error("provide bundlePath or projectId+experimentId, not both")
  }
  if (source.bundlePath) return readExperimentBundle(config, source.bundlePath)
  if (!source.projectId || !source.experimentId) {
    throw new Error("provide bundlePath or both projectId and experimentId")
  }
  return parseExperimentBundle(await fetchRemoteExperimentBundle(config, source.projectId, source.experimentId))
}

export function inspectExperimentBundle(bundle: StackExperimentBundle): ExperimentBundleInspection {
  const errors: string[] = []
  const warnings = [...bundle.integrity.warnings]
  const terminal = bundle.integrity.terminal
  const missing = independentlyMissingEvidence(bundle)
  const ownerMissing = [...bundle.integrity.missing].sort()
  const independentMissing = [...missing].sort()
  const expectedState: ExperimentIntegrityState = missing.length === 0
    ? "complete"
    : terminal ? "incomplete" : "collecting"
  const expectedAcceptedCycle = terminal && missing.length === 0

  if (JSON.stringify(ownerMissing) !== JSON.stringify(independentMissing)) {
    errors.push("owner integrity.missing does not match the bundle evidence")
  }
  if (bundle.integrity.state !== expectedState) {
    errors.push(`owner integrity.state is ${bundle.integrity.state}; expected ${expectedState}`)
  }
  if (bundle.integrity.accepted_cycle !== expectedAcceptedCycle) {
    errors.push(`owner integrity.accepted_cycle is ${bundle.integrity.accepted_cycle}; expected ${expectedAcceptedCycle}`)
  }
  if (terminal && !bundle.integrity.accepted_cycle) {
    errors.push(`terminal experiment is not observable: ${missing.join(", ") || "accepted_cycle is false"}`)
  }
  if (!terminal && bundle.integrity.state === "collecting") {
    warnings.push(...missing.map((field) => `collecting: ${field}`))
  }

  const receiptCount = ["experiment_registration", "synth_wiki", "git_server", "budget"]
    .filter((key) => present(bundle.provenance[key])).length
  return {
    ok: errors.length === 0,
    terminal,
    publishable: errors.length === 0 && bundle.integrity.accepted_cycle && bundle.integrity.state === "complete",
    errors,
    warnings: [...new Set(warnings)],
    bundle_sha256: bundleDigest(bundle),
    experiment_id: bundle.experiment_id,
    title: bundle.experiment.title,
    status: bundle.experiment.status,
    verdict: text(bundle.decisions.verdict) ?? text(bundle.experiment.verdict) ?? "pending",
    integrity_state: bundle.integrity.state,
    run_ids: bundle.run_ids,
    execution_count: bundle.executions.length,
    evaluation_count: bundle.evaluations.length,
    trace_count: bundle.trace_index.length,
    receipt_count: receiptCount,
    metric_names: [...new Set(bundle.evaluations.map((item) => item.metric))].sort(),
  }
}

export async function renderExperimentBundleArtifact(
  config: StackConfig,
  request: ExperimentArtifactRenderRequest,
): Promise<ExperimentArtifactRenderResult> {
  const bundle = await loadExperimentBundle(config, request)
  const inspection = inspectExperimentBundle(bundle)
  if (!inspection.ok) {
    throw new Error(`experiment bundle failed integrity checks: ${inspection.errors.join("; ")}`)
  }
  const slug = normalizeSlug(request.slug ?? bundle.experiment_id)
  const existing = readLatestArtifacts(config).some((artifact) => artifact.slug === slug)
  if (existing && !request.update) {
    throw new Error(`artifact ${slug} already exists; rerun with update=true to preserve its identity`)
  }
  if (!existing && request.update) {
    throw new Error(`artifact ${slug} does not exist; omit update=true for the first render`)
  }
  const artifact = await writeArtifactPage(config, {
    slug,
    title: request.title ?? bundle.experiment.title,
    kind: "result",
    effort: request.effort ?? bundle.effort_id,
    htmlContent: experimentBundleHtml(bundle, inspection),
    data: bundle,
    update: request.update,
  })
  return { bundle, inspection, artifact }
}

export function parseExperimentBundle(raw: unknown): StackExperimentBundle {
  const value = record(raw, "experiment bundle")
  const schemaVersion = requiredText(value.schema_version, "schema_version")
  if (schemaVersion !== EXPERIMENT_BUNDLE_SCHEMA) throw new Error(`schema_version must be ${EXPERIMENT_BUNDLE_SCHEMA}`)
  const experiment = record(value.experiment, "experiment")
  const candidate = record(value.candidate, "candidate")
  const economics = record(value.economics, "economics")
  const decisions = record(value.decisions, "decisions")
  const integrity = record(value.integrity, "integrity")
  const integritySchema = requiredText(integrity.schema_version, "integrity.schema_version")
  if (integritySchema !== EXPERIMENT_INTEGRITY_SCHEMA) throw new Error(`integrity.schema_version must be ${EXPERIMENT_INTEGRITY_SCHEMA}`)
  return {
    schema_version: EXPERIMENT_BUNDLE_SCHEMA,
    experiment_id: requiredText(value.experiment_id, "experiment_id"),
    project_id: requiredText(value.project_id, "project_id"),
    factory_id: optionalText(value.factory_id, "factory_id"),
    effort_id: optionalText(value.effort_id, "effort_id"),
    run_ids: textArray(value.run_ids, "run_ids"),
    experiment: {
      ...experiment,
      title: requiredText(experiment.title, "experiment.title"),
      status: requiredText(experiment.status, "experiment.status"),
      hypothesis: requiredText(experiment.hypothesis, "experiment.hypothesis"),
      intervention: optionalText(experiment.intervention, "experiment.intervention"),
      comparison: optionalText(experiment.comparison, "experiment.comparison"),
      verdict: optionalText(experiment.verdict, "experiment.verdict"),
      summary: optionalText(experiment.summary, "experiment.summary"),
      next_recommended_action: optionalText(experiment.next_recommended_action, "experiment.next_recommended_action"),
    },
    candidate: {
      ...candidate,
      candidate_id: optionalText(candidate.candidate_id, "candidate.candidate_id"),
      label: optionalText(candidate.label, "candidate.label"),
      model: optionalText(candidate.model, "candidate.model"),
      prompt: optionalText(candidate.prompt, "candidate.prompt"),
      prompt_artifact: optionalText(candidate.prompt_artifact, "candidate.prompt_artifact"),
      config: record(candidate.config, "candidate.config"),
      config_digest: optionalText(candidate.config_digest, "candidate.config_digest"),
    },
    executions: list(value.executions, "executions").map(parseExecution),
    evaluations: list(value.evaluations, "evaluations").map(parseEvaluation),
    trace_index: list(value.trace_index, "trace_index").map((item, index) => record(item, `trace_index[${index}]`)),
    economics: {
      ...economics,
      cost_cents: nonNegativeNumber(economics.cost_cents, "economics.cost_cents"),
      tokens: nonNegativeNumber(economics.tokens, "economics.tokens"),
      wall_time_seconds: nonNegativeNumber(economics.wall_time_seconds, "economics.wall_time_seconds"),
    },
    decisions: {
      ...decisions,
      verdict: optionalText(decisions.verdict, "decisions.verdict"),
      summary: decisions.summary,
      next_recommended_action: optionalText(decisions.next_recommended_action, "decisions.next_recommended_action"),
    },
    provenance: record(value.provenance, "provenance"),
    artifact_index: list(value.artifact_index, "artifact_index").map((item, index) => record(item, `artifact_index[${index}]`)),
    workspace_layout: stringRecord(value.workspace_layout, "workspace_layout"),
    integrity: {
      schema_version: EXPERIMENT_INTEGRITY_SCHEMA,
      state: enumText(integrity.state, EXPERIMENT_INTEGRITY_STATES, "integrity.state"),
      accepted_cycle: boolean(integrity.accepted_cycle, "integrity.accepted_cycle"),
      terminal: boolean(integrity.terminal, "integrity.terminal"),
      missing: textArray(integrity.missing, "integrity.missing"),
      warnings: textArray(integrity.warnings, "integrity.warnings"),
    },
    created_at: timestamp(value.created_at, "created_at"),
    updated_at: timestamp(value.updated_at, "updated_at"),
  }
}

function parseExecution(raw: unknown, index: number): ExperimentExecution {
  const path = `executions[${index}]`
  const value = record(raw, path)
  return {
    ...value,
    container_run_id: requiredText(value.container_run_id, `${path}.container_run_id`),
    run_id: optionalText(value.run_id, `${path}.run_id`),
    container_digest: optionalText(value.container_digest, `${path}.container_digest`),
    scorer_id: optionalText(value.scorer_id, `${path}.scorer_id`),
    scorer_version: optionalText(value.scorer_version, `${path}.scorer_version`),
    task_ids: textArray(value.task_ids, `${path}.task_ids`),
    status: requiredText(value.status, `${path}.status`),
  }
}

function parseEvaluation(raw: unknown, index: number): ExperimentEvaluation {
  const path = `evaluations[${index}]`
  const value = record(raw, path)
  return {
    ...value,
    result_id: requiredText(value.result_id, `${path}.result_id`),
    run_id: optionalText(value.run_id, `${path}.run_id`),
    candidate_id: optionalText(value.candidate_id, `${path}.candidate_id`),
    metric: requiredText(value.metric, `${path}.metric`),
    metric_direction: requiredText(value.metric_direction, `${path}.metric_direction`),
    value: finiteNumber(value.value, `${path}.value`),
    baseline_value: optionalNumber(value.baseline_value, `${path}.baseline_value`),
    delta: optionalNumber(value.delta, `${path}.delta`),
    sample_size: optionalNonNegativeNumber(value.sample_size, `${path}.sample_size`),
    seed_set: scalarArray(value.seed_set, `${path}.seed_set`),
    split_name: optionalText(value.split_name, `${path}.split_name`),
    scorer_id: optionalText(value.scorer_id, `${path}.scorer_id`),
    scorer_version: optionalText(value.scorer_version, `${path}.scorer_version`),
    per_example_artifact_id: optionalText(value.per_example_artifact_id, `${path}.per_example_artifact_id`),
    cost_cents: optionalNonNegativeNumber(value.cost_cents, `${path}.cost_cents`),
    tokens: optionalNonNegativeNumber(value.tokens, `${path}.tokens`),
    wall_time_seconds: optionalNonNegativeNumber(value.wall_time_seconds, `${path}.wall_time_seconds`),
    evidence_grade: optionalText(value.evidence_grade, `${path}.evidence_grade`),
    truth_status: requiredText(value.truth_status, `${path}.truth_status`),
  }
}

function independentlyMissingEvidence(bundle: StackExperimentBundle): string[] {
  const execution = bundle.executions[0] ?? {}
  const evaluation = bundle.evaluations[0] ?? {}
  const required: Record<string, unknown> = {
    "experiment.hypothesis": bundle.experiment.hypothesis,
    "experiment.intervention": bundle.experiment.intervention,
    "experiment.comparison": bundle.experiment.comparison,
    "candidate.candidate_id": bundle.candidate.candidate_id,
    "candidate.model": bundle.candidate.model,
    "candidate.prompt_or_artifact": bundle.candidate.prompt ?? bundle.candidate.prompt_artifact,
    "candidate.config_digest": bundle.candidate.config_digest,
    "execution.container_digest": execution.container_digest,
    "execution.scorer": execution.scorer_id,
    "execution.task_ids": execution.task_ids,
    "evaluation.result": evaluation.result_id,
    "evaluation.baseline_value": evaluation.baseline_value,
    "evaluation.value": evaluation.value,
    "evaluation.seed_set": evaluation.seed_set,
    "evaluation.scorer": evaluation.scorer_id,
    "evaluation.per_example_artifact": evaluation.per_example_artifact_id,
    "evaluation.cost": evaluation.cost_cents,
    "trace_index": bundle.trace_index,
    "decision.verdict": bundle.experiment.verdict,
    "provenance.experiment_registration": bundle.provenance.experiment_registration,
    "provenance.synth_wiki": bundle.provenance.synth_wiki,
    "provenance.git_server": bundle.provenance.git_server,
    "provenance.budget": bundle.provenance.budget,
  }
  return Object.entries(required).filter(([, value]) => !present(value)).map(([key]) => key)
}

function experimentBundleHtml(bundle: StackExperimentBundle, inspection: ExperimentBundleInspection): string {
  const status = inspection.status
  const verdict = inspection.verdict
  const prompt = bundle.candidate.prompt ?? bundle.candidate.prompt_artifact ?? "Not materialized"
  const evaluationRows = bundle.evaluations.map((item) => `<tr><td>${escapeHtml(item.metric)}</td><td>${formatNumber(item.baseline_value)}</td><td>${formatNumber(item.value)}</td><td>${formatSigned(item.delta)}</td><td>${escapeHtml(item.split_name ?? "unlabeled")}</td><td>${item.sample_size ?? item.seed_set.length}</td><td>${escapeHtml(item.scorer_id ?? "-")}</td></tr>`).join("")
  const executionRows = bundle.executions.map((item) => `<tr><td><code>${escapeHtml(item.container_run_id)}</code></td><td>${escapeHtml(item.status)}</td><td><code>${escapeHtml(item.container_digest ?? "-")}</code></td><td>${escapeHtml(item.scorer_id ?? "-")}</td><td>${item.task_ids.length}</td></tr>`).join("")
  const traceRows = bundle.trace_index.map((item) => `<li>${renderEvidenceValue(item)}</li>`).join("")
  const artifactRows = bundle.artifact_index.map((item) => `<li>${renderEvidenceValue(item)}</li>`).join("")
  const provenanceRows = Object.entries(bundle.provenance).map(([key, value]) => `<li><strong>${escapeHtml(key)}</strong> ${renderEvidenceValue(value)}</li>`).join("")
  const identityRows = [
    ["Experiment", bundle.experiment_id], ["Factory", bundle.factory_id], ["Project", bundle.project_id],
    ["Effort", bundle.effort_id], ["Runs", bundle.run_ids.join(", ")],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd><code>${escapeHtml(value)}</code></dd>`).join("")
  return `<main class="experiment-bundle" data-artifact-receipt="${inspection.bundle_sha256}">
  <style>.experiment-bundle{display:grid;gap:18px}.experiment-hero,.experiment-panel{border:1px solid var(--artifact-border);border-radius:14px;padding:18px;background:var(--artifact-panel)}.experiment-eyebrow{color:var(--artifact-accent);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.experiment-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.experiment-status{display:inline-flex;border:1px solid var(--artifact-border);border-radius:999px;padding:3px 9px;margin-right:8px}.experiment-bundle dl{display:grid;grid-template-columns:max-content 1fr;gap:7px 12px}.experiment-bundle dd{margin:0;overflow-wrap:anywhere}.experiment-bundle pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--artifact-border);border-radius:10px;padding:12px}.experiment-bundle table{border-collapse:collapse;width:100%}.experiment-bundle th,.experiment-bundle td{border-bottom:1px solid var(--artifact-border);padding:9px;text-align:left}.experiment-bundle li{overflow-wrap:anywhere}</style>
  <header class="experiment-hero"><div class="experiment-eyebrow">SMR experiment artifact</div><h1>${escapeHtml(bundle.experiment.title)}</h1><p><span class="experiment-status">${escapeHtml(status)}</span><span class="experiment-status">${escapeHtml(verdict)}</span><span class="experiment-status">integrity ${escapeHtml(inspection.integrity_state)}</span></p><p>${escapeHtml(text(bundle.experiment.summary) ?? text(bundle.decisions.summary) ?? bundle.experiment.hypothesis)}</p></header>
  <section class="experiment-grid"><article class="experiment-panel"><h2>Hypothesis</h2><p>${escapeHtml(bundle.experiment.hypothesis)}</p></article><article class="experiment-panel"><h2>Intervention</h2><p>${escapeHtml(bundle.experiment.intervention ?? "-")}</p></article><article class="experiment-panel"><h2>Comparison</h2><p>${escapeHtml(bundle.experiment.comparison ?? "-")}</p></article></section>
  <section class="experiment-panel"><h2>Identity</h2><dl>${identityRows}</dl></section>
  <section class="experiment-panel"><h2>Candidate</h2><p><strong>${escapeHtml(bundle.candidate.label ?? bundle.candidate.candidate_id ?? "candidate")}</strong> · ${escapeHtml(bundle.candidate.model ?? "model pending")}</p><p>config digest <code>${escapeHtml(bundle.candidate.config_digest ?? "pending")}</code></p><h3>Exact prompt or prompt artifact</h3><pre>${escapeHtml(prompt)}</pre><h3>Configuration</h3><pre>${escapeHtml(JSON.stringify(bundle.candidate.config, null, 2))}</pre></section>
  <section class="experiment-panel"><h2>Executions</h2><div style="overflow-x:auto"><table><thead><tr><th>Container run</th><th>Status</th><th>Image digest</th><th>Scorer</th><th>Tasks</th></tr></thead><tbody>${executionRows}</tbody></table></div></section>
  <section class="experiment-panel"><h2>Evaluations</h2><div style="overflow-x:auto"><table><thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Delta</th><th>Split</th><th>N</th><th>Scorer</th></tr></thead><tbody>${evaluationRows}</tbody></table></div></section>
  <section class="experiment-grid"><article class="experiment-panel"><h2>Economics</h2><p><strong>$${(bundle.economics.cost_cents / 100).toFixed(2)}</strong></p><p>${bundle.economics.tokens} tokens · ${formatNumber(bundle.economics.wall_time_seconds)} seconds</p></article><article class="experiment-panel"><h2>Decision</h2><p><strong>${escapeHtml(verdict)}</strong></p><pre>${escapeHtml(JSON.stringify(bundle.decisions.summary ?? {}, null, 2))}</pre><p><strong>Next:</strong> ${escapeHtml(bundle.decisions.next_recommended_action ?? bundle.experiment.next_recommended_action ?? "-")}</p></article></section>
  <section class="experiment-grid"><article class="experiment-panel"><h2>Trace index</h2><ul>${traceRows}</ul></article><article class="experiment-panel"><h2>Artifact index</h2><ul>${artifactRows || "<li>No linked artifacts</li>"}</ul></article></section>
  <section class="experiment-panel"><h2>Provenance receipts</h2><ul>${provenanceRows}</ul></section>
  <footer class="experiment-panel"><strong>Bundle receipt</strong><p>sha256 <code>${inspection.bundle_sha256}</code></p><p>schema <code>${EXPERIMENT_BUNDLE_SCHEMA}</code> · updated ${escapeHtml(bundle.updated_at)}</p></footer>
  </main>`
}

function renderEvidenceValue(value: unknown): string {
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>` : `<code>${escapeHtml(value)}</code>`
  }
  return `<code>${escapeHtml(JSON.stringify(value))}</code>`
}

function bundleDigest(bundle: StackExperimentBundle): string {
  return createHash("sha256").update(JSON.stringify(sortJson(bundle))).digest("hex")
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortJson(entry)]))
}

function present(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.keys(value as object).length > 0
  return true
}

function normalizeSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (!slug) throw new Error("experiment artifact slug is required")
  return slug.slice(0, 120)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function requiredText(value: unknown, path: string): string {
  const parsed = text(value)
  if (!parsed) throw new Error(`${path} must be a non-empty string`)
  return parsed
}

function text(value: unknown): string | undefined {
  const parsed = typeof value === "string" ? value.trim() : ""
  return parsed || undefined
}

function optionalText(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requiredText(value, path)
}

function textArray(value: unknown, path: string): string[] {
  return list(value, path).map((item, index) => requiredText(item, `${path}[${index}]`))
}

function scalarArray(value: unknown, path: string): Array<string | number> {
  return list(value, path).map((item, index) => {
    if (typeof item === "number" && Number.isFinite(item)) return item
    return requiredText(item, `${path}[${index}]`)
  })
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

function nonNegativeNumber(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path)
  if (parsed < 0) throw new Error(`${path} must be non-negative`)
  return parsed
}

function optionalNumber(value: unknown, path: string): number | undefined {
  return value === undefined || value === null ? undefined : finiteNumber(value, path)
}

function optionalNonNegativeNumber(value: unknown, path: string): number | undefined {
  return value === undefined || value === null ? undefined : nonNegativeNumber(value, path)
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`)
  return value
}

function enumText<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  const parsed = requiredText(value, path)
  if (!(allowed as readonly string[]).includes(parsed)) throw new Error(`${path} must be one of: ${allowed.join(", ")}`)
  return parsed as T[number]
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const parsed = record(value, path)
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, requiredText(item, `${path}.${key}`)]))
}

function timestamp(value: unknown, path: string): string {
  const parsed = requiredText(value, path)
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`${path} must be an RFC3339 timestamp`)
  return parsed
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "—"
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
}

function formatSigned(value: number | undefined): string {
  if (value === undefined) return "—"
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`
}
