import { existsSync } from "node:fs"
import { resolve } from "node:path"
import type { StackConfig } from "./config.js"
import {
  stackdMissingEffortRefRouteMessage,
  stackdUpdateMetaThreadEffortRef,
  type StackdMetaThreadManifest,
} from "./client/stackd.js"
import { formatTokenTotal, sessionTokenTotal } from "./codex/usage-cost.js"
import {
  appendEffortProgress,
  appendEffortResearchLog,
  auditEffort,
  bindEffortMetaThread,
  createEffort,
  effortArtifactInventory,
  effortPathRefs,
  listEfforts,
  listEffortTemplates,
  readEffortAcceptancePacket,
  readEffort,
  readEffortActivityTail,
  readEffortBlockerTail,
  readEffortProgressTail,
  recordEffortBlocker,
  recordEffortCapture,
  recordEffortFinding,
  recordEffortIdea,
  recordEffortNote,
  recordEffortRepo,
  updateEffortRefs,
  updateEffortStatus,
  writeEffortEngineeringPacket,
  writeEffortHandoff,
  type StackEffortActivityRecord,
  type StackEffortAcceptancePacket,
  type StackEffortAudit,
  type StackEffortAuditStatus,
  type StackEffortBlockerRecord,
  type StackEffortCaptureKind,
  type StackEffort,
  type StackEffortFindingKind,
  type StackEffortFindingSourceReceipt,
  type StackEffortIdeaOrigin,
  type StackEffortNoteKind,
  type StackEffortSummary,
  type StackEffortStatus,
  type StackEffortTemplateSummary,
} from "./effort.js"
import { readMetaThreadManifest } from "./meta-thread-goal.js"
import { readRoundTripPullReceipt, type RoundTripPullReceiptRecord } from "./roundtrip.js"
import { ensureStackDefaults } from "./seed/defaults.js"

type ParsedFlags = {
  args: string[]
  flags: Map<string, string | true>
}

export async function runEffortCli(config: StackConfig, argv: string[]): Promise<number> {
  const [, action] = argv
  const parsed = parseFlags(argv.slice(2))
  const json = Boolean(parsed.flags.get("json"))
  const help = Boolean(parsed.flags.get("help") || parsed.flags.get("h"))
  const topHelp = action === "help" || action === "--help" || action === "-h"

  if (!action || topHelp || help) {
    printEffortUsage()
    return topHelp || help ? 0 : 2
  }

  ensureStackDefaults(config.stackDataRoot, config.appRoot)

  try {
    if (action === "list" || action === "ls") {
      const efforts = readEffortListItems(config)
      if (json) {
        console.log(JSON.stringify(efforts, null, 2))
      } else if (efforts.length === 0) {
        console.log("No Efforts yet.")
      } else {
        printEffortList(efforts)
      }
      return 0
    }

    if (action === "templates" || action === "template-list") {
      const templates = listEffortTemplates({
        stackDataRoot: config.stackDataRoot,
        appRoot: config.appRoot,
      })
      printEffortTemplates(templates, json)
      return 0
    }

    if (action === "create") {
      const slug = parsed.args[0]
      if (!slug) return usageError("usage: stack effort create <slug> [--template <id>] [--title <title>] [--topic <topic>] [--folder <path>]")
      const effort = createEffort({
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
        appRoot: config.appRoot,
        slug,
        title: readFlagString(parsed, "title") ?? titleFromSlug(slug),
        template: readFlagString(parsed, "template") ?? "research",
        topic: readFlagString(parsed, "topic"),
        folderRef: readFlagString(parsed, "folder"),
      })
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "show" || action === "get") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort show <effort>")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "audit" || action === "check") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort audit <effort> [--json]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      printEffortAudit(auditEffort(effort), json)
      return 0
    }

    if (action === "activity" || action === "timeline") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort activity <effort> [--limit <n>] [--json]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      printEffortActivity(effort, readFlagInteger(parsed, "limit") ?? 20, json)
      return 0
    }

    if (action === "bind") {
      const [ref, metaThreadId] = parsed.args
      if (!ref || !metaThreadId) return usageError("usage: stack effort bind <effort> <meta-thread-id>")
      const current = readEffort(config, ref)
      if (!current) return notFound(ref)
      try {
        await stackdUpdateMetaThreadEffortRef(metaThreadId, {
          effort_ref: current.manifest.id,
          actor_id: "operator",
          reason: readFlagString(parsed, "reason") ?? "stack effort bind",
        })
      } catch (error) {
        const routeMessage = stackdMissingEffortRefRouteMessage(error)
        if (routeMessage) {
          throw new Error(`${routeMessage}; Effort reverse index was not updated`)
        }
        throw error
      }
      const effort = bindEffortMetaThread({ ...config, effortRef: ref, metaThreadId })
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "progress") {
      const ref = parsed.args[0]
      const message = parsed.args.slice(1).join(" ").trim()
      if (!ref || !message) return usageError("usage: stack effort progress <effort> <message>")
      const effort = appendEffortProgress({ ...config, effortRef: ref, message })
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "blocker") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort blocker <effort> --blocker <text> --evidence <text> --owner <owner> --next <text>")
      const effort = recordEffortBlocker({
        ...config,
        effortRef: ref,
        blocker: readFlagString(parsed, "blocker") ?? "",
        evidence: readFlagString(parsed, "evidence") ?? "",
        owner: readFlagString(parsed, "owner") ?? "",
        next: readFlagString(parsed, "next") ?? "",
      })
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "research-log" || action === "log") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref || !title) return usageError("usage: stack effort research-log <effort> <title> --work-summary <text> [--operator-message <text>] [--result <text>] [--metric <text>] [--path <path>] [--command <command>] [--next <text>]")
      const workSummary = readFlagString(parsed, "work-summary")
      if (!workSummary) return usageError("stack effort research-log requires --work-summary <text>")
      const result = appendEffortResearchLog({
        ...config,
        effortRef: ref,
        title,
        operatorMessage: readFlagString(parsed, "operator-message"),
        workSummary,
        result: readFlagString(parsed, "result"),
        metrics: readFlagList(parsed, "metric"),
        paths: readFlagList(parsed, "path"),
        reproduceCommands: readFlagList(parsed, "command"),
        next: readFlagString(parsed, "next"),
      })
      await printArtifactResult(config, result.effort, result.path, json)
      return 0
    }

    if (action === "handoff") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort handoff <effort> [--summary <text>] [--risk <text>] [--next <text>] [--owner <text>]")
      const result = writeEffortHandoff({
        ...config,
        effortRef: ref,
        summary: readFlagString(parsed, "summary"),
        risks: readFlagList(parsed, "risk"),
        next: readFlagString(parsed, "next"),
        owner: readFlagString(parsed, "owner"),
      })
      await printArtifactResult(config, result.effort, result.path, json)
      return 0
    }

    if (action === "engineering-packet" || action === "change-packet" || action === "diff") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort engineering-packet <effort> [--repo <path>] [--base <ref>] [--summary <text>] [--file <path>] [--validation <text>] [--skipped-gate <text>] [--risk <text>] [--next <text>]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const repo = readFlagString(parsed, "repo")
      const result = writeEffortEngineeringPacket({
        ...config,
        effortRef: effort.manifest.id,
        summary: readFlagString(parsed, "summary"),
        repoPath: repo ? resolveCliEffortSourcePath(config, effort.folder_path, repo) : undefined,
        baseRef: readFlagString(parsed, "base"),
        files: readFlagList(parsed, "file"),
        diffStat: readFlagString(parsed, "diff-stat"),
        validations: readFlagList(parsed, "validation"),
        skippedGates: readFlagList(parsed, "skipped-gate"),
        risks: readFlagList(parsed, "risk"),
        next: readFlagString(parsed, "next"),
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json, undefined, undefined, undefined, {
        changed_files: result.changedFiles,
        diff_stat: result.diffStat,
        git_status: result.gitStatus,
      })
      return 0
    }

    if (action === "refs" || action === "link") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort refs <effort> [--factory-id <id>] [--hosted-effort-id <id>] [--project-id <id>] [--optimizer-run-id <id>] [--smr-run-id <id>] [--tinker-run-id <id>] [--repo-ref <ref>] [--initiative-id <id>]")
      const effort = updateEffortRefs({
        ...config,
        effortRef: ref,
        factoryId: readFlagString(parsed, "factory-id"),
        hostedEffortId: readFlagString(parsed, "hosted-effort-id"),
        projectId: readFlagString(parsed, "project-id"),
        optimizerRunId: readFlagString(parsed, "optimizer-run-id"),
        smrRunId: readFlagString(parsed, "smr-run-id"),
        tinkerRunId: readFlagString(parsed, "tinker-run-id"),
        repoRef: readFlagString(parsed, "repo-ref"),
        initiativeId: readFlagString(parsed, "initiative-id"),
      })
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "status") {
      const [ref, status] = parsed.args
      if (!ref || !status) return usageError("usage: stack effort status <effort> <active|paused|done|archived>")
      const effort = updateEffortStatus({ ...config, effortRef: ref, status: status as StackEffortStatus })
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "archive") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort archive <effort>")
      const effort = updateEffortStatus({ ...config, effortRef: ref, status: "archived" })
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "idea") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref || !title) return usageError("usage: stack effort idea <effort> <title> [--origin HUMAN|AGENT|MIXED] [--body <text>]")
      const result = recordEffortIdea({
        ...config,
        effortRef: ref,
        origin: (readFlagString(parsed, "origin") ?? "HUMAN") as StackEffortIdeaOrigin,
        title,
        body: readFlagString(parsed, "body"),
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json)
      return 0
    }

    if (action === "note") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref || !title) return usageError("usage: stack effort note <effort> <title> [--kind human|note] [--body <text>]")
      const result = recordEffortNote({
        ...config,
        effortRef: ref,
        kind: (readFlagString(parsed, "kind") ?? "note") as StackEffortNoteKind,
        title,
        body: readFlagString(parsed, "body"),
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json)
      return 0
    }

    if (action === "repo") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort repo <effort> --path <path> [--repo-ref <ref>] [--title <title>] [--filename <name>]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const rawSourcePath = readFlagString(parsed, "path")
      if (!rawSourcePath) return usageError("stack effort repo requires --path <path>")
      const result = recordEffortRepo({
        ...config,
        effortRef: effort.manifest.id,
        sourcePath: resolveCliEffortSourcePath(config, effort.folder_path, rawSourcePath),
        repoRef: readFlagString(parsed, "repo-ref"),
        title: readFlagString(parsed, "title"),
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json)
      return 0
    }

    if (action === "finding") {
      const ref = parsed.args[0]
      const title = (readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()) || "Finding"
      if (!ref) return usageError("usage: stack effort finding <effort> [title] --kind idea|code|data|proof|result [--path <path>|--receipt-path <path>] [--body <text>]")
      const kind = readFlagString(parsed, "kind")
      if (!kind) return usageError("stack effort finding requires --kind idea|code|data|proof|result")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const rawSourcePath = readFlagString(parsed, "path")
      const receiptPath = readFlagString(parsed, "receipt-path")
      if (rawSourcePath && receiptPath) return usageError("provide --path or --receipt-path, not both")
      const artifactReceipt = receiptPath ? await readRoundTripPullReceipt(config, receiptPath) : undefined
      const result = recordEffortFinding({
        ...config,
        effortRef: effort.manifest.id,
        kind: kind as StackEffortFindingKind,
        title,
        body: readFlagString(parsed, "body"),
        sourcePath: artifactReceipt
          ? artifactReceipt.workspace_path
          : rawSourcePath ? resolveCliEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined,
        sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json, artifactReceipt, result.sourceReceiptPath, result.sourceReceipt)
      return 0
    }

    if (action === "capture") {
      const ref = parsed.args[0]
      const title = (readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()) || "Capture"
      if (!ref) return usageError("usage: stack effort capture <effort> [title] --capture-kind terminal|browser|screenshot|video|local|monitor|memory|text|benchmark|optimizer [--kind idea|code|data|proof|result] [--path <path>|--receipt-path <path>|--body <text>]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const rawSourcePath = readFlagString(parsed, "path")
      const receiptPath = readFlagString(parsed, "receipt-path")
      if (rawSourcePath && receiptPath) return usageError("provide --path or --receipt-path, not both")
      const captureKind = (readFlagString(parsed, "capture-kind") ?? readFlagString(parsed, "capture") ?? "local") as StackEffortCaptureKind
      const artifactReceipt = receiptPath ? await readRoundTripPullReceipt(config, receiptPath) : undefined
      const result = recordEffortCapture({
        ...config,
        effortRef: effort.manifest.id,
        captureKind,
        findingKind: readFlagString(parsed, "kind") as StackEffortFindingKind | undefined,
        title,
        body: readFlagString(parsed, "body"),
        sourcePath: artifactReceipt
          ? artifactReceipt.workspace_path
          : rawSourcePath ? resolveCliEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined,
        sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json, artifactReceipt, result.sourceReceiptPath, result.sourceReceipt, {
        capture_kind: result.captureKind,
        kind: result.kind,
      })
      return 0
    }

    printEffortUsage()
    return 2
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

type EffortCliListItem = StackEffortSummary & {
  latest_progress: string
  latest_activity: StackEffortActivityRecord | null
  latest_blocker: StackEffortBlockerRecord | null
  audit_status: StackEffortAuditStatus
  audit_counts: {
    failures: number
    warnings: number
  }
  ref_counts: {
    meta_threads: number
    repos: number
    optimizer_runs: number
    smr_runs: number
    tinker_runs: number
  }
  artifact_counts: {
    total: number
    findings: number
    receipt_sidecars: number
  }
  has_handoff: boolean
  has_acceptance_summary: boolean
  acceptance_packet: StackEffortAcceptancePacket | null
}

function readEffortListItems(config: StackConfig): EffortCliListItem[] {
  return listEfforts(config).map((summary) => {
    const effort = readEffort(config, summary.id)
    if (!effort) {
      return {
        ...summary,
        latest_progress: "",
        latest_activity: null,
        latest_blocker: null,
        audit_status: "fail",
        audit_counts: {
          failures: 1,
          warnings: 0,
        },
        ref_counts: {
          meta_threads: summary.meta_thread_refs.length,
          repos: 0,
          optimizer_runs: summary.hosted_refs.optimizer_run_ids.length,
          smr_runs: summary.hosted_refs.smr_run_ids.length,
          tinker_runs: summary.hosted_refs.tinker_run_ids.length,
        },
        artifact_counts: {
          total: 0,
          findings: 0,
          receipt_sidecars: 0,
        },
        has_handoff: false,
        has_acceptance_summary: false,
        acceptance_packet: null,
      }
    }
    const progressTail = readEffortProgressTail(effort, 1)
    const activityTail = readEffortActivityTail(effort, 1)
    const blockerTail = readEffortBlockerTail(effort, 1)
    const audit = auditEffort(effort)
    const paths = effortPathRefs(effort)
    const artifactInventory = effortArtifactInventory(effort)
    const acceptancePacket = readEffortAcceptancePacket(effort) ?? null
    return {
      ...summary,
      latest_progress: progressTail[0] ?? "",
      latest_activity: activityTail[0] ?? null,
      latest_blocker: blockerTail[0] ?? null,
      audit_status: audit.status,
      audit_counts: {
        failures: audit.checks.filter((check) => check.status === "fail").length,
        warnings: audit.checks.filter((check) => check.status === "warn").length,
      },
      ref_counts: {
        meta_threads: effort.manifest.links.meta_thread_refs.length,
        repos: effort.manifest.links.repo_refs.length,
        optimizer_runs: effort.manifest.hosted.optimizer_run_ids.length,
        smr_runs: effort.manifest.hosted.smr_run_ids.length,
        tinker_runs: effort.manifest.hosted.tinker_run_ids.length,
      },
      artifact_counts: {
        total: artifactInventory.counts.total,
        findings: Object.values(artifactInventory.counts.findings).reduce((sum, count) => sum + count, 0),
        receipt_sidecars: artifactInventory.counts.receipt_sidecars,
      },
      has_handoff: existsSync(resolve(effort.folder_path, "HANDOFF.md")),
      has_acceptance_summary: Boolean(paths.acceptance_summary),
      acceptance_packet: acceptancePacket,
    }
  })
}

function printEffortList(efforts: EffortCliListItem[]): void {
  const statusOrder: StackEffortStatus[] = ["active", "paused", "done", "archived"]
  for (const status of statusOrder) {
    const group = efforts.filter((effort) => effort.status === status)
    if (group.length === 0) continue
    console.log(`${status}:`)
    for (const effort of group) {
      const details = [
        effort.template,
        formatEffortListAudit(effort),
        `threads ${effort.ref_counts.meta_threads}`,
        `artifacts ${effort.artifact_counts.total}`,
        `receipts ${effort.artifact_counts.receipt_sidecars}`,
        ...formatEffortListRefs(effort),
        `updated ${effort.updated_at}`,
      ]
      console.log(`  ${effort.slug} - ${effort.title}`)
      console.log(`    ${details.join(" - ")}`)
      if (effort.latest_progress) console.log(`    progress: ${clipCli(effort.latest_progress, 150)}`)
      if (effort.latest_activity) {
        console.log(`    activity: ${effort.latest_activity.observed_at} - ${effort.latest_activity.type} - ${clipCli(effort.latest_activity.summary, 120)}`)
      }
      if (effort.latest_blocker) {
        console.log(`    blocker: ${clipCli(effort.latest_blocker.blocker, 100)} - owner ${clipCli(effort.latest_blocker.owner, 40)} - next ${clipCli(effort.latest_blocker.next, 100)}`)
      }
      console.log(`    folder: ${effort.folder_ref}`)
    }
  }
}

function formatEffortListAudit(effort: EffortCliListItem): string {
  const counts = effort.audit_counts
  if (effort.audit_status === "pass") return "audit pass"
  if (effort.audit_status === "warn") return `audit warn ${counts.warnings}`
  return `audit fail ${counts.failures}`
}

function formatEffortListRefs(effort: EffortCliListItem): string[] {
  const refs: string[] = []
  if (effort.ref_counts.repos > 0) refs.push(`repos ${effort.ref_counts.repos}`)
  if (effort.ref_counts.optimizer_runs > 0) refs.push(`optimizer ${effort.ref_counts.optimizer_runs}`)
  if (effort.ref_counts.smr_runs > 0) refs.push(`smr ${effort.ref_counts.smr_runs}`)
  if (effort.ref_counts.tinker_runs > 0) refs.push(`tinker ${effort.ref_counts.tinker_runs}`)
  if (effort.has_handoff) refs.push("handoff")
  if (effort.acceptance_packet) refs.push(`acceptance ${formatAcceptancePacketCompact(effort.acceptance_packet)}`)
  else if (effort.has_acceptance_summary) refs.push("acceptance")
  return refs
}

function formatAcceptancePacketCompact(packet: StackEffortAcceptancePacket): string {
  if (packet.v1_status === "not_applicable") return packet.summary
  const openGraduation = packet.open_levels.filter((level) => ["A2", "A3", "A4"].includes(level))
  const graduation = openGraduation.length > 0 ? `grad open ${openGraduation.join("/")}` : `grad ${packet.graduation_status}`
  return `v1 ${packet.v1_status} ${graduation}`
}

function clipCli(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, Math.max(0, maxLength - 1))}...`
}

function formatEffortReceiptSourceLine(source: ReturnType<typeof effortArtifactInventory>["receipt_sources"][number]): string {
  const receipt = source.receipt
  const labels = [
    receipt.source_kind ?? "source",
    receipt.artifact_kind ?? "",
    receipt.environment ? `env ${receipt.environment}` : "",
  ].filter(Boolean).join(", ")
  const digest = receipt.digest?.sha256 ? ` - sha256 ${receipt.digest.sha256}` : ""
  return `${source.sidecar_path} -> ${source.finding_path} (${labels}) - source ${clipCli(receipt.workspace_path, 140)}${digest}`
}

async function printEffort(config: StackConfig, effort: StackEffort, json: boolean): Promise<void> {
  const paths = effortPathRefs(effort)
  const artifactInventory = effortArtifactInventory(effort)
  const progressTail = readEffortProgressTail(effort, 5)
  const activityTail = readEffortActivityTail(effort, 5)
  const blockerTail = readEffortBlockerTail(effort, 5)
  const acceptancePacket = readEffortAcceptancePacket(effort) ?? null
  const boundMetaThreads = await readBoundMetaThreadSummaries(config, effort)
  if (json) {
    console.log(JSON.stringify({
      effort,
      paths,
      artifact_inventory: artifactInventory,
      latest_progress: progressTail[progressTail.length - 1] ?? "",
      progress_tail: progressTail,
      latest_activity: activityTail[activityTail.length - 1] ?? null,
      activity_tail: activityTail,
      latest_blocker: blockerTail[blockerTail.length - 1] ?? null,
      blocker_tail: blockerTail,
      acceptance_packet: acceptancePacket,
      bound_meta_threads: boundMetaThreads,
    }, null, 2))
    return
  }
  console.log(`${effort.manifest.slug} - ${effort.manifest.status} - ${effort.manifest.title}`)
  console.log(`id: ${effort.manifest.id}`)
  console.log(`folder: ${effort.registry.folder_ref}`)
  console.log(`template: ${effort.manifest.template}`)
  if (effort.manifest.links.meta_thread_refs.length > 0) {
    console.log(`meta-threads: ${effort.manifest.links.meta_thread_refs.join(", ")}`)
  }
  if (boundMetaThreads.length > 0) {
    console.log("bound meta-threads:")
    for (const thread of boundMetaThreads) {
      console.log(`  ${formatBoundMetaThreadLine(thread)}`)
    }
  }
  if (effort.manifest.hosted.factory_id) console.log(`factory: ${effort.manifest.hosted.factory_id}`)
  if (effort.manifest.hosted.effort_id) console.log(`hosted-effort: ${effort.manifest.hosted.effort_id}`)
  if (effort.manifest.hosted.project_id) console.log(`project: ${effort.manifest.hosted.project_id}`)
  if (effort.manifest.hosted.optimizer_run_ids.length > 0) {
    console.log(`optimizer-runs: ${effort.manifest.hosted.optimizer_run_ids.join(", ")}`)
  }
  if (effort.manifest.hosted.smr_run_ids.length > 0) {
    console.log(`smr-runs: ${effort.manifest.hosted.smr_run_ids.join(", ")}`)
  }
  if (effort.manifest.hosted.tinker_run_ids.length > 0) {
    console.log(`tinker-runs: ${effort.manifest.hosted.tinker_run_ids.join(", ")}`)
  }
  if (effort.manifest.links.repo_refs.length > 0) {
    console.log(`repos: ${effort.manifest.links.repo_refs.join(", ")}`)
  }
  if (effort.manifest.links.initiative_id) console.log(`initiative: ${effort.manifest.links.initiative_id}`)
  console.log("paths:")
  console.log(`  playbook: ${paths.playbook}`)
  console.log(`  progress: ${paths.progress}`)
  console.log(`  activity: ${paths.activity}`)
  console.log(`  handoff: ${paths.handoff}`)
  if (paths.acceptance_summary) console.log(`  acceptance-summary: ${paths.acceptance_summary}`)
  if (paths.research_log) console.log(`  research-log: ${paths.research_log}`)
  console.log(`  ideas: ${paths.ideas}`)
  console.log(`  findings: ${Object.values(paths.findings).join(", ")}`)
  console.log(`artifacts: ${artifactInventory.counts.total} total - findings ${Object.values(artifactInventory.counts.findings).reduce((sum, count) => sum + count, 0)} - receipts ${artifactInventory.counts.receipt_sidecars} - generated ${artifactInventory.counts.generated}`)
  if (acceptancePacket) {
    console.log(`acceptance: ${acceptancePacket.summary}`)
    for (const level of acceptancePacket.levels) {
      const required = level.required_for_v1 ? " required-v1" : ""
      console.log(`  ${level.label}: ${formatAcceptanceLevelState(level.state)}${required} - ${level.title} - ${level.status}`)
    }
  }
  if (artifactInventory.receipt_sources.length > 0) {
    console.log("receipt sources:")
    for (const source of artifactInventory.receipt_sources.slice(0, 5)) {
      console.log(`  ${formatEffortReceiptSourceLine(source)}`)
    }
    if (artifactInventory.receipt_sources.length > 5) {
      console.log(`  ... ${artifactInventory.receipt_sources.length - 5} more`)
    }
  }
  if (progressTail.length > 0) {
    console.log("recent progress:")
    for (const line of progressTail) console.log(`  ${line}`)
  }
  if (activityTail.length > 0) {
    console.log("recent activity:")
    for (const activity of activityTail) console.log(`  ${activity.observed_at} - ${activity.type} - ${activity.summary}`)
  }
  if (blockerTail.length > 0) {
    console.log("recorded blockers:")
    for (const blocker of blockerTail) console.log(`  ${blocker.observed_at} - ${blocker.blocker} - owner ${blocker.owner} - next ${blocker.next}`)
  }
}

async function printArtifactResult(
  config: StackConfig,
  effort: StackEffort,
  path: string,
  json: boolean,
  artifactReceipt?: RoundTripPullReceiptRecord,
  sourceReceiptPath?: string,
  sourceReceipt?: StackEffortFindingSourceReceipt,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (json) {
    const paths = effortPathRefs(effort)
    const artifactInventory = effortArtifactInventory(effort)
    const progressTail = readEffortProgressTail(effort, 5)
    const activityTail = readEffortActivityTail(effort, 5)
    const blockerTail = readEffortBlockerTail(effort, 5)
    console.log(JSON.stringify({
      effort,
      path,
      paths,
      artifact_inventory: artifactInventory,
      latest_progress: progressTail[progressTail.length - 1] ?? "",
      progress_tail: progressTail,
      latest_activity: activityTail[activityTail.length - 1] ?? null,
      activity_tail: activityTail,
      latest_blocker: blockerTail[blockerTail.length - 1] ?? null,
      blocker_tail: blockerTail,
      bound_meta_threads: await readBoundMetaThreadSummaries(config, effort),
      artifact_receipt: artifactReceipt ?? null,
      source_receipt_path: sourceReceiptPath ?? null,
      source_receipt: sourceReceipt ?? null,
      ...(extra ?? {}),
    }, null, 2))
    return
  }
  await printEffort(config, effort, false)
  console.log(`artifact: ${path}`)
  if (typeof extra?.capture_kind === "string") console.log(`capture: ${extra.capture_kind}`)
  if (artifactReceipt) {
    console.log(`artifact receipt: ${artifactReceipt.receipt_path}`)
    console.log(`artifact source: ${artifactReceipt.workspace_path}`)
  }
  if (!artifactReceipt && sourceReceipt?.workspace_path) console.log(`artifact source: ${sourceReceipt.workspace_path}`)
  if (sourceReceiptPath) console.log(`artifact receipt record: ${sourceReceiptPath}`)
}

function printEffortActivity(effort: StackEffort, limit: number, json: boolean): void {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)))
  const paths = effortPathRefs(effort)
  const activity = readEffortActivityTail(effort, boundedLimit)
  if (json) {
    console.log(JSON.stringify({
      effort_id: effort.manifest.id,
      slug: effort.manifest.slug,
      status: effort.manifest.status,
      paths,
      count: activity.length,
      activity,
    }, null, 2))
    return
  }
  console.log(`${effort.manifest.slug} activity - ${activity.length} receipts - ${paths.activity}`)
  if (activity.length === 0) {
    console.log("No activity receipts recorded.")
    return
  }
  for (const entry of activity) {
    console.log(`${entry.observed_at} - ${entry.type} - ${entry.summary}`)
  }
}

function formatAcceptanceLevelState(state: StackEffortAcceptancePacket["levels"][number]["state"]): string {
  if (state === "not_recorded") return "not recorded"
  return state.replace(/_/g, " ")
}

function printEffortAudit(audit: StackEffortAudit, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(audit, null, 2))
    return
  }
  console.log(`${audit.slug} audit - ${audit.status} - ${audit.folder_ref}`)
  console.log(`counts: progress ${audit.counts.progress_entries} - activity ${audit.counts.activity_receipts} - blockers ${audit.counts.blockers} - findings ${Object.values(audit.counts.findings).reduce((sum, count) => sum + count, 0)} - receipts ${audit.counts.receipt_sidecars}`)
  if (audit.latest_blocker) {
    console.log(`latest blocker: ${audit.latest_blocker.blocker} - owner ${audit.latest_blocker.owner} - next ${audit.latest_blocker.next}`)
  }
  for (const check of audit.checks) {
    console.log(`[${check.status}] ${check.id}: ${check.summary}`)
    for (const evidence of check.evidence.slice(0, 6)) {
      console.log(`  - ${evidence}`)
    }
    if (check.evidence.length > 6) console.log(`  - ... ${check.evidence.length - 6} more`)
  }
}

type EffortCliBoundMetaThread = {
  id: string
  title: string
  lifecycle_status: string
  active_goal: { objective: string; status: string } | null
  head_thread_id: string | null
  head_segment_id: string | null
  smr_run_id: string | null
  monitor_profile: string | null
  usage_tokens: number
  updated_at: string | null
  missing?: boolean
}

async function readBoundMetaThreadSummaries(
  config: StackConfig,
  effort: StackEffort,
): Promise<EffortCliBoundMetaThread[]> {
  return Promise.all(
    effort.manifest.links.meta_thread_refs.map(async (metaThreadId) => {
      const manifest = await readMetaThreadManifest(config.stackDataRoot, metaThreadId)
      if (!manifest) {
        return {
          id: metaThreadId,
          title: "",
          lifecycle_status: "missing",
          active_goal: null,
          head_thread_id: null,
          head_segment_id: null,
          smr_run_id: null,
          monitor_profile: null,
          usage_tokens: 0,
          updated_at: null,
          missing: true,
        }
      }
      return boundMetaThreadSummary(manifest)
    }),
  )
}

function boundMetaThreadSummary(manifest: StackdMetaThreadManifest): EffortCliBoundMetaThread {
  const usage = manifest.usage_summary
  return {
    id: manifest.id,
    title: manifest.title ?? "",
    lifecycle_status: manifest.lifecycle_status ?? "live",
    active_goal: manifest.active_goal
      ? {
          objective: manifest.active_goal.objective ?? "",
          status: manifest.active_goal.status ?? "active",
        }
      : null,
    head_thread_id: manifest.head_thread_id ?? null,
    head_segment_id: manifest.head_segment_id ?? null,
    smr_run_id: manifest.smr_run_id ?? null,
    monitor_profile: manifest.monitor_profile ?? null,
    usage_tokens: usage ? sessionTokenTotal(usage.totals) : 0,
    updated_at: manifest.updated_at ?? null,
  }
}

function formatBoundMetaThreadLine(thread: EffortCliBoundMetaThread): string {
  if (thread.missing) return `${thread.id} - missing manifest`
  const parts = [thread.id, thread.lifecycle_status]
  const goal = thread.active_goal
  if (goal?.objective.trim()) parts.push(`${goal.status}: ${goal.objective.trim()}`)
  else if (thread.title.trim()) parts.push(thread.title.trim())
  if (thread.usage_tokens > 0) parts.push(`${formatTokenTotal(thread.usage_tokens)} tok`)
  if (thread.updated_at) parts.push(`updated ${thread.updated_at}`)
  return parts.join(" - ")
}

function resolveCliEffortSourcePath(config: StackConfig, effortFolderPath: string, rawPath: string): string {
  const inEffort = resolve(effortFolderPath, rawPath)
  if (existsSync(inEffort)) return inEffort
  const inShellCwd = resolve(rawPath)
  if (existsSync(inShellCwd)) return inShellCwd
  return resolve(config.workingDir, rawPath)
}

function effortSourceReceiptFromRoundTrip(receipt: RoundTripPullReceiptRecord): StackEffortFindingSourceReceipt {
  return {
    receipt_path: receipt.receipt_path,
    artifact_kind: receipt.artifact_kind,
    source_kind: receipt.source_kind,
    environment: receipt.environment,
    run_id: receipt.run_id ?? null,
    project_id: receipt.project_id ?? null,
    artifact_name: receipt.artifact_name ?? null,
    output_id: receipt.output_id ?? null,
    label: receipt.label ?? null,
    workspace_path: receipt.workspace_path,
    digest: receipt.digest,
    pulled_at: receipt.pulled_at,
  }
}

function printEffortUsage(): void {
  console.error("usage: stack effort <command>")
  console.error("  stack effort create <slug> [--template <id>] [--title <title>] [--topic <topic>] [--folder <path>]")
  console.error("  stack effort list [--json]")
  console.error("  stack effort templates [--json]")
  console.error("  stack effort show <effort> [--json]")
  console.error("  stack effort audit <effort> [--json]")
  console.error("  stack effort activity <effort> [--limit <n>] [--json]")
  console.error("  stack effort bind <effort> <meta-thread-id>")
  console.error("  stack effort progress <effort> <message>")
  console.error("  stack effort blocker <effort> --blocker <text> --evidence <text> --owner <owner> --next <text>")
  console.error("  stack effort research-log <effort> <title> --work-summary <text> [--operator-message <text>] [--result <text>] [--metric <text>] [--path <path>] [--command <command>] [--next <text>]")
  console.error("  stack effort handoff <effort> [--summary <text>] [--risk <text>] [--next <text>] [--owner <text>]")
  console.error("  stack effort engineering-packet <effort> [--repo <path>] [--base <ref>] [--summary <text>] [--file <path>] [--validation <text>] [--skipped-gate <text>] [--risk <text>] [--next <text>]")
  console.error("  stack effort refs <effort> [--factory-id <id>] [--hosted-effort-id <id>] [--project-id <id>] [--optimizer-run-id <id>] [--smr-run-id <id>] [--tinker-run-id <id>] [--repo-ref <ref>] [--initiative-id <id>]")
  console.error("  stack effort idea <effort> <title> [--origin HUMAN|AGENT|MIXED] [--body <text>]")
  console.error("  stack effort note <effort> <title> [--kind human|note] [--body <text>]")
  console.error("  stack effort repo <effort> --path <path> [--repo-ref <ref>] [--title <title>] [--filename <name>]")
  console.error("  stack effort finding <effort> [title] --kind idea|code|data|proof|result [--path <path>|--receipt-path <path>] [--body <text>]")
  console.error("  stack effort capture <effort> [title] --capture-kind terminal|browser|screenshot|video|local|monitor|memory|text|benchmark|optimizer [--kind idea|code|data|proof|result] [--path <path>|--receipt-path <path>|--body <text>]")
  console.error("  stack effort status <effort> <active|paused|done|archived>")
  console.error("  stack effort archive <effort>")
}

function printEffortTemplates(templates: StackEffortTemplateSummary[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ count: templates.length, templates }, null, 2))
    return
  }
  if (templates.length === 0) {
    console.log("No Effort templates found.")
    return
  }
  for (const template of templates) {
    const details = [
      template.source,
      template.research_log ? "research-log" : "no-research-log",
      `${template.findings.length} finding dirs`,
      `${template.acceptance_criteria.length} acceptance criteria`,
    ]
    if (template.installed_shadowed) details.push("installed copy ignored")
    console.log(`${template.id} - ${template.label} - ${details.join(" - ")}`)
  }
}

function parseFlags(argv: string[]): ParsedFlags {
  const args: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg?.startsWith("-")) {
      if (arg) args.push(arg)
      continue
    }
    const name = arg.replace(/^-+/, "")
    const next = argv[index + 1]
    if (next && !next.startsWith("-")) {
      const existing = flags.get(name)
      flags.set(name, typeof existing === "string" ? `${existing}\n${next}` : next)
      index += 1
    } else {
      flags.set(name, true)
    }
  }
  return { args, flags }
}

function readFlagString(parsed: ParsedFlags, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readFlagList(parsed: ParsedFlags, name: string): string[] | undefined {
  const value = readFlagString(parsed, name)
  if (!value) return undefined
  return value.split(/;|\n/).map((entry) => entry.trim()).filter(Boolean)
}

function readFlagInteger(parsed: ParsedFlags, name: string): number | undefined {
  const value = readFlagString(parsed, name)
  if (!value) return undefined
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) ? parsedValue : undefined
}

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function usageError(message: string): number {
  console.error(message)
  return 2
}

function notFound(ref: string): number {
  console.error(`effort not found: ${ref}`)
  return 1
}
