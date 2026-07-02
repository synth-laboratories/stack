import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  actorToolAllowed,
  mergeActorModel,
  mergeActorPrompt,
  mergeActorTools,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
  readTomlProfile,
  resolveActorPrompt,
  type ActorModelConfig,
  type ParsedTomlSections,
} from "./actor-config.js"

export type StackGardenerConfig = {
  id: string
  label: string
  enabled: boolean
  role: "gardener"
  model: ActorModelConfig
  prompt: {
    system?: string
    systemFile?: string
  }
  tools: {
    allow: string[]
    deny: string[]
  }
  permissions: {
    inbox: boolean
    route: boolean
    steer: boolean
    queue: boolean
    papercutMirror: boolean
    pauseWorker: boolean
    metaThreadLifecycle: boolean
    metaThreadTitle: boolean
  }
  wake: {
    onTurnCompleted: boolean
    idleMs: number
    onInboxPending: boolean
    onGardenDirty: boolean
  }
  friction: {
    turnExitNonzero: boolean
    rateLimit: boolean
    repeatedToolError: boolean
    consecutiveTurnFailures: boolean
  }
  handoff: {
    forceEnabled: boolean
    interruptWorker: boolean
    steerBeforeSeal: boolean
    autoApprove: boolean
    autoContinue: boolean
    defaultSuccessorRole: string
    requireSummary: boolean
    force: {
      allowUnboundThreads: boolean
      gardenSummaryFallback: boolean
      confirm: boolean
    }
  }
}

const LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V4 = [
  "You are the Stack Gardener, a portfolio conductor separate from worker threads and monitor sidecars. Reply to the operator in this chat.",
  "",
  "Your four jobs are:",
  "- Orient: summarize what work is running, what each thread is for, and where the operator should look next.",
  "- Route: when the operator gives explicit route, steer, or queue intent, direct the right instruction to the right worker thread.",
  "- Curate: suggest skills, context, labels, and handoffs that keep the workspace easier to operate.",
  "- Surface friction: call out confusing states, repeated failures, or missing context; log papercuts when configured.",
  "",
  "Local-only is always valid. Never imply Synth sign-in is required for the local worker, monitor, gardener, local GEPA, or `/goal`. When the operator asks about cloud, hosted ops, remote sync, or Synth inference, explain that sign-in is an optional unlock and point to `stack auth open signin` or the configured environment auth variable.",
  "",
  "You may read the hosted portfolio through Stack MCP only: use stack_status, stack_runtime_status, stack_list_remote_projects, stack_list_live_smrs, stack_list_factories, stack_list_hosted_optimizer_runs, stack_inference_catalog, and stack_inference_usage to orient the operator. Do not scrape backend databases, Redis, compatibility projections, browser DOM, or raw service state.",
  "",
  "The local gardener is not the cloud control plane. For remote sync narration, push/pull receipts, meta-thread to SMR-run binding, remote messages, Factory wake, or Factory pause/resume, hand off to the remote gardener with stack_remote_gardener_handoff or require explicit operator intent and the appropriate owner-route tool. Never claim cloud mutation, billing proof, deployment readiness, or product impact unless the evidence appears in Stack MCP/runtime output.",
  "",
  "Do not assume messages are worker tasks unless the operator uses route, steer, or queue language. If the operator asks about a specific run's live progress, evidence, or whether a worker is on track, point them to the monitor Sidecar events feed or sidecar thread for that worker; the gardener gives portfolio-level orientation, not the per-run event stream.",
  "",
  "Never use sidecar pause, monitor pause, or any monitor control as an archive or parking mechanism. Sidecar pause is a live-run safety/attention lever only.",
  "",
  "Use stack_meta_threads_list and stack_meta_thread_get for authoritative meta-thread state. To rename a meta-thread, call stack_meta_thread_set_title with a short title (max 48 chars). To park, archive, or make a meta-thread non-active, call stack_meta_thread_set_lifecycle with status=archived and confirm=true. Archive is reversible via status=live. Do not delete meta-threads, session logs, checkpoints, handoffs, or garden docs.",
  "",
  "If the operator asks whether a named worker is on track, prefer that worker's Sidecar events feed or sidecar thread for the live per-run answer. Give portfolio-level orientation, not a raw worker tape dump.",
  "",
  "When the operator asks you to name or label a bound meta-thread, prefer stack_meta_thread_set_title. Keep thread.name: <title> only as the head-session fallback. Never attempt to change meta_thread_id.",
  "",
  "Skills are first-class in stackd. Preinstalled: oss-gepa, hosted-gepa, synth-ai. You may always register or suggest skills (not permission-gated for gardener):",
  "  skill register <id> from <path>",
  "  skill suggest <id> [because <reason>]",
  "Suggesting a skill records it on the worker thread and steers the worker to read it.",
].join("\n")

const LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V1 = [
  "You are the Stack Gardener, a portfolio conductor separate from worker threads and monitor sidecars. Reply to the operator in this chat.",
  "",
  "Your four jobs are:",
  "- Orient: summarize what work is running, what each thread is for, and where the operator should look next.",
  "- Route: when the operator gives explicit route, steer, or queue intent, direct the right instruction to the right worker thread.",
  "- Curate: suggest skills, context, labels, and handoffs that keep the workspace easier to operate.",
  "- Surface friction: call out confusing states, repeated failures, or missing context; log papercuts when configured.",
  "",
  "Do not assume messages are worker tasks unless the operator uses route, steer, or queue language. If the operator asks about a specific run's live progress, evidence, or whether a worker is on track, point them to the monitor Sidecar events feed or sidecar thread for that worker; the gardener gives portfolio-level orientation, not the per-run event stream.",
  "",
  "Never use sidecar pause, monitor pause, or any monitor control as an archive or parking mechanism. Sidecar pause is a live-run safety/attention lever only.",
  "",
  "Use stack_meta_threads_list and stack_meta_thread_get for authoritative meta-thread state. To park, archive, or make a meta-thread non-active, call stack_meta_thread_set_lifecycle with status=archived and confirm=true. Archive is reversible via status=live. Do not delete meta-threads, session logs, checkpoints, handoffs, or garden docs.",
  "",
  "If the operator asks whether a named worker is on track, prefer that worker's Sidecar events feed or sidecar thread for the live per-run answer. Give portfolio-level orientation, not a raw worker tape dump.",
  "",
  "When the operator asks you to name or label a worker thread, pick a short title (max 48 chars) and end your reply with exactly one line: thread.name: <title>",
  "",
  "Skills are first-class in stackd. Preinstalled: oss-gepa, hosted-gepa, synth-ai. You may always register or suggest skills (not permission-gated for gardener):",
  "  skill register <id> from <path>",
  "  skill suggest <id> [because <reason>]",
  "Suggesting a skill records it on the worker thread and steers the worker to read it.",
].join("\n")

const LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V2 = [
  "You are the Stack Gardener, a portfolio conductor separate from worker threads and monitor sidecars. Reply to the operator in this chat.",
  "",
  "Your four jobs are:",
  "- Orient: summarize what work is running, what each thread is for, and where the operator should look next.",
  "- Route: when the operator gives explicit route, steer, or queue intent, direct the right instruction to the right worker thread.",
  "- Curate: suggest skills, context, labels, and handoffs that keep the workspace easier to operate.",
  "- Surface friction: call out confusing states, repeated failures, or missing context; log papercuts when configured.",
  "",
  "Do not assume messages are worker tasks unless the operator uses route, steer, or queue language. If the operator asks about a specific run's live progress, evidence, or whether a worker is on track, point them to the monitor Sidecar events feed or sidecar thread for that worker; the gardener gives portfolio-level orientation, not the per-run event stream.",
  "",
  "Never use sidecar pause, monitor pause, or any monitor control as an archive or parking mechanism. Sidecar pause is a live-run safety/attention lever only.",
  "",
  "Use stack_meta_threads_list and stack_meta_thread_get for authoritative meta-thread state. To rename a meta-thread, call stack_meta_thread_set_title with a short title (max 48 chars). To park, archive, or make a meta-thread non-active, call stack_meta_thread_set_lifecycle with status=archived and confirm=true. Archive is reversible via status=live. Do not delete meta-threads, session logs, checkpoints, handoffs, or garden docs.",
  "",
  "If the operator asks whether a named worker is on track, prefer that worker's Sidecar events feed or sidecar thread for the live per-run answer. Give portfolio-level orientation, not a raw worker tape dump.",
  "",
  "When the operator asks you to name or label a bound meta-thread, prefer stack_meta_thread_set_title. Keep thread.name: <title> only as the head-session fallback. Never attempt to change meta_thread_id.",
  "",
  "Skills are first-class in stackd. Preinstalled: oss-gepa, hosted-gepa, synth-ai. You may always register or suggest skills (not permission-gated for gardener):",
  "  skill register <id> from <path>",
  "  skill suggest <id> [because <reason>]",
  "Suggesting a skill records it on the worker thread and steers the worker to read it.",
].join("\n")

const LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V3 = LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V4.replace(
  "hand off to the remote gardener with stack_remote_gardener_handoff or require explicit operator intent",
  "hand off to the remote gardener or require explicit operator intent",
)

// B4 — the gardener owns portfolio orientation on screen: it pulls the gardener
// (and per-worker monitor) side panels forward at review moments via stack_ui_*.
const DEFAULT_GARDENER_BUILTIN_PROMPT = [
  LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V4,
  "",
  "You control the operator's side panel through stack_ui_open_panel and stack_ui_close_panel. When portfolio orientation would help the operator SEE the answer — a routing decision, a handoff review, or a 'what is running / where should I look' question — call stack_ui_open_panel with actor_role=\"gardener\", panel=\"gardener\", view=\"portfolio\", and a one-sentence reason. To point the operator at one worker's live progress, open panel=\"monitor\" with that worker's thread_id instead. Open at most once per distinct moment — never for routine replies; the operator's Esc closes the panel and wins until your next open. When the moment has passed, close a panel you opened with stack_ui_close_panel (you may only close panels you opened).",
].join("\n")

export const DEFAULT_GARDENER_CONFIG: StackGardenerConfig = {
  id: "default",
  label: "Gardener",
  enabled: true,
  role: "gardener",
  model: {
    provider: "openai",
    model: "gpt-5.5",
    reasoningEffort: "low",
    worker: "codex_app_server",
  },
  prompt: {
    systemFile: ".stack/gardeners/default.system.md",
  },
  tools: {
    allow: [
      "gardener.inbox",
      "gardener.route",
      "gardener.steer",
      "gardener.queue",
      "gardener.garden_rewrite",
      "skills.register",
      "skills.suggest",
      "stack_meta_threads_list",
      "stack_meta_thread_get",
      "stack_meta_thread_set_lifecycle",
      "stack_meta_thread_set_title",
      "stack_status",
      "stack_runtime_status",
      "stack_list_remote_projects",
      "stack_list_live_smrs",
      "stack_list_factories",
      "stack_list_hosted_optimizer_runs",
      "stack_inference_catalog",
      "stack_inference_usage",
      "stack_remote_gardener_handoff",
      "stack_ui_open_panel",
      "stack_ui_close_panel",
      "jsk.papercut",
      "handoff.force",
      "handoff.seal",
      "handoff.approve",
      "handoff.continue",
    ],
    deny: ["codex.interrupt"],
  },
  permissions: {
    inbox: true,
    route: true,
    steer: true,
    queue: true,
    papercutMirror: true,
    pauseWorker: false,
    metaThreadLifecycle: true,
    metaThreadTitle: true,
  },
  wake: {
    onTurnCompleted: true,
    idleMs: 300_000,
    onInboxPending: true,
    onGardenDirty: true,
  },
  friction: {
    turnExitNonzero: true,
    rateLimit: true,
    repeatedToolError: true,
    consecutiveTurnFailures: true,
  },
  handoff: {
    forceEnabled: true,
    interruptWorker: true,
    steerBeforeSeal: true,
    autoApprove: true,
    autoContinue: false,
    defaultSuccessorRole: "same",
    requireSummary: true,
    force: {
      allowUnboundThreads: true,
      gardenSummaryFallback: true,
      confirm: false,
    },
  },
}

const LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V1 = [
  "gardener.inbox",
  "gardener.route",
  "gardener.steer",
  "gardener.queue",
  "gardener.garden_rewrite",
  "skills.register",
  "skills.suggest",
  "stack_meta_threads_list",
  "stack_meta_thread_get",
  "stack_meta_thread_set_lifecycle",
  "jsk.papercut",
  "handoff.force",
  "handoff.seal",
  "handoff.approve",
  "handoff.continue",
]

const LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V2 = [
  ...LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V1.slice(0, 10),
  "stack_meta_thread_set_title",
  ...LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V1.slice(10),
]

const LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V3 = DEFAULT_GARDENER_CONFIG.tools.allow.filter(
  (tool) => tool !== "stack_remote_gardener_handoff" && tool !== "stack_ui_close_panel",
)

const LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V4 = DEFAULT_GARDENER_CONFIG.tools.allow.filter(
  (tool) => tool !== "stack_ui_close_panel",
)

export function ensureDefaultGardenerConfig(stackRoot: string): string {
  const dir = join(stackRoot, ".stack", "gardeners")
  mkdirSync(dir, { recursive: true })
  const tomlPath = join(dir, "default.toml")
  if (!existsSync(tomlPath)) {
    writeFileSync(tomlPath, `${defaultGardenerToml()}\n`, "utf8")
  }
  const promptPath = join(dir, "default.system.md")
  if (!existsSync(promptPath)) {
    writeFileSync(promptPath, `${DEFAULT_GARDENER_BUILTIN_PROMPT}\n`, "utf8")
  }
  return tomlPath
}

export function loadGardenerConfig(stackRoot: string): StackGardenerConfig {
  const profile = process.env.STACK_GARDENER_PROFILE?.trim() || "default"
  ensureDefaultGardenerConfig(stackRoot)
  const parsed = readTomlProfile(stackRoot, "gardeners", profile)
  const config = mergeGardenerConfig(DEFAULT_GARDENER_CONFIG, parsed)
  if (profile === "default") backfillGeneratedDefaultGardenerTools(config, parsed)
  const enabledOverride = process.env.STACK_GARDENER_ENABLED?.trim()
  if (enabledOverride === "0" || enabledOverride === "false") config.enabled = false
  if (enabledOverride === "1" || enabledOverride === "true") config.enabled = true
  if (process.env.STACK_GARDENER_PAPERCUT_MIRROR === "0") config.permissions.papercutMirror = false
  if (process.env.STACK_GARDENER_PAPERCUT_MIRROR === "1") config.permissions.papercutMirror = true
  const modelOverride = process.env.STACK_GARDENER_MODEL?.trim()
  if (modelOverride) config.model.model = modelOverride
  const effortOverride = process.env.STACK_GARDENER_REASONING_EFFORT?.trim()
  if (effortOverride) config.model.reasoningEffort = effortOverride
  assertGardenerProviderSupported(config)
  return config
}

export function gardenerHarnessLabel(config: StackGardenerConfig): string {
  return `${config.model.model}-${config.model.reasoningEffort}`
}

export function resolveGardenerSystemPrompt(stackRoot: string, config: StackGardenerConfig): string {
  const prompt = resolveActorPrompt(stackRoot, config.prompt, DEFAULT_GARDENER_BUILTIN_PROMPT)
  if (config.id === "default" && isLegacyGeneratedDefaultGardenerPrompt(prompt)) {
    return DEFAULT_GARDENER_BUILTIN_PROMPT
  }
  return prompt
}

export function gardenerToolAllowed(config: StackGardenerConfig, toolId: string): boolean {
  return actorToolAllowed(config.tools, toolId)
}

function mergeGardenerConfig(base: StackGardenerConfig, parsed: ParsedTomlSections): StackGardenerConfig {
  return {
    ...base,
    id: readString(parsed.gardener?.id) ?? readString(parsed.actor?.id) ?? base.id,
    label: readString(parsed.gardener?.label) ?? readString(parsed.actor?.label) ?? base.label,
    enabled: readBoolean(parsed.gardener?.enabled) ?? readBoolean(parsed.actor?.enabled) ?? base.enabled,
    role: "gardener",
    model: mergeActorModel(base.model, parsed),
    prompt: mergeActorPrompt(base.prompt, parsed),
    tools: mergeActorTools(base.tools, parsed),
    permissions: {
      inbox: readBoolean(parsed.permissions?.inbox) ?? base.permissions.inbox,
      route: readBoolean(parsed.permissions?.route) ?? base.permissions.route,
      steer: readBoolean(parsed.permissions?.steer) ?? base.permissions.steer,
      queue: readBoolean(parsed.permissions?.queue) ?? base.permissions.queue,
      papercutMirror: readBoolean(parsed.permissions?.papercut_mirror) ?? base.permissions.papercutMirror,
      pauseWorker: readBoolean(parsed.permissions?.pause_worker) ?? base.permissions.pauseWorker,
      metaThreadLifecycle:
        readBoolean(parsed.permissions?.meta_thread_lifecycle) ?? base.permissions.metaThreadLifecycle,
      metaThreadTitle: readBoolean(parsed.permissions?.meta_thread_title) ?? base.permissions.metaThreadTitle,
    },
    wake: {
      onTurnCompleted: readBoolean(parsed.wake?.on_turn_completed) ?? base.wake.onTurnCompleted,
      idleMs: readNumber(parsed.wake?.idle_ms) ?? base.wake.idleMs,
      onInboxPending: readBoolean(parsed.wake?.on_inbox_pending) ?? base.wake.onInboxPending,
      onGardenDirty: readBoolean(parsed.wake?.on_garden_dirty) ?? base.wake.onGardenDirty,
    },
    friction: {
      turnExitNonzero: readBoolean(parsed.friction?.turn_exit_nonzero) ?? base.friction.turnExitNonzero,
      rateLimit: readBoolean(parsed.friction?.rate_limit) ?? base.friction.rateLimit,
      repeatedToolError: readBoolean(parsed.friction?.repeated_tool_error) ?? base.friction.repeatedToolError,
      consecutiveTurnFailures:
        readBoolean(parsed.friction?.consecutive_turn_failures) ?? base.friction.consecutiveTurnFailures,
    },
    handoff: {
      forceEnabled: readBoolean(parsed.handoff?.force_enabled) ?? base.handoff.forceEnabled,
      interruptWorker: readBoolean(parsed.handoff?.interrupt_worker) ?? base.handoff.interruptWorker,
      steerBeforeSeal: readBoolean(parsed.handoff?.steer_before_seal) ?? base.handoff.steerBeforeSeal,
      autoApprove: readBoolean(parsed.handoff?.auto_approve) ?? base.handoff.autoApprove,
      autoContinue: readBoolean(parsed.handoff?.auto_continue) ?? base.handoff.autoContinue,
      defaultSuccessorRole: readString(parsed.handoff?.default_successor_role) ?? base.handoff.defaultSuccessorRole,
      requireSummary: readBoolean(parsed.handoff?.require_summary) ?? base.handoff.requireSummary,
      force: {
        allowUnboundThreads:
          readBoolean(parsed["handoff.force"]?.allow_unbound_threads) ?? base.handoff.force.allowUnboundThreads,
        gardenSummaryFallback:
          readBoolean(parsed["handoff.force"]?.garden_summary_fallback) ?? base.handoff.force.gardenSummaryFallback,
        confirm: readBoolean(parsed["handoff.force"]?.confirm) ?? base.handoff.force.confirm,
      },
    },
  }
}

function backfillGeneratedDefaultGardenerTools(config: StackGardenerConfig, parsed: ParsedTomlSections): void {
  const parsedAllow = readStringArray(parsed.tools?.allow)
  if (!parsedAllow || !isLegacyGeneratedDefaultGardenerAllow(parsedAllow)) return
  config.tools.allow = [...DEFAULT_GARDENER_CONFIG.tools.allow]
}

function isLegacyGeneratedDefaultGardenerAllow(toolIds: readonly string[]): boolean {
  return (
    sameStringSet(toolIds, LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V1) ||
    sameStringSet(toolIds, LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V2) ||
    sameStringSet(toolIds, LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V3) ||
    sameStringSet(toolIds, LEGACY_GENERATED_DEFAULT_GARDENER_ALLOW_V4)
  )
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

function isLegacyGeneratedDefaultGardenerPrompt(prompt: string): boolean {
  const normalized = normalizeGeneratedPrompt(prompt)
  return (
    normalized === normalizeGeneratedPrompt(LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V1) ||
    normalized === normalizeGeneratedPrompt(LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V2) ||
    normalized === normalizeGeneratedPrompt(LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V3) ||
    normalized === normalizeGeneratedPrompt(LEGACY_GENERATED_DEFAULT_GARDENER_PROMPT_V4)
  )
}

function normalizeGeneratedPrompt(prompt: string): string {
  return prompt.trim().replace(/\r\n/g, "\n")
}

function assertGardenerProviderSupported(config: StackGardenerConfig): void {
  const provider = config.model.provider.trim().toLowerCase()
  if (provider === "openai" || provider === "codex") return
  throw new Error(
    `gardener model provider '${config.model.provider}' is not executable yet; Stack currently runs gardener through Codex app-server. Use stack_inference_catalog for catalog visibility, and do not configure Synth inference profiles until the direct execution path lands.`,
  )
}

function defaultGardenerToml(): string {
  return [
    "[actor]",
    'id = "default"',
    'label = "Gardener"',
    "enabled = true",
    'role = "gardener"',
    "",
    "[gardener]",
    'id = "default"',
    'label = "Gardener"',
    "enabled = true",
    "",
    "[prompt]",
    'system_file = ".stack/gardeners/default.system.md"',
    "",
    "[model]",
    'provider = "openai"',
    'model = "gpt-5.5"',
    'reasoning_effort = "low"',
    'worker = "auto"',
    "",
    "[tools]",
    'allow = ["gardener.inbox", "gardener.route", "gardener.steer", "gardener.queue", "gardener.garden_rewrite", "skills.register", "skills.suggest", "stack_meta_threads_list", "stack_meta_thread_get", "stack_meta_thread_set_lifecycle", "stack_meta_thread_set_title", "stack_status", "stack_runtime_status", "stack_list_remote_projects", "stack_list_live_smrs", "stack_list_factories", "stack_list_hosted_optimizer_runs", "stack_inference_catalog", "stack_inference_usage", "stack_remote_gardener_handoff", "stack_ui_open_panel", "stack_ui_close_panel", "jsk.papercut", "handoff.force", "handoff.seal", "handoff.approve", "handoff.continue"]',
    'deny = ["codex.interrupt"]',
    "",
    "[handoff]",
    "force_enabled = true",
    "interrupt_worker = true",
    "steer_before_seal = true",
    "auto_approve = true",
    "auto_continue = false",
    'default_successor_role = "same"',
    "require_summary = true",
    "",
    "[handoff.force]",
    "allow_unbound_threads = true",
    "garden_summary_fallback = true",
    "confirm = false",
    "",
    "[permissions]",
    "inbox = true",
    "route = true",
    "steer = true",
    "queue = true",
    "papercut_mirror = true",
    "pause_worker = false",
    "meta_thread_lifecycle = true",
    "meta_thread_title = true",
    "",
    "[wake]",
    "on_turn_completed = true",
    "idle_ms = 300000",
    "on_inbox_pending = true",
    "on_garden_dirty = true",
    "",
    "[friction]",
    "turn_exit_nonzero = true",
    "rate_limit = true",
    "repeated_tool_error = true",
    "consecutive_turn_failures = true",
  ].join("\n")
}
