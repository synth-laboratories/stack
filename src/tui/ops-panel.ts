import { StyledText, dim, fg, type TextChunk } from "@opentui/core"
import type { LocalBootstrapSnapshot } from "../local/bootstrap.js"
import type { OptimizerRunSummary, OptimizerSnapshot } from "../local/optimizers.js"
import type { RemoteAccountSnapshot } from "../remote/account.js"
import type { ContainersPanelSnapshot } from "../remote/containers.js"
import type { HostedOptimizerRunSummary, HostedOptimizerSnapshot } from "../remote/optimizers.js"
import type { RemoteProjectsPanelSnapshot, RemoteTagScopeSummary } from "../remote/research.js"
import type { RemoteUsageSnapshot } from "../remote/usage.js"
import type { StackThreadMetaEvent } from "../thread-events.js"
import { isChatGptAuthPlan } from "../codex/account.js"
import { isCursorAuthPlan } from "../cursor/account.js"
import type { SubagentLog } from "./subagents.js"
import { subagentDisplayName, subagentDurationSeconds, subagentStatusLabel } from "./subagents.js"
import { stackTuiTheme as theme } from "./theme.js"

export type OpsPanelAgentUsage = {
  codexAuthPlan: string
  codexEmail?: string
  sessionSummary?: string
  codexBudget?: string
}

export type RightPanelMode = "hosted" | "local" | "actors"

export type OpsPanelFocus = {
  focusMode: string
  selectedHostedOptimizerRunIndex: number
  selectedOptimizerRunIndex: number
}

export type OpsPanelSetup = {
  authMessage: string
  authEnvFile?: string
  hasAuth: boolean
  optimizerCliAvailable: boolean
  autoStartLocalOptimizer: boolean
  autoStartDevSlot: boolean
  localBootstrap?: LocalBootstrapSnapshot
}

export type OpsPanelMetaEvent = Pick<StackThreadMetaEvent, "event_id" | "type" | "observed_at" | "actor_role" | "payload">

export type OpsPanelActors = {
  primaryModel: string
  primaryStatus: string
  turnCount: number
  currentTurnStartedAt?: string
  cursorHarness?: boolean
  codexSubagentsEnabled: boolean
  codexSubagentModel: string
  codexSubagentReasoningEffort: string
  codexArgsLocked: boolean
  codexArgs: string[]
  subagents: SubagentLog[]
}

export function opsPanelTitle(mode: RightPanelMode, environmentName: string): string {
  if (mode === "actors") return `Actors · ${environmentName}`
  return mode === "hosted" ? `Synth Hosted · ${environmentName}` : `Local · ${environmentName}`
}

export function opsPanelHint(mode: RightPanelMode, focused: boolean): string {
  if (!focused) return "click or tab to focus · scroll"
  if (mode === "actors") return "p → local · enter toggle subagents · j/k scroll"
  return mode === "hosted"
    ? "p → actors · j/k scroll · r refresh (hosted tab)"
    : "p → hosted · enter starts GEPA · j/k scroll · r refresh"
}

export function opsPanelText(input: {
  mode: RightPanelMode
  setup: OpsPanelSetup
  account: RemoteAccountSnapshot
  usage: RemoteUsageSnapshot
  agentUsage: OpsPanelAgentUsage
  projects: RemoteProjectsPanelSnapshot
  hosted: HostedOptimizerSnapshot
  containers: ContainersPanelSnapshot
  localOptimizers: OptimizerSnapshot
  actors: OpsPanelActors
  focus: OpsPanelFocus
  metaEvents: OpsPanelMetaEvent[]
  scrollOffset: number
  visibleRows: number
}): string {
  const body = input.mode === "actors"
    ? actorsLines(input.actors)
    : input.mode === "hosted"
      ? [...hostedSynthLines(input.account, input.usage, input.agentUsage, input.projects, input.hosted, input.focus)]
      : [...localSynthLines(input.containers, input.localOptimizers, input.focus)]
  const meta = metaEventLines(input.metaEvents)
  const lines = [...meta, "", ...body]
  const window = scrollWindow(lines, input.scrollOffset, input.visibleRows)
  const header = [...setupHintLines(input), opsPanelHint(input.mode, input.focus.focusMode === "ops"), ""]
  if (lines.length === 0) return [...header, "(empty)"].join("\n")
  if (window.length < lines.length) {
    header.unshift(`scroll ${input.scrollOffset + 1}-${input.scrollOffset + window.length}/${lines.length}`)
  }
  return [...header, ...window].join("\n")
}

export function renderOpsPanelStyled(input: Parameters<typeof opsPanelText>[0]): StyledText {
  const text = opsPanelText(input)
  const chunks: TextChunk[] = []
  for (const [index, line] of text.split("\n").entries()) {
    if (index > 0) chunks.push(fg(theme.fgPrimary)("\n"))
    chunks.push(...styledOpsLine(line))
  }
  return new StyledText(chunks)
}

export function opsPanelLineCount(input: {
  mode: RightPanelMode
  setup: OpsPanelSetup
  account: RemoteAccountSnapshot
  usage: RemoteUsageSnapshot
  agentUsage: OpsPanelAgentUsage
  projects: RemoteProjectsPanelSnapshot
  hosted: HostedOptimizerSnapshot
  containers: ContainersPanelSnapshot
  localOptimizers: OptimizerSnapshot
  actors: OpsPanelActors
  focus: OpsPanelFocus
  metaEvents: OpsPanelMetaEvent[]
}): number {
  return opsPanelText({ ...input, scrollOffset: 0, visibleRows: Number.MAX_SAFE_INTEGER }).split("\n").length
}

function styledOpsLine(line: string): TextChunk[] {
  if (line.includes("multi_agent on")) return styledStatusLine(line, "multi_agent on", "#3fb950")
  if (line.includes("multi_agent off")) return styledStatusLine(line, "multi_agent off", theme.synth.red)
  if (line.includes("features.multi_agent=true")) return styledStatusLine(line, "true", "#3fb950")
  if (line.includes("features.multi_agent=false")) return styledStatusLine(line, "false", theme.synth.red)
  if (line === "Launch config" || line === "Actors" || line === "Meta events") {
    return [fg(theme.fgAccentStrong)(line)]
  }
  if (line.includes("(none yet)") || line.includes("F2 preview")) {
    return [dim(fg(theme.fgMuted)(line))]
  }
  return [fg(theme.fgPrimary)(line)]
}

function styledStatusLine(line: string, needle: string, color: string): TextChunk[] {
  const index = line.indexOf(needle)
  if (index < 0) return [fg(theme.fgPrimary)(line)]
  const before = line.slice(0, index)
  const after = line.slice(index + needle.length)
  return [
    fg(theme.fgPrimary)(before),
    fg(color)(needle),
    fg(theme.fgPrimary)(after),
  ]
}

function setupHintLines(input: {
  mode: RightPanelMode
  setup: OpsPanelSetup
  projects: RemoteProjectsPanelSnapshot
  localOptimizers: OptimizerSnapshot
}): string[] {
  const lines: string[] = []
  if (!input.setup.hasAuth) {
    lines.push("Setup · auth missing")
    lines.push(`  ${oneLine(input.setup.authMessage, 52)}`)
    if (input.setup.authEnvFile) lines.push(`  add key to ${oneLine(input.setup.authEnvFile, 44)}`)
  }
  if (input.setup.localBootstrap && !input.setup.localBootstrap.dockerAvailable) {
    lines.push("Setup · docker unavailable")
    lines.push("  docker info  # start OrbStack / Docker Desktop")
  }
  if (input.mode === "actors") return lines
  if (input.mode === "hosted") {
    if (input.projects.status === "offline" && input.setup.hasAuth) {
      const slot = input.setup.localBootstrap?.devSlotInstance ?? "slot1"
      if (input.setup.localBootstrap?.devApiStatus === "starting") {
        lines.push("Setup · dev slot starting")
        lines.push(`  tail -f ${oneLine(input.setup.localBootstrap.devSlotLogPath, 44)}`)
      } else {
        lines.push("Setup · dev API offline")
        lines.push(`  cd synth-dev && ./scripts/local.sh up ${slot}`)
      }
    }
  } else {
    if (!input.setup.optimizerCliAvailable) {
      lines.push("Setup · install local optimizers")
      lines.push("  pip install synth-optimizers")
    }
    if (input.localOptimizers.status !== "running") {
      if (input.setup.optimizerCliAvailable) {
        lines.push("Setup · local GEPA not running")
        lines.push(
          input.setup.autoStartLocalOptimizer
            ? "  enter starts service (auto-start failed or disabled)"
            : "  enter starts service · set STACK_AUTO_START_LOCAL_OPTIMIZER=1",
        )
      }
    }
    if (
      input.setup.hasAuth &&
      input.setup.localBootstrap?.devApiStatus === "offline" &&
      input.setup.autoStartDevSlot
    ) {
      const slot = input.setup.localBootstrap.devSlotInstance
      lines.push("Setup · dev API offline (containers need slot)")
      lines.push(`  cd synth-dev && ./scripts/local.sh up ${slot}`)
    }
  }
  if (lines.length > 0) lines.push("")
  return lines
}

function hostedSynthLines(
  account: RemoteAccountSnapshot,
  usage: RemoteUsageSnapshot,
  _agentUsage: OpsPanelAgentUsage,
  projects: RemoteProjectsPanelSnapshot,
  hosted: HostedOptimizerSnapshot,
  focus: OpsPanelFocus,
): string[] {
  const lines: string[] = ["Synth billing", synthUsageHeader(account, usage), ""]
  lines.push(...synthUsageBody(account, usage))
  lines.push("", "Projects", projectsHeader(projects), "")
  lines.push(...projectsBody(projects))
  lines.push("", "Hosted Optimizers", hostedHeader(hosted), "")
  lines.push(...hostedBody(hosted, focus))
  return lines
}

function synthUsageHeader(account: RemoteAccountSnapshot, usage: RemoteUsageSnapshot): string {
  const accountStatus = account.status === "connected" ? "connected" : account.status
  const identity = account.userEmail ?? account.keyHint
  const identityLabel = identity ? ` · ${identity}` : ""
  const plan = formatPlanLabel(usage)
  return `${accountStatus}${identityLabel}${plan ? ` · ${plan}` : ""}`
}

function formatPlanLabel(usage: RemoteUsageSnapshot): string | undefined {
  if (!usage.planTier) return undefined
  const tier = oneLine(usage.planTier, 10)
  const legacy = usage.legacyPlan && usage.legacyPlan !== usage.planTier
    ? ` (${oneLine(usage.legacyPlan, 12)})`
    : ""
  return `${tier}${legacy}`
}

function synthUsageBody(account: RemoteAccountSnapshot, usage: RemoteUsageSnapshot): string[] {
  const lines: string[] = []
  if (account.status !== "connected" && account.message) {
    lines.push(`  ${oneLine(account.message, 52)}`)
  }
  if (usage.status === "missing-auth") {
    lines.push("  add Synth API key (see Setup above)")
    return lines
  }
  if (usage.status === "offline") {
    lines.push(`  billing offline${usage.message ? ` · ${oneLine(usage.message, 36)}` : ""}`)
    return lines
  }

  if (usage.blocked) {
    lines.push(`  blocked${usage.blockedReason ? ` · ${oneLine(usage.blockedReason, 40)}` : ""}`)
  }

  if (usage.walletUsd !== undefined && usage.walletUsd > 0) {
    lines.push(`  wallet ${formatUsd(usage.walletUsd)}`)
  }

  const stackAuxBudget = formatStackAuxBudgetLine(usage)
  if (stackAuxBudget) lines.push(stackAuxBudget)

  lines.push(...formatAllowanceSummaryLines(usage.allowanceWindows))

  const spendParts: string[] = []
  if (usage.spendTodayUsd !== undefined && usage.spendTodayUsd > 0) {
    spendParts.push(`today ${formatUsd(usage.spendTodayUsd)}`)
  }
  if (usage.spend7dUsd !== undefined && usage.spend7dUsd > 0) {
    spendParts.push(`7d charged ${formatUsd(usage.spend7dUsd)}`)
  }
  if (usage.spend30dUsd !== undefined && usage.spend30dUsd > 0) {
    spendParts.push(`30d charged ${formatUsd(usage.spend30dUsd)}`)
  }
  if (spendParts.length > 0) lines.push(`  ${oneLine(spendParts.join(" · "), 52)}`)

  if (lines.length === 0) lines.push("  (no billing data)")
  return lines
}

export function subscriptionPanelLines(
  account: RemoteAccountSnapshot,
  usage: RemoteUsageSnapshot,
  agentUsage: OpsPanelAgentUsage,
  environmentName: string,
  codexAuthHistory?: string[],
): string[] {
  const lines = [`Synth · ${environmentName}`, synthUsageHeader(account, usage)]
  if (account.userEmail) {
    lines.push(`  email ${oneLine(account.userEmail, 52)}`)
  }
  if (account.orgName || account.orgId) {
    const orgLabel = account.orgName ? oneLine(account.orgName, 28) : account.orgId?.slice(0, 12) ?? "-"
    const orgSuffix = account.orgId && account.orgName ? ` (${account.orgId.slice(0, 8)})` : ""
    lines.push(`  org ${orgLabel}${orgSuffix}`)
  }
  lines.push("", ...synthUsageBody(account, usage))
  if (usage.usage7dUsd !== undefined && usage.usage7dUsd > 0) {
    lines.push(`  usage 7d ${formatUsd(usage.usage7dUsd)}`)
  }
  const breakdown = usage.usageBreakdown?.byType ?? []
  if (breakdown.length > 0) {
    lines.push("", "Usage by type (7d)")
    for (const row of breakdown) {
      lines.push(`  ${row.label} ${formatUsd(row.costUsd)}`)
    }
  }
  lines.push("", "Local agent")
  if (
    agentUsage.codexEmail &&
    (isChatGptAuthPlan(agentUsage.codexAuthPlan) || isCursorAuthPlan(agentUsage.codexAuthPlan))
  ) {
    lines.push(`  email ${oneLine(agentUsage.codexEmail, 52)}`)
  }
  lines.push(`  agent ${agentUsage.codexAuthPlan}${agentUsage.codexBudget ? ` · ${agentUsage.codexBudget}` : ""}`)
  if (agentUsage.sessionSummary) lines.push(`  session ${oneLine(agentUsage.sessionSummary, 46)}`)
  if (codexAuthHistory && codexAuthHistory.length > 0) {
    lines.push("", ...codexAuthHistory)
  }
  return lines
}

export function subscriptionPanelLineCount(
  account: RemoteAccountSnapshot,
  usage: RemoteUsageSnapshot,
  agentUsage: OpsPanelAgentUsage,
  environmentName: string,
  codexAuthHistory?: string[],
): number {
  return subscriptionPanelLines(account, usage, agentUsage, environmentName, codexAuthHistory).length
}

function formatAllowanceSummaryLines(
  windows: RemoteUsageSnapshot["allowanceWindows"],
): string[] {
  if (windows.length === 0) return []
  const lines: string[] = []
  for (const modelClass of ["premium", "value"]) {
    const group = windows.filter((window) => window.modelClass === modelClass)
    if (group.length === 0) continue
    const label = modelClass === "premium" ? "Prem" : "Val"
    const parts = group.map((window) => {
      const windowLabel = allowanceWindowLabel(window.windowKind)
      const remaining = formatUsd(window.remainingUsd)
      const used = formatUsd(Math.max(0, window.capUsd - window.remainingUsd))
      if (window.consumedUsd > 0.001) {
        return `${windowLabel} ${remaining} left (${used} used)`
      }
      return `${windowLabel} ${remaining} left`
    })
    lines.push(`  ${label} · ${oneLine(parts.join(" · "), 46)}`)
  }
  return lines
}

function formatStackAuxBudgetLine(usage: RemoteUsageSnapshot): string | undefined {
  const budget = usage.stackAuxBudget
  if (!budget) return undefined
  const model = budget.model ? oneLine(budget.model, 18) : "aux"
  const synthWide = `${formatUsd(budget.synthWide.remainingUsd)} / ${formatUsd(budget.synthWide.capUsd)} global`
  const orgDaily = `${formatUsd(budget.orgDaily.remainingUsd)} / ${formatUsd(budget.orgDaily.capUsd)} org today`
  const reset = budget.orgDaily.resetsInSeconds === undefined
    ? ""
    : ` · reset ${formatDuration(budget.orgDaily.resetsInSeconds)}`
  return `  Synth ${model} · ${oneLine(`${synthWide} · ${orgDaily}${reset}`, 50)}`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "soon"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return "soon"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (hours < 24) return remMinutes > 0 ? `${hours}h${remMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d${remHours}h` : `${days}d`
}

function allowanceWindowLabel(windowKind: string): string {
  if (windowKind === "five_hour") return "5h"
  if (windowKind === "weekly") return "wk"
  return oneLine(windowKind.replaceAll("_", " "), 8)
}

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0"
  if (Math.abs(amount) >= 100) return `$${amount.toFixed(0)}`
  if (Math.abs(amount) >= 10) return `$${amount.toFixed(2)}`
  if (Math.abs(amount) >= 0.01) return `$${amount.toFixed(2)}`
  if (amount > 0) return `$${amount.toFixed(4)}`
  return "$0"
}

function localSynthLines(
  containers: ContainersPanelSnapshot,
  localOptimizers: OptimizerSnapshot,
  focus: OpsPanelFocus,
): string[] {
  const lines: string[] = ["Containers", containersHeader(containers), ""]
  lines.push(...containersBody(containers))
  lines.push("", "Local Optimizers", localOptimizersHeader(localOptimizers), "")
  lines.push(...localOptimizersBody(localOptimizers, focus))
  return lines
}

function actorsLines(actors: OpsPanelActors): string[] {
  if (actors.cursorHarness) {
    const lines = [
      "Launch config",
      "  Cursor harness — subagents N/A (Codex multi_agent only)",
      "",
      "Actors",
      `├─ primary ${oneLine(actors.primaryStatus, 9)} · ${oneLine(actors.primaryModel, 14)} · turn ${actors.turnCount}`,
    ]
    if (actors.currentTurnStartedAt && actors.primaryStatus === "running") {
      lines.push(`│  running ${durationSinceLabel(actors.currentTurnStartedAt)}`)
    }
    lines.push("└─ workers N/A on Cursor harness", "", "F2 preview · stackd actor tree lands L5")
    return lines
  }
  const enabled = actors.codexSubagentsEnabled ? "on" : "off"
  const locked = actors.codexArgsLocked ? "locked by STACK_CODEX_ARGS" : "enter toggles next launch"
  const running = actors.subagents.filter((agent) => agent.status === "running" || agent.status === "spawning").length
  const done = actors.subagents.filter((agent) => agent.status === "completed" || agent.status === "closed").length
  const failed = actors.subagents.filter((agent) => agent.status === "errored" || agent.status === "interrupted").length
  const lines = [
    `Launch config`,
    `  multi_agent ${enabled} · ${locked}`,
    `  ${oneLine(featuresMultiAgentArg(actors.codexArgs), 46)}`,
    `  subagent model ${oneLine(actors.codexSubagentModel, 18)} · ${actors.codexSubagentReasoningEffort}`,
    "",
    `Actors`,
    `├─ primary ${oneLine(actors.primaryStatus, 9)} · ${oneLine(actors.primaryModel, 14)} · turn ${actors.turnCount}`,
  ]
  if (actors.currentTurnStartedAt && actors.primaryStatus === "running") {
    lines.push(`│  running ${durationSinceLabel(actors.currentTurnStartedAt)}`)
  }
  if (actors.subagents.length === 0) {
    lines.push("└─ workers none parsed from transcript")
    lines.push("", `Usage`, `  workers 0 · model ${oneLine(actors.codexSubagentModel, 18)}`)
    lines.push("", "F2 preview · transcript-derived; stackd actor tree lands L5")
    return lines
  }
  actors.subagents.slice(0, 8).forEach((agent, index) => {
    const last = index === Math.min(actors.subagents.length, 8) - 1
    const branch = last ? "└─" : "├─"
    const status = subagentStatusLabel(agent.status)
    const duration = subagentDurationSeconds(agent)
    const durationText = duration === undefined ? "" : ` · ${duration.toFixed(1)}s`
    lines.push(`${branch} ${oneLine(subagentDisplayName(agent), 16)} ${oneLine(status, 8)}${durationText}`)
    if (agent.agentType && agent.agentType !== agent.name) lines.push(`${last ? " " : "│"}  type ${oneLine(agent.agentType, 22)}`)
  })
  if (actors.subagents.length > 8) lines.push(`   ... +${actors.subagents.length - 8} workers`)
  lines.push("", `Summary · ${done} done · ${running} active · ${failed} failed`)
  lines.push(...subagentUsageLines(actors))
  return lines
}

function subagentUsageLines(actors: OpsPanelActors): string[] {
  const byType = new Map<string, number>()
  for (const agent of actors.subagents) {
    const key = agent.agentType || "default"
    byType.set(key, (byType.get(key) ?? 0) + 1)
  }
  const counts = [...byType.entries()].map(([type, count]) => `${type} ${count}`).join(" · ")
  return [
    "",
    "Usage",
    `  workers ${actors.subagents.length} · model ${oneLine(actors.codexSubagentModel, 18)}`,
    counts ? `  by type ${oneLine(counts, 42)}` : "",
    "  tokens by worker: pending actor traces",
  ].filter((line) => line.length > 0)
}

function featuresMultiAgentArg(args: readonly string[]): string {
  const index = args.findIndex((arg) => arg === "features.multi_agent=true" || arg === "features.multi_agent=false")
  if (index >= 0) return `toml ${args[index]}`
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === "--enable" && args[i + 1] === "multi_agent") return "flag --enable multi_agent"
    if (args[i] === "--disable" && args[i + 1] === "multi_agent") return "flag --disable multi_agent"
  }
  return "toml not explicit"
}

function durationSinceLabel(startedAt: string): string {
  const elapsed = (Date.now() - Date.parse(startedAt)) / 1000
  if (!Number.isFinite(elapsed) || elapsed < 0) return "-"
  if (elapsed < 60) return `${elapsed.toFixed(0)}s`
  return `${Math.floor(elapsed / 60)}m ${Math.floor(elapsed % 60)}s`
}

function projectsHeader(snapshot: RemoteProjectsPanelSnapshot): string {
  const message = snapshot.message ? ` · ${oneLine(snapshot.message, 24)}` : ""
  const tag = snapshot.tagScope ? ` · tag ${oneLine(snapshot.tagScope.name, 12)}` : ""
  const experiments7d = formatExperiments7dTotal(snapshot.projects)
  const experiments = experiments7d ? ` · ${experiments7d}` : ""
  return `${snapshot.status}${message}${tag}${experiments} · factories + runs`
}

function formatExperiments7dTotal(
  projects: RemoteProjectsPanelSnapshot["projects"],
): string | undefined {
  let total = 0
  let capped = false
  for (const project of projects) {
    if (project.experimentsLast7Days === undefined) continue
    total += project.experimentsLast7Days
    if (project.experimentsLast7DaysCapped) capped = true
  }
  if (total <= 0 && !projects.some((project) => project.experimentsLast7Days !== undefined)) {
    return undefined
  }
  return capped ? `${total}+ expts/7d` : `${total} expts/7d`
}

function formatProjectExperiments7d(project: RemoteProjectsPanelSnapshot["projects"][number]): string | undefined {
  if (project.experimentsLast7Days === undefined) return undefined
  const count = project.experimentsLast7DaysCapped
    ? `${project.experimentsLast7Days}+`
    : String(project.experimentsLast7Days)
  return `${count} expts/7d`
}

function projectsBody(snapshot: RemoteProjectsPanelSnapshot): string[] {
  if (snapshot.projects.length === 0) {
    if (snapshot.status === "missing-auth") return ["  add Synth API key (see Setup above)"]
    if (snapshot.status === "offline") return ["  start dev slot (see Setup above)"]
    if (snapshot.tagScope) return ["  (no live projects)", "", ...orgWideTagLines(snapshot.tagScope)]
    return ["  (no live projects)"]
  }
  const lines: string[] = []
  const orgWideTag =
    snapshot.tagScope && !snapshot.tagScope.factoryId && !snapshot.tagScope.defaultProjectId
      ? snapshot.tagScope
      : undefined
  if (orgWideTag) {
    lines.push(...orgWideTagLines(orgWideTag))
    lines.push("")
  }
  for (const project of snapshot.projects) {
    const alias = project.alias && project.alias !== project.name ? ` (${oneLine(project.alias, 10)})` : ""
    const active = project.activeRunId ? ` · active ${project.activeRunId.slice(0, 8)}` : ""
    const experiments7d = formatProjectExperiments7d(project)
    lines.push(`${oneLine(project.name, 20)}${alias}${active}`)
    if (experiments7d) lines.push(`  ${experiments7d}`)
    const projectTag = projectLevelTagScope(snapshot.tagScope, project.projectId)
    if (projectTag) lines.push(...projectTagLines(projectTag, "  "))
    for (const factory of project.factories) {
      lines.push(`  f ${oneLine(factory.name, 16)} · ${factory.status ?? "unknown"}`)
      const factoryTag = factoryBoundTagScope(snapshot.tagScope, factory.factoryId)
      if (factoryTag) lines.push(...projectTagLines(factoryTag, "    "))
    }
    if (project.factories.length === 0) lines.push("  (no factories)")
    for (const run of project.runs.slice(0, 4)) {
      lines.push(`  r ${run.runId.slice(0, 8)} · ${run.state}${run.phase ? `/${run.phase}` : ""} · ${runAge(run)}`)
    }
    if (project.runs.length === 0) lines.push("  (no runs)")
    else if (project.runs.length > 4) lines.push(`  … +${project.runs.length - 4} runs`)
    lines.push("")
  }
  if (lines.at(-1) === "") lines.pop()
  return lines
}

function projectLevelTagScope(
  scope: RemoteTagScopeSummary | undefined,
  projectId: string,
): RemoteTagScopeSummary | undefined {
  if (!scope || scope.factoryId) return undefined
  if (scope.defaultProjectId && scope.defaultProjectId !== projectId) return undefined
  if (scope.defaultProjectId === projectId) return scope
  return undefined
}

function factoryBoundTagScope(
  scope: RemoteTagScopeSummary | undefined,
  factoryId: string,
): RemoteTagScopeSummary | undefined {
  if (!scope?.factoryId || scope.factoryId !== factoryId) return undefined
  return scope
}

function orgWideTagLines(scope: RemoteTagScopeSummary): string[] {
  return [`Tag (org) · ${tagScopeLabel(scope)}`, `  ${tagDelegateHint()}`]
}

function projectTagLines(scope: RemoteTagScopeSummary, indent: string): string[] {
  return [`${indent}tag · ${tagScopeLabel(scope)}`, `${indent}  ${tagDelegateHint()}`]
}

function tagScopeLabel(scope: RemoteTagScopeSummary): string {
  const parts = [
    oneLine(scope.name, 14),
    scope.scopeId.slice(0, 8),
    scope.status,
  ]
  if (scope.defaultProjectId) parts.push(`proj ${scope.defaultProjectId.slice(0, 8)}`)
  return parts.join(" · ")
}

function tagDelegateHint(): string {
  return "delegate: tag_create_session (MCP) or client.research.factories.tag"
}

function hostedHeader(snapshot: HostedOptimizerSnapshot): string {
  const counts = countHostedRuns(snapshot.runs)
  const message = snapshot.message ? ` · ${oneLine(snapshot.message, 22)}` : ""
  return `${snapshot.status}${message} · ${snapshot.runs.length} jobs · ${counts.active} active`
}

function hostedBody(snapshot: HostedOptimizerSnapshot, focus: OpsPanelFocus): string[] {
  if (snapshot.runs.length === 0) {
    if (snapshot.status === "missing-auth") return ["  add Synth API key"]
    return ["  (no hosted optimizer jobs)"]
  }
  const lines = snapshot.runs.slice(0, 6).map((run, index) => {
    const cursor = focus.focusMode === "hosted" && index === focus.selectedHostedOptimizerRunIndex ? ">" : " "
    const status = oneLine(run.status, 8).padEnd(8)
    const at = shortTime(run.submittedAt ?? run.createdAt ?? run.updatedAt)
    return `${cursor} ${status} ${at} ${oneLine(`${run.algorithm} ${run.runId}`, 24)}`
  })
  const selected = snapshot.runs[focus.selectedHostedOptimizerRunIndex]
  if (selected) {
    lines.push("", "Selected hosted job", ...selectedHostedLines(snapshot, selected))
  }
  if (focus.focusMode === "hosted") {
    lines.push("", "tab hosted · r refresh · j/k · o/v/d/c")
  }
  return lines
}

function selectedHostedLines(snapshot: HostedOptimizerSnapshot, run: HostedOptimizerRunSummary): string[] {
  const detail = snapshot.runDetails[run.runId]
  const lines = [
    `  ${oneLine(run.runId, 30)} · ${run.algorithm}`,
    `  ${run.status}${run.finalizeState ? ` / ${run.finalizeState}` : ""}`,
  ]
  if (run.error) lines.push(`  issue ${oneLine(run.error, 36)}`)
  if (detail?.artifactNames.length) {
    lines.push(`  artifacts ${oneLine(detail.artifactNames.join(", "), 32)}`)
  }
  return lines
}

function containersHeader(snapshot: ContainersPanelSnapshot): string {
  const message = snapshot.message ? ` · ${oneLine(snapshot.message, 22)}` : ""
  return `${snapshot.status}${message} · ${snapshot.containers.length} registered`
}

function containersBody(snapshot: ContainersPanelSnapshot): string[] {
  if (snapshot.containers.length === 0) {
    if (snapshot.status === "missing-auth") return ["  add Synth API key (see Setup above)"]
    if (snapshot.status === "offline") return ["  API offline — start dev slot or check /v1/containers"]
    return ["  (no containers) · synth-ai containers create …"]
  }
  return snapshot.containers.slice(0, 8).map((container) => {
    const task = container.taskType ? ` · ${oneLine(container.taskType, 12)}` : ""
    return `  ${oneLine(container.name, 16)} · ${oneLine(container.status, 10)}${task}`
  })
}

function localOptimizersHeader(snapshot: OptimizerSnapshot): string {
  const counts = localOptimizerCounts(snapshot)
  const message = snapshot.message ? ` · ${oneLine(snapshot.message, 20)}` : ""
  return `${snapshot.status}${message} · ${counts.total} jobs · ${counts.active} active`
}

function localOptimizersBody(snapshot: OptimizerSnapshot, focus: OpsPanelFocus): string[] {
  if (snapshot.runs.length === 0) {
    return [
      "  (no local optimizer jobs)",
      `  service ${oneLine(snapshot.serviceUrl, 28)}`,
      focus.focusMode === "optimizers" ? "  tab local optimizers · enter start · r refresh" : "",
    ].filter((line) => line.length > 0)
  }
  const lines = snapshot.runs.slice(0, 6).map((run, index) => {
    const cursor = focus.focusMode === "optimizers" && index === focus.selectedOptimizerRunIndex ? ">" : " "
    return `${cursor} ${oneLine(run.status, 10).padEnd(10)} ${shortTime(run.startedAt ?? run.submittedAt)}  ${oneLine(run.runId, 18)}`
  })
  const selected = snapshot.runs[focus.selectedOptimizerRunIndex]
  if (selected) {
    lines.push("", "Selected local job", ...selectedLocalLines(selected))
  }
  lines.push("", `service ${snapshot.status} · ${oneLine(snapshot.serviceUrl, 24)}`)
  if (focus.focusMode === "optimizers") lines.push("enter start/restart · r refresh · j/k select")
  else if (snapshot.status !== "running") lines.push("enter starts GEPA (agent focus, local panel)")
  return lines
}

function selectedLocalLines(run: OptimizerRunSummary): string[] {
  return [
    `  ${oneLine(run.runId, 30)}`,
    `  ${run.status}${run.phase ? ` / ${run.phase}` : ""}`,
    run.error ? `  issue ${oneLine(run.error, 36)}` : "",
  ].filter((line) => line.length > 0)
}

function metaEventLines(events: OpsPanelMetaEvent[]): string[] {
  const visible = events.filter(isVisualMetaEvent).slice(-5).reverse()
  const lines = ["Meta events"]
  if (visible.length === 0) return [...lines, "  (none yet)"]
  for (const event of visible) {
    lines.push(`  ${metaEventLabel(event)} · ${shortTime(event.observed_at)} · ${metaEventSubject(event)}`)
  }
  return lines
}

function isVisualMetaEvent(event: OpsPanelMetaEvent): boolean {
  return (
    event.type === "skill.read" ||
    event.type === "guidance.query" ||
    event.type === "guidance.read" ||
    event.type === "guidance.used" ||
    event.type === "guidance.impact_judged" ||
    event.type === "monitor.skill_context_push" ||
    event.type === "gardener.skill_suggest" ||
    event.type === "monitor.wake" ||
    event.type.startsWith("gardener.") ||
    isSkillFileReadEvent(event)
  )
}

function metaEventLabel(event: OpsPanelMetaEvent): string {
  if (event.type === "skill.read" || isSkillFileReadEvent(event)) return "skill"
  if (event.type === "monitor.wake") return "monitor"
  if (event.type === "monitor.skill_context_push" || event.type === "gardener.skill_suggest") return "push"
  if (event.type === "gardener.queued") return "gardener"
  if (event.type === "gardener.routed") return "route"
  if (event.type === "gardener.dispatched") return "dispatch"
  if (event.type === "gardener.garden_updated") return "garden"
  if (event.type === "gardener.workspace_updated") return "workspace"
  if (event.type === "gardener.maintenance_pass") return "maint"
  if (event.type === "gardener.dismissed") return "dismiss"
  if (event.type === "gardener.friction") return "friction"
  if (event.type === "guidance.query") return "search"
  if (event.type === "guidance.impact_judged") return "impact"
  if (event.type.startsWith("guidance.")) return "guide"
  return oneLine(event.type, 8)
}

function metaEventSubject(event: OpsPanelMetaEvent): string {
  const payload = event.payload
  const subject =
    stringPayload(payload, "skill_id") ??
    stringPayload(payload, "skill_name") ??
    stringPayload(payload, "guidance_id") ??
    stringPayload(payload, "query") ??
    skillNameFromCommand(stringPayload(payload, "command")) ??
    stringPayload(payload, "wake_reason") ??
    stringPayload(payload, "reason") ??
    stringPayload(payload, "summary") ??
    stringPayload(payload, "message") ??
    event.event_id
  const suffix = metaEventSuffix(event)
  return oneLine(`${subject}${suffix}`, 34)
}

function metaEventSuffix(event: OpsPanelMetaEvent): string {
  const impact = stringPayload(event.payload, "impact")
  if (impact) return ` · ${impact}`
  const resultCount = numberPayload(event.payload, "result_count")
  if (resultCount !== undefined) return ` · ${resultCount} hits`
  const actor = event.actor_role ? ` · ${event.actor_role}` : ""
  return actor
}

function stringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberPayload(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isSkillFileReadEvent(event: OpsPanelMetaEvent): boolean {
  if (event.type !== "agent.tool.completed") return false
  const command = stringPayload(event.payload, "command")
  return Boolean(skillNameFromCommand(command))
}

function skillNameFromCommand(command: string | undefined): string | undefined {
  if (!command) return undefined
  const match = command.match(/\/skills\/([^/"'\s]+)\/SKILL\.md/)
  return match?.[1]
}

function countHostedRuns(runs: HostedOptimizerRunSummary[]): { active: number; done: number; failed: number } {
  let active = 0
  let done = 0
  let failed = 0
  for (const run of runs) {
    const status = run.status.toLowerCase()
    if (status.includes("fail") || status.includes("error")) failed += 1
    else if (status.includes("complete") || status.includes("success") || status.includes("terminal")) done += 1
    else active += 1
  }
  return { active, done, failed }
}

function localOptimizerCounts(snapshot: OptimizerSnapshot): { total: number; active: number } {
  const total = snapshot.runs.length
  let active = 0
  for (const run of snapshot.runs) {
    const status = run.status.toLowerCase()
    if (!status.includes("complete") && !status.includes("fail") && !status.includes("cancel")) active += 1
  }
  return { total, active }
}

function runAge(run: { updatedAt?: string; createdAt?: string; finishedAt?: string }): string {
  const stamp = run.updatedAt ?? run.finishedAt ?? run.createdAt
  if (!stamp) return "-"
  const deltaMs = Date.now() - Date.parse(stamp)
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "-"
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function shortTime(value?: string): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toISOString().slice(11, 16)
}

function scrollWindow(lines: string[], offset: number, visibleRows: number): string[] {
  if (visibleRows <= 0) return []
  const start = Math.max(0, Math.min(offset, Math.max(0, lines.length - visibleRows)))
  return lines.slice(start, start + visibleRows)
}

function oneLine(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}
