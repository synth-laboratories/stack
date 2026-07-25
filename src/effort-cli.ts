import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { sessionHistoryScanDirs, type StackConfig } from "./config.js"
import { artifactsRoot, readLatestArtifacts } from "./artifacts.js"
import {
  stackdMissingEffortRefRouteMessage,
  stackdUpdateMetaThreadEffortRef,
  type StackdMetaThreadManifest,
} from "./client/stackd.js"
import { buildSessionUsageSummary, formatTokenTotal, sessionTokenTotal } from "./codex/usage-cost.js"
import { readSessionLog } from "./session.js"
import {
  EFFORT_LAUNCH_CAPABILITIES,
  STACK_EFFORT_STATUSES,
  appendEffortProgress,
  effortScopeLanes,
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
  readEffortBenchmarkSummaries,
  readEffortBlockerTail,
  readEffortOpenBlockerTail,
  readEffortOptimizerCandidateSummaries,
  readEffortSessionTail,
  parseEffortLaunchCapability,
  readEffortProgressTail,
  readEffortReleaseArtifactSummaries,
  readEffortRemainingWork,
  readEffortRunEvidenceSummaries,
  refreshEffortReceiptDigests,
  recordEffortAcceptance,
  recordEffortArtifact,
  recordEffortBenchmark,
  recordEffortBlocker,
  recordEffortCapture,
  recordEffortFinding,
  recordEffortIdea,
  recordEffortNote,
  recordEffortOptimizerCandidate,
  recordEffortReleaseArtifact,
  recordEffortRepo,
  recordEffortRunEvidence,
  recordEffortSession,
  resolveEffortBlocker,
  updateEffortRefs,
  updateEffortScope,
  updateEffortStatus,
  writeEffortEngineeringPacket,
  writeEffortHandoff,
  type StackEffortActivityRecord,
  type StackEffortAcceptancePacket,
  type StackEffortAcceptanceUpdateState,
  type StackEffortAudit,
  type StackEffortAuditStatus,
  type StackEffortBenchmarkSummary,
  type StackEffortBlockerRecord,
  type StackEffortCaptureKind,
  type StackEffort,
  type StackEffortFindingKind,
  type StackEffortFindingSourceReceipt,
  type StackEffortIdeaOrigin,
  type StackEffortNoteKind,
  type StackEffortOptimizerCandidateSummary,
  type StackEffortReleaseArtifactSummary,
  type StackEffortRemainingWork,
  type StackEffortRunEvidenceSummary,
  type StackEffortSessionRecord,
  type StackEffortSummary,
  type StackEffortStatus,
  type StackEffortTemplateSummary,
} from "./effort.js"
import { EFFORT_LAUNCH_KINDS, launchEffortRun, type EffortLaunchKind } from "./effort-launch.js"
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
      if (!slug) return usageError("usage: stack effort create <slug> [--template <id>] [--title <title>] [--short-title <10chars>] [--topic <topic>] [--folder <path>]")
      const effort = createEffort({
        stackDataRoot: config.stackDataRoot,
        workspaceRoot: config.workspaceRoot,
        appRoot: config.appRoot,
        slug,
        title: readFlagString(parsed, "title") ?? titleFromSlug(slug),
        shortTitle: readFlagString(parsed, "short-title") ?? readFlagString(parsed, "short_title"),
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

    if (action === "remaining" || action === "remains" || action === "what-remains") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort remaining <effort> [--json]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      printEffortRemaining(effort, json)
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

    if (action === "refresh-receipts" || action === "receipt-refresh" || action === "receipts") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort refresh-receipts <effort> [--json]")
      const result = refreshEffortReceiptDigests({ ...config, effortRef: ref })
      if (json) {
        console.log(JSON.stringify({
          receipt_refresh: {
            checked: result.checked,
            updated: result.updated,
            skipped: result.skipped,
            refreshed: result.refreshed,
          },
          effort: result.effort,
        }, null, 2))
      } else {
        console.log(`receipt digests: ${result.updated} updated - ${result.checked} checked - ${result.skipped.length} skipped`)
        for (const entry of result.refreshed.slice(0, 10)) {
          console.log(`  refreshed ${entry.sidecar_path} -> ${entry.finding_path}`)
        }
        if (result.refreshed.length > 10) console.log(`  ... ${result.refreshed.length - 10} more`)
        await printEffort(config, result.effort, false)
      }
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

    if (action === "effort-session" || action === "effort-sessions" || action === "session" || action === "start-session") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref || !title) return usageError("usage: stack effort effort-session <effort> <title> [--session-id <id>] [--actor <actor>] [--kind <kind>] [--parent-session-id <id>] [--tag <tag>] [--summary <text>] [--payload-json <json>]")
      const result = recordEffortSession({
        ...config,
        effortRef: ref,
        sessionId: readFlagString(parsed, "session-id"),
        title,
        actor: readFlagString(parsed, "actor"),
        kind: readFlagString(parsed, "kind"),
        summary: readFlagString(parsed, "summary"),
        parentSessionId: readFlagString(parsed, "parent-session-id"),
        tags: readFlagList(parsed, "tag"),
        payload: readFlagJsonObject(parsed, "payload-json"),
      })
      if (json) {
        console.log(JSON.stringify({
          effort: result.effort,
          session: result.session,
          path: result.path,
        }, null, 2))
      } else {
        console.log(`effort_session: ${result.session.session_id}`)
        console.log(`path: ${result.path}`)
        await printEffort(config, result.effort, false)
      }
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

    if (action === "resolve-blocker" || action === "blocker-resolve" || action === "unblock") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort resolve-blocker <effort> --resolution <text> [--activity-id <id>] [--evidence <text>] [--owner <owner>]")
      const effort = resolveEffortBlocker({
        ...config,
        effortRef: ref,
        blockerActivityId: readFlagString(parsed, "activity-id"),
        resolution: readFlagString(parsed, "resolution") ?? "",
        evidence: readFlagString(parsed, "evidence"),
        owner: readFlagString(parsed, "owner"),
      })
      await printEffort(config, effort, json)
      return 0
    }

    if (action === "acceptance") {
      const ref = parsed.args[0]
      const level = readFlagString(parsed, "level") ?? parsed.args[1]
      if (!ref || !level) return usageError("usage: stack effort acceptance <effort> <A0|A1|A2...> [--state recorded|pending|not_recorded] [--status <text>] [--evidence <text>] [--path <path>] [--result <text>] [--decision <text>] [--next <text>]")
      const result = recordEffortAcceptance({
        ...config,
        effortRef: ref,
        level,
        state: (readFlagString(parsed, "state") ?? "recorded") as StackEffortAcceptanceUpdateState,
        status: readFlagString(parsed, "status"),
        evidence: readFlagList(parsed, "evidence"),
        paths: readFlagList(parsed, "path"),
        result: readFlagString(parsed, "result"),
        decision: readFlagString(parsed, "decision"),
        next: readFlagString(parsed, "next"),
      })
      await printArtifactResult(config, result.effort, result.path, json, undefined, undefined, undefined, {
        acceptance_level: result.level,
        acceptance_state: result.state,
        acceptance_status: result.status,
      })
      return 0
    }

    if (action === "research-log" || action === "log") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref || !title) return usageError("usage: stack effort research-log <effort> <title> --work-summary <text> [--session-id <id>] [--operator-message <text>] [--result <text>] [--metric <text>] [--path <path>] [--command <command>] [--next <text>]")
      const workSummary = readFlagString(parsed, "work-summary")
      if (!workSummary) return usageError("stack effort research-log requires --work-summary <text>")
      const sessionId = readFlagString(parsed, "session-id")
      const result = appendEffortResearchLog({
        ...config,
        effortRef: ref,
        title,
        sessionId,
        operatorMessage: readFlagString(parsed, "operator-message"),
        workSummary,
        result: readFlagString(parsed, "result"),
        metrics: readFlagList(parsed, "metric"),
        paths: readFlagList(parsed, "path"),
        reproduceCommands: readFlagList(parsed, "command"),
        next: readFlagString(parsed, "next"),
      })
      await printArtifactResult(config, result.effort, result.path, json, undefined, undefined, undefined, {
        ...(sessionId ? { session_id: sessionId } : {}),
      })
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

    if (action === "export-usage" || action === "usage-export") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort export-usage <effort> --session-id <id> --packet <path> [--json]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const sessionId = readFlagString(parsed, "session-id")
      const packet = readFlagString(parsed, "packet")
      if (!sessionId) return usageError("stack effort export-usage requires --session-id <id>")
      if (!packet) return usageError("stack effort export-usage requires --packet <path>")
      const result = await exportEffortUsageToPacket(config, {
        effortRef: effort.manifest.id,
        sessionId,
        packet,
      })
      if (json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(`worker_usage: ${result.worker_usage_path}`)
        console.log(`session_id: ${result.session_id}`)
        console.log(`total_tokens: ${result.tokens.total_tokens}`)
      }
      return 0
    }

    if (action === "refs" || action === "link") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort refs <effort> [--system <system> --id <id> [--role <role>]] [--lane hosted|local] [--factory-id <id>] [--hosted-effort-id <id>] [--project-id <id>] [--optimizer-run-id <id>] [--smr-run-id <id>] [--tinker-run-id <id>] [--repo-ref <ref>] [--initiative-id <id>]")
      const system = readFlagString(parsed, "system")
      const refId = readFlagString(parsed, "id")
      if ((system && !refId) || (!system && refId)) return usageError("provide --system and --id together")
      const effort = updateEffortRefs({
        ...config,
        effortRef: ref,
        refs: system && refId
          ? [{ system, id: refId, lane: readFlagString(parsed, "lane"), role: readFlagString(parsed, "role") }]
          : undefined,
        refLane: readFlagString(parsed, "lane"),
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

    if (action === "scope") {
      const ref = parsed.args[0]
      if (!ref) return usageError("usage: stack effort scope <effort> [--capabilities <a,b,c>] [--json]")
      const rawCapabilities = readFlagString(parsed, "capabilities")
      if (parsed.flags.has("capabilities") && !rawCapabilities) {
        return usageError(`stack effort scope --capabilities requires a comma-separated list; valid capabilities: ${EFFORT_LAUNCH_CAPABILITIES.join(", ")}`)
      }
      const effort = rawCapabilities !== undefined
        ? updateEffortScope({ ...config, effortRef: ref, capabilities: rawCapabilities.split(",") })
        : readEffort(config, ref)
      if (!effort) return notFound(ref)
      const capabilities = effort.manifest.scope.capabilities
      const lanes = effortScopeLanes(effort.manifest)
      if (json) {
        console.log(JSON.stringify({
          ok: true,
          effort_id: effort.manifest.id,
          slug: effort.manifest.slug,
          scope: effort.manifest.scope,
          lanes,
        }, null, 2))
      } else {
        console.log(`${effort.manifest.slug} scope:`)
        console.log(`  capabilities: ${capabilities.join(", ")}`)
        console.log(`  lanes: ${lanes.join(", ") || "none"}`)
      }
      return 0
    }

    if (action === "launch") {
      const ref = parsed.args[0]
      const usage = `usage: stack effort launch <effort> --kind ${EFFORT_LAUNCH_KINDS.join("|")} --capability <${EFFORT_LAUNCH_CAPABILITIES.join("|")}> [--config <gepa toml path>] [--tunnel-url <url>] [--container-pool <id>] [--goal <text>] [--project-id <id>] [--factory-id <id>] [--request-json <json>] [--name <name>] [--description <text>] [--status <status>] [--pool <id>] [--task-id <id>] [--split <name>] [--seed <n>] [--policy-name <name>] [--policy-config-json <json>] [--image-ref <ref>|--service-url <url>] [--runtime-kind <kind>] [--release-name <name>] [--provider <name>] [--json]`
      if (!ref) return usageError(usage)
      const kind = readFlagString(parsed, "kind")
      if (!kind || !(EFFORT_LAUNCH_KINDS as readonly string[]).includes(kind)) return usageError(usage)
      const capability = readFlagString(parsed, "capability")
      if (!capability) return usageError(usage)
      const result = await launchEffortRun(config, {
        effortRef: ref,
        kind: kind as EffortLaunchKind,
        capability: parseEffortLaunchCapability(capability),
        configPath: readFlagString(parsed, "config"),
        tunnelUrl: readFlagString(parsed, "tunnel-url"),
        containerPool: readFlagString(parsed, "container-pool"),
        goal: readFlagString(parsed, "goal"),
        projectId: readFlagString(parsed, "project-id"),
        factoryId: readFlagString(parsed, "factory-id"),
        poolId: readFlagString(parsed, "pool"),
        taskId: readFlagString(parsed, "task-id"),
        split: readFlagString(parsed, "split"),
        seed: readFlagInteger(parsed, "seed"),
        policyName: readFlagString(parsed, "policy-name"),
        policyConfig: readFlagJsonObject(parsed, "policy-config-json"),
        request: readFlagJsonObject(parsed, "request-json"),
        name: readFlagString(parsed, "name"),
        description: readFlagString(parsed, "description"),
        status: readFlagString(parsed, "status"),
        imageRef: readFlagString(parsed, "image-ref"),
        serviceUrl: readFlagString(parsed, "service-url"),
        runtimeKind: readFlagString(parsed, "runtime-kind"),
        releaseName: readFlagString(parsed, "release-name"),
        provider: readFlagString(parsed, "provider"),
        archiveBase64: readFlagString(parsed, "archive-base64"),
        sourceStorageUri: readFlagString(parsed, "source-storage-uri"),
        dockerfilePath: readFlagString(parsed, "dockerfile-path"),
        baseImageRef: readFlagString(parsed, "base-image-ref"),
      })
      if (json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(`launch ${result.ok ? "submitted" : "failed"} - kind ${result.kind} - lane ${result.lane} - capability ${result.capability}`)
        if (result.id) console.log(`id: ${result.id}`)
        console.log(`message: ${result.message}`)
        if (result.ref) {
          console.log(`recorded: ref ${result.ref.system}=${result.ref.id} lane=${result.ref.lane} role=${result.ref.role} in ${result.recorded_in}/effort.toml and ACTIVITY.jsonl`)
        }
      }
      return result.ok ? 0 : 1
    }

    if (action === "status") {
      const [ref, status] = parsed.args
      if (!ref || !status) return usageError("usage: stack effort status <effort> <active|paused|done|archived>")
      const parsedStatus = parseCliEffortStatus(status)
      if (!parsedStatus.ok) return usageError(parsedStatus.message)
      const effort = updateEffortStatus({ ...config, effortRef: ref, status: parsedStatus.status })
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

    if (action === "benchmark") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref) return usageError("usage: stack effort benchmark <effort> [title] [--benchmark-id <id>] [--name <name>] [--version <version>] [--source <url-or-ref>] [--license <license>] [--task-shape <text>] [--split <name>] [--metric <name>] [--path <path>|--receipt-path <path>] [--body <text>]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const rawSourcePath = readFlagString(parsed, "path")
      const receiptPath = readFlagString(parsed, "receipt-path")
      if (rawSourcePath && receiptPath) return usageError("provide --path or --receipt-path, not both")
      const artifactReceipt = receiptPath ? await readRoundTripPullReceipt(config, receiptPath) : undefined
      const result = recordEffortBenchmark({
        ...config,
        effortRef: effort.manifest.id,
        title,
        benchmarkId: readFlagString(parsed, "benchmark-id"),
        name: readFlagString(parsed, "name"),
        version: readFlagString(parsed, "version"),
        source: readFlagString(parsed, "source"),
        license: readFlagString(parsed, "license"),
        taskShape: readFlagString(parsed, "task-shape"),
        splits: readFlagList(parsed, "split"),
        metrics: readFlagList(parsed, "metric"),
        body: readFlagString(parsed, "body"),
        sourcePath: artifactReceipt
          ? artifactReceipt.workspace_path
          : rawSourcePath ? resolveCliEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined,
        sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json, artifactReceipt, result.sourceReceiptPath, result.sourceReceipt, {
        benchmark_id: result.benchmarkId,
        name: result.name,
        version: result.version,
        source: result.source,
        license: result.license,
        task_shape: result.taskShape,
        splits: result.splits,
        metrics: result.metrics,
      })
      return 0
    }

    if (action === "optimizer-candidate" || action === "candidate") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref) return usageError("usage: stack effort optimizer-candidate <effort> [title] [--optimizer-run-id <id>] [--candidate-id <id>] [--score <value>] [--score-label <name>] [--split <name>] [--path <path>|--receipt-path <path>] [--body <text>]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const rawSourcePath = readFlagString(parsed, "path")
      const receiptPath = readFlagString(parsed, "receipt-path")
      if (rawSourcePath && receiptPath) return usageError("provide --path or --receipt-path, not both")
      const artifactReceipt = receiptPath ? await readRoundTripPullReceipt(config, receiptPath) : undefined
      const result = recordEffortOptimizerCandidate({
        ...config,
        effortRef: effort.manifest.id,
        title,
        optimizerRunId: readFlagString(parsed, "optimizer-run-id"),
        candidateId: readFlagString(parsed, "candidate-id"),
        score: readFlagString(parsed, "score"),
        scoreLabel: readFlagString(parsed, "score-label"),
        split: readFlagString(parsed, "split"),
        body: readFlagString(parsed, "body"),
        sourcePath: artifactReceipt
          ? artifactReceipt.workspace_path
          : rawSourcePath ? resolveCliEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined,
        sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json, artifactReceipt, result.sourceReceiptPath, result.sourceReceipt, {
        optimizer_run_id: result.optimizerRunId,
        candidate_id: result.candidateId,
        score: result.score,
        score_label: result.scoreLabel,
        split: result.split,
      })
      return 0
    }

    if (action === "run-evidence" || action === "smr-evidence" || action === "tinker-evidence") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref) return usageError("usage: stack effort run-evidence <effort> [title] --run-kind <system> [--run-id <id>] [--project-id <id>] [--output-id <id>] [--artifact-name <name>] [--metric <text>] [--acceptance-level <claim>] [--path <path>|--receipt-path <path>] [--body <text>]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const rawSourcePath = readFlagString(parsed, "path")
      const receiptPath = readFlagString(parsed, "receipt-path")
      if (rawSourcePath && receiptPath) return usageError("provide --path or --receipt-path, not both")
      const artifactReceipt = receiptPath ? await readRoundTripPullReceipt(config, receiptPath) : undefined
      const runKind = readRunEvidenceKind(parsed, action)
      const result = recordEffortRunEvidence({
        ...config,
        effortRef: effort.manifest.id,
        runKind,
        title,
        runId: readFlagString(parsed, "run-id"),
        projectId: readFlagString(parsed, "project-id"),
        outputId: readFlagString(parsed, "output-id"),
        artifactName: readFlagString(parsed, "artifact-name"),
        metric: readFlagString(parsed, "metric"),
        acceptanceLevel: readFlagString(parsed, "acceptance-level"),
        body: readFlagString(parsed, "body"),
        sourcePath: artifactReceipt
          ? artifactReceipt.workspace_path
          : rawSourcePath ? resolveCliEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined,
        sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json, artifactReceipt, result.sourceReceiptPath, result.sourceReceipt, {
        run_kind: result.runKind,
        run_id: result.runId,
        project_id: result.projectId,
        output_id: result.outputId,
        artifact_name: result.artifactName,
        metric: result.metric,
        acceptance_level: result.acceptanceLevel,
      })
      return 0
    }

    if (action === "release-artifact" || action === "release-proof") {
      const ref = parsed.args[0]
      const title = readFlagString(parsed, "title") ?? parsed.args.slice(1).join(" ").trim()
      if (!ref) return usageError("usage: stack effort release-artifact <effort> [title] [--version <version>] [--channel <channel>] [--target <triple>] [--archive <path-or-url>] [--sha256 <hex>] [--size <bytes>] [--manifest <path-or-url>] [--release-site <path-or-url>] [--publishable true|false] [--publish-blocker <text>] [--path <path>|--receipt-path <path>] [--body <text>]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const rawSourcePath = readFlagString(parsed, "path")
      const receiptPath = readFlagString(parsed, "receipt-path")
      if (rawSourcePath && receiptPath) return usageError("provide --path or --receipt-path, not both")
      const artifactReceipt = receiptPath ? await readRoundTripPullReceipt(config, receiptPath) : undefined
      const result = recordEffortReleaseArtifact({
        ...config,
        effortRef: effort.manifest.id,
        title,
        version: readFlagString(parsed, "version"),
        channel: readFlagString(parsed, "channel"),
        target: readFlagString(parsed, "target"),
        archive: readFlagString(parsed, "archive"),
        sha256: readFlagString(parsed, "sha256"),
        size: readFlagString(parsed, "size"),
        manifest: readFlagString(parsed, "manifest"),
        releaseSite: readFlagString(parsed, "release-site"),
        publishable: readFlagBoolean(parsed, "publishable"),
        publishBlockers: readFlagList(parsed, "publish-blocker"),
        body: readFlagString(parsed, "body"),
        sourcePath: artifactReceipt
          ? artifactReceipt.workspace_path
          : rawSourcePath ? resolveCliEffortSourcePath(config, effort.folder_path, rawSourcePath) : undefined,
        sourceReceipt: artifactReceipt ? effortSourceReceiptFromRoundTrip(artifactReceipt) : undefined,
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json, artifactReceipt, result.sourceReceiptPath, result.sourceReceipt, {
        version: result.version,
        channel: result.channel,
        target: result.target,
        archive: result.archive,
        sha256: result.sha256,
        size: result.size,
        manifest: result.manifest,
        release_site: result.releaseSite,
        publishable: result.publishable,
        publish_blockers: result.publishBlockers,
      })
      return 0
    }

    if (action === "artifact" || action === "artifact-page") {
      const ref = parsed.args[0]
      const slug = readFlagString(parsed, "slug") ?? parsed.args[1]
      if (!ref || !slug) return usageError("usage: stack effort artifact <effort> --slug <page> [--split <name>] [--body <text>]")
      const effort = readEffort(config, ref)
      if (!effort) return notFound(ref)
      const artifact = readLatestArtifacts(config).find((entry) => entry.slug === slug)
      if (!artifact) return usageError(`artifact page not found: ${slug}`)
      const result = recordEffortArtifact({
        ...config,
        effortRef: effort.manifest.id,
        slug: artifact.slug,
        title: artifact.title,
        localUrl: artifact.local_url,
        hostedUrl: artifact.hosted_url,
        hostedArtifactId: artifact.hosted_artifact_id,
        artifactVersion: artifact.artifact_version ? String(artifact.artifact_version) : undefined,
        sha256: artifact.sha256,
        splitsCited: readFlagList(parsed, "split"),
        body: readFlagString(parsed, "body"),
        sourcePath: join(artifactsRoot(config), artifact.page_path),
        filename: readFlagString(parsed, "filename"),
      })
      await printArtifactResult(config, result.effort, result.path, json, undefined, result.sourceReceiptPath, result.sourceReceipt, {
        source_kind: "artifact.webpage",
        slug: result.slug,
        local_url: result.localUrl,
        hosted_url: result.hostedUrl,
        hosted_artifact_id: result.hostedArtifactId,
        artifact_version: result.artifactVersion,
        sha256: result.sha256,
        splits_cited: result.splitsCited,
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
    external_refs: number
  }
  artifact_counts: {
    total: number
    findings: number
    receipt_sidecars: number
  }
  has_handoff: boolean
  has_acceptance_summary: boolean
  acceptance_packet: StackEffortAcceptancePacket | null
  latest_optimizer_candidate: StackEffortOptimizerCandidateSummary | null
  latest_run_evidence: StackEffortRunEvidenceSummary | null
  latest_benchmark: StackEffortBenchmarkSummary | null
  latest_release_artifact: StackEffortReleaseArtifactSummary | null
  remaining_work: StackEffortRemainingWork
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
          external_refs: summary.refs.length,
        },
        artifact_counts: {
          total: 0,
          findings: 0,
          receipt_sidecars: 0,
        },
        has_handoff: false,
        has_acceptance_summary: false,
        acceptance_packet: null,
        latest_optimizer_candidate: null,
        latest_run_evidence: null,
        latest_benchmark: null,
        latest_release_artifact: null,
        remaining_work: missingEffortRemainingWork(),
      }
    }
    const progressTail = readEffortProgressTail(effort, 1)
    const activityTail = readEffortActivityTail(effort, 1)
    const blockerTail = readEffortOpenBlockerTail(effort, 1)
    const audit = auditEffort(effort)
    const paths = effortPathRefs(effort)
    const artifactInventory = effortArtifactInventory(effort)
    const acceptancePacket = readEffortAcceptancePacket(effort) ?? null
    const optimizerCandidates = readEffortOptimizerCandidateSummaries(effort, 1)
    const runEvidence = readEffortRunEvidenceSummaries(effort, 1)
    const benchmarks = readEffortBenchmarkSummaries(effort, 1)
    const releaseArtifacts = readEffortReleaseArtifactSummaries(effort, 1)
    const remainingWork = readEffortRemainingWork(effort)
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
        external_refs: effort.manifest.refs.length,
      },
      artifact_counts: {
        total: artifactInventory.counts.total,
        findings: Object.values(artifactInventory.counts.findings).reduce((sum, count) => sum + count, 0),
        receipt_sidecars: artifactInventory.counts.receipt_sidecars,
      },
      has_handoff: existsSync(resolve(effort.folder_path, "HANDOFF.md")),
      has_acceptance_summary: Boolean(paths.acceptance_summary),
      acceptance_packet: acceptancePacket,
      latest_optimizer_candidate: optimizerCandidates[optimizerCandidates.length - 1] ?? null,
      latest_run_evidence: runEvidence[runEvidence.length - 1] ?? null,
      latest_benchmark: benchmarks[benchmarks.length - 1] ?? null,
      latest_release_artifact: releaseArtifacts[releaseArtifacts.length - 1] ?? null,
      remaining_work: remainingWork,
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
      if (effort.latest_optimizer_candidate) {
        console.log(`    candidate: ${formatOptimizerCandidateCompact(effort.latest_optimizer_candidate)}`)
      }
      if (effort.latest_run_evidence) {
        console.log(`    run evidence: ${formatRunEvidenceCompact(effort.latest_run_evidence)}`)
      }
      if (effort.latest_benchmark) {
        console.log(`    benchmark: ${formatBenchmarkCompact(effort.latest_benchmark)}`)
      }
      if (effort.latest_release_artifact) {
        console.log(`    release: ${formatReleaseArtifactCompact(effort.latest_release_artifact)}`)
      }
      if (effort.remaining_work.state === "open") {
        console.log(`    remaining: ${clipCli(effort.remaining_work.summary, 150)}`)
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
  if (effort.ref_counts.external_refs > 0) refs.push(`refs ${effort.ref_counts.external_refs}`)
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

function formatOptimizerCandidateCompact(candidate: StackEffortOptimizerCandidateSummary): string {
  const parts = [
    candidate.candidate_id,
    candidate.score ? `${candidate.score_label || "score"} ${candidate.score}` : "",
    candidate.split ?? "",
    `run ${candidate.optimizer_run_id}`,
    candidate.path,
  ].filter(Boolean)
  return parts.join(" - ")
}

function formatRunEvidenceCompact(evidence: StackEffortRunEvidenceSummary): string {
  const metric = evidence.metric ? ` - ${evidence.metric}` : ""
  const level = evidence.acceptance_level ? ` - ${evidence.acceptance_level}` : ""
  return `${evidence.run_kind} - run ${evidence.run_id}${metric}${level} - ${evidence.path}`
}

function formatBenchmarkCompact(benchmark: StackEffortBenchmarkSummary): string {
  const id = benchmark.benchmark_id ? `${benchmark.benchmark_id} - ` : ""
  const version = benchmark.version ? ` - ${benchmark.version}` : ""
  const metrics = benchmark.metrics.length > 0 ? ` - metrics ${benchmark.metrics.join(", ")}` : ""
  return `${id}${benchmark.name}${version}${metrics} - ${benchmark.path}`
}

function formatReleaseArtifactCompact(artifact: StackEffortReleaseArtifactSummary): string {
  const version = artifact.version ? `${artifact.version} - ` : ""
  const target = artifact.target ? ` - ${artifact.target}` : ""
  const sha = artifact.sha256 ? ` - sha256 ${artifact.sha256}` : ""
  const publishable = artifact.publishable !== undefined ? ` - publishable ${artifact.publishable}` : ""
  return `${version}${artifact.path}${target}${sha}${publishable}`
}

function formatRemainingWorkLine(remaining: StackEffortRemainingWork): string {
  const next = remaining.next_actions[0] ? ` - next ${remaining.next_actions[0]}` : ""
  return `${remaining.summary}${next}`
}

function formatBlockerLine(blocker: StackEffortBlockerRecord): string {
  if (blocker.resolved_at) {
    const evidence = blocker.resolution_evidence ? ` - evidence ${blocker.resolution_evidence}` : ""
    return `${blocker.observed_at} - ${blocker.blocker} - resolved ${blocker.resolved_at}: ${blocker.resolution ?? "resolution recorded"}${evidence}`
  }
  return `${blocker.observed_at} - ${blocker.blocker} - open - owner ${blocker.owner} - next ${blocker.next}`
}

function formatEffortSessionLine(session: StackEffortSessionRecord): string {
  const parts = [session.observed_at, session.session_id, session.kind, session.actor, session.title]
  if (session.tags.length > 0) parts.push(`tags=${session.tags.join(",")}`)
  if (session.parent_session_id) parts.push(`parent=${session.parent_session_id}`)
  return parts.filter(Boolean).join(" - ")
}

function missingEffortRemainingWork(): StackEffortRemainingWork {
  return {
    state: "untracked",
    summary: "effort folder or manifest missing",
    open_acceptance: [],
    out_of_scope: [],
    latest_blocker: null,
    next_actions: [],
  }
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
  const sessionTail = readEffortSessionTail(effort, 5)
  const blockerTail = readEffortBlockerTail(effort, 5)
  const openBlockerTail = readEffortOpenBlockerTail(effort, 5)
  const acceptancePacket = readEffortAcceptancePacket(effort) ?? null
  const optimizerCandidates = readEffortOptimizerCandidateSummaries(effort, 5)
  const runEvidence = readEffortRunEvidenceSummaries(effort, 5)
  const benchmarks = readEffortBenchmarkSummaries(effort, 5)
  const releaseArtifacts = readEffortReleaseArtifactSummaries(effort, 5)
  const remainingWork = readEffortRemainingWork(effort)
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
      session_tail: sessionTail,
      latest_blocker: openBlockerTail[openBlockerTail.length - 1] ?? null,
      blocker_tail: blockerTail,
      open_blocker_tail: openBlockerTail,
      acceptance_packet: acceptancePacket,
      optimizer_candidates: optimizerCandidates,
      run_evidence: runEvidence,
      benchmarks,
      release_artifacts: releaseArtifacts,
      remaining_work: remainingWork,
      bound_meta_threads: boundMetaThreads,
    }, null, 2))
    return
  }
  console.log(`${effort.manifest.slug} - ${effort.manifest.status} - ${effort.manifest.title}`)
  console.log(`id: ${effort.manifest.id}`)
  console.log(`folder: ${effort.registry.folder_ref}`)
  console.log(`template: ${effort.manifest.template}`)
  console.log(`scope: ${effort.manifest.scope.capabilities.join(", ")} (lanes: ${effortScopeLanes(effort.manifest).join(", ") || "none"})`)
  if (effort.manifest.links.meta_thread_refs.length > 0) {
    console.log(`meta-threads: ${effort.manifest.links.meta_thread_refs.join(", ")}`)
  }
  if (boundMetaThreads.length > 0) {
    console.log("bound meta-threads:")
    for (const thread of boundMetaThreads) {
      console.log(`  ${formatBoundMetaThreadLine(thread)}`)
    }
  }
  if (effort.manifest.refs.length > 0) {
    console.log("refs:")
    for (const ref of effort.manifest.refs) {
      const suffix = [ref.lane ? `lane=${ref.lane}` : "", ref.role ? `role=${ref.role}` : ""].filter(Boolean).join(" ")
      console.log(`  ${ref.system}: ${ref.id}${suffix ? ` (${suffix})` : ""}`)
    }
  }
  if (effort.manifest.links.repo_refs.length > 0) {
    console.log(`repos: ${effort.manifest.links.repo_refs.join(", ")}`)
  }
  if (effort.manifest.links.initiative_id) console.log(`initiative: ${effort.manifest.links.initiative_id}`)
  console.log("paths:")
  console.log(`  playbook: ${paths.playbook}`)
  console.log(`  progress: ${paths.progress}`)
  console.log(`  activity: ${paths.activity}`)
  console.log(`  effort-sessions: ${paths.effort_sessions}`)
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
  if (optimizerCandidates.length > 0) {
    console.log("optimizer candidates:")
    for (const candidate of optimizerCandidates) {
      const receipt = candidate.source_receipt_path ? ` - receipt ${candidate.source_receipt_path}` : ""
      console.log(`  ${formatOptimizerCandidateCompact(candidate)}${receipt}`)
    }
  }
  if (runEvidence.length > 0) {
    console.log("run evidence:")
    for (const evidence of runEvidence) {
      const receipt = evidence.source_receipt_path ? ` - receipt ${evidence.source_receipt_path}` : ""
      console.log(`  ${formatRunEvidenceCompact(evidence)}${receipt}`)
    }
  }
  if (benchmarks.length > 0) {
    console.log("benchmarks:")
    for (const benchmark of benchmarks) {
      const receipt = benchmark.source_receipt_path ? ` - receipt ${benchmark.source_receipt_path}` : ""
      console.log(`  ${formatBenchmarkCompact(benchmark)}${receipt}`)
    }
  }
  if (releaseArtifacts.length > 0) {
    console.log("release artifacts:")
    for (const artifact of releaseArtifacts) {
      const receipt = artifact.source_receipt_path ? ` - receipt ${artifact.source_receipt_path}` : ""
      console.log(`  ${formatReleaseArtifactCompact(artifact)}${receipt}`)
    }
  }
  if (remainingWork.state !== "untracked") {
    console.log(`remaining: ${formatRemainingWorkLine(remainingWork)}`)
    for (const level of remainingWork.open_acceptance) {
      const required = level.required_for_v1 ? " required-v1" : ""
      console.log(`  ${level.label}: ${level.title} - ${level.status}${required}`)
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
  if (sessionTail.length > 0) {
    console.log("recent sessions:")
    for (const session of sessionTail) console.log(`  ${formatEffortSessionLine(session)}`)
  }
  if (blockerTail.length > 0) {
    console.log("recorded blockers:")
    for (const blocker of blockerTail) console.log(`  ${formatBlockerLine(blocker)}`)
  }
}

function printEffortRemaining(effort: StackEffort, json: boolean): void {
  const paths = effortPathRefs(effort)
  const remaining = readEffortRemainingWork(effort)
  const acceptancePacket = readEffortAcceptancePacket(effort) ?? null
  const latestBlocker = readEffortOpenBlockerTail(effort, 1)[0] ?? null
  if (json) {
    console.log(JSON.stringify({
      ok: true,
      effort_id: effort.manifest.id,
      slug: effort.manifest.slug,
      status: effort.manifest.status,
      folder_ref: effort.registry.folder_ref,
      paths,
      acceptance_packet: acceptancePacket,
      remaining_work: remaining,
      latest_blocker: latestBlocker,
    }, null, 2))
    return
  }
  console.log(`${effort.manifest.slug} remaining - ${remaining.state} - ${remaining.summary}`)
  if (acceptancePacket) console.log(`acceptance: ${acceptancePacket.summary}`)
  if (remaining.open_acceptance.length > 0) {
    console.log("open acceptance:")
    for (const level of remaining.open_acceptance) {
      const required = level.required_for_v1 ? " required-v1" : ""
      console.log(`  ${level.label}: ${level.title} - ${level.status}${required}`)
    }
  }
  if (remaining.out_of_scope.length > 0) {
    console.log("out of scope:")
    for (const level of remaining.out_of_scope) {
      console.log(`  ${level.label}: ${level.title} - out_of_scope`)
    }
  }
  if (latestBlocker) {
    console.log("latest blocker:")
    console.log(`  ${formatBlockerLine(latestBlocker)}`)
  }
  if (remaining.next_actions.length > 0) {
    console.log("next actions:")
    for (const action of remaining.next_actions) console.log(`  ${action}`)
  }
  console.log(`handoff: ${paths.handoff}`)
  if (paths.acceptance_summary) console.log(`acceptance-summary: ${paths.acceptance_summary}`)
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
    const openBlockerTail = readEffortOpenBlockerTail(effort, 5)
    console.log(JSON.stringify({
      effort,
      path,
      paths,
      artifact_inventory: artifactInventory,
      latest_progress: progressTail[progressTail.length - 1] ?? "",
      progress_tail: progressTail,
      latest_activity: activityTail[activityTail.length - 1] ?? null,
      activity_tail: activityTail,
      latest_blocker: openBlockerTail[openBlockerTail.length - 1] ?? null,
      blocker_tail: blockerTail,
      open_blocker_tail: openBlockerTail,
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

type EffortUsageExportResult = {
  schema: "stack.effort_usage_export.v1"
  effort_ref: string
  session_id: string
  worker_usage_path: string
  session_path: string
  model: string | null
  turns: number
  tokens: {
    input_tokens: number
    cached_input_tokens: number
    output_tokens: number
    reasoning_output_tokens: number
    total_tokens: number
  }
  estimated_spend_usd?: number
  exported_at: string
}

async function exportEffortUsageToPacket(
  config: StackConfig,
  input: { effortRef: string; sessionId: string; packet: string },
): Promise<EffortUsageExportResult> {
  const sessionPath = sessionHistoryScanDirs(config)
    .map((dir) => join(dir, `${input.sessionId}.json`))
    .find((path) => existsSync(path))
  if (!sessionPath) {
    throw new Error(`session ${input.sessionId} not found in ${sessionHistoryScanDirs(config).join(", ")}`)
  }
  const session = await readSessionLog(sessionPath)
  const model = session.codexModel ?? session.harnessModel ?? config.codexModel
  const summary = session.usageSummary ?? buildSessionUsageSummary(session.turns, model, config.codexPricing)
  if (!summary) {
    throw new Error(`session ${input.sessionId} has no usage summary yet: ${sessionPath}`)
  }
  const packet = resolveCliEffortSourcePath(config, process.cwd(), input.packet)
  if (!existsSync(packet)) {
    throw new Error(`packet directory does not exist: ${packet}`)
  }
  const scorecardsDir = join(packet, "scorecards")
  mkdirSync(scorecardsDir, { recursive: true })
  const outPath = join(scorecardsDir, "worker_usage.json")
  const tokens = {
    input_tokens: summary.totals.inputTokens,
    cached_input_tokens: summary.totals.cachedInputTokens,
    output_tokens: summary.totals.outputTokens,
    reasoning_output_tokens: summary.totals.reasoningOutputTokens,
    total_tokens: sessionTokenTotal(summary.totals),
  }
  const payload: EffortUsageExportResult = {
    schema: "stack.effort_usage_export.v1",
    effort_ref: input.effortRef,
    session_id: input.sessionId,
    worker_usage_path: outPath,
    session_path: sessionPath,
    model: summary.model,
    turns: summary.totals.turnCountWithUsage,
    tokens,
    ...(summary.estimatedSpendUsd !== undefined ? { estimated_spend_usd: summary.estimatedSpendUsd } : {}),
    exported_at: new Date().toISOString(),
  }
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  return payload
}

function printEffortUsage(): void {
  console.error("usage: stack effort <command>")
  console.error("  stack effort create <slug> [--template <id>] [--title <title>] [--topic <topic>] [--folder <path>]")
  console.error("  stack effort list [--json]")
  console.error("  stack effort templates [--json]")
  console.error("  stack effort show <effort> [--json]")
  console.error("  stack effort remaining <effort> [--json]")
  console.error("  stack effort audit <effort> [--json]")
  console.error("  stack effort activity <effort> [--limit <n>] [--json]")
  console.error("  stack effort refresh-receipts <effort> [--json]")
  console.error("  stack effort bind <effort> <meta-thread-id>")
  console.error("  stack effort progress <effort> <message>")
  console.error("  stack effort effort-session <effort> <title> [--session-id <id>] [--actor <actor>] [--kind <kind>] [--parent-session-id <id>] [--tag <tag>] [--summary <text>] [--payload-json <json>]")
  console.error("  stack effort blocker <effort> --blocker <text> --evidence <text> --owner <owner> --next <text>")
  console.error("  stack effort resolve-blocker <effort> --resolution <text> [--activity-id <id>] [--evidence <text>] [--owner <owner>]")
  console.error("  stack effort acceptance <effort> <A0|A1|A2...> [--state recorded|pending|not_recorded] [--status <text>] [--evidence <text>] [--path <path>] [--result <text>] [--decision <text>] [--next <text>]")
  console.error("  stack effort research-log <effort> <title> --work-summary <text> [--session-id <id>] [--operator-message <text>] [--result <text>] [--metric <text>] [--path <path>] [--command <command>] [--next <text>]")
  console.error("  stack effort handoff <effort> [--summary <text>] [--risk <text>] [--next <text>] [--owner <text>]")
  console.error("  stack effort engineering-packet <effort> [--repo <path>] [--base <ref>] [--summary <text>] [--file <path>] [--validation <text>] [--skipped-gate <text>] [--risk <text>] [--next <text>]")
  console.error("  stack effort export-usage <effort> --session-id <id> --packet <path> [--json]")
  console.error("  stack effort refs <effort> [--factory-id <id>] [--hosted-effort-id <id>] [--project-id <id>] [--optimizer-run-id <id>] [--smr-run-id <id>] [--tinker-run-id <id>] [--repo-ref <ref>] [--initiative-id <id>]")
  console.error("  stack effort scope <effort> [--capabilities <a,b,c>] [--json]")
  console.error(`  stack effort launch <effort> --kind ${EFFORT_LAUNCH_KINDS.join("|")} --capability <${EFFORT_LAUNCH_CAPABILITIES.join("|")}> [--config <gepa toml path>] [--tunnel-url <url>] [--container-pool <id>] [--goal <text>] [--project-id <id>] [--factory-id <id>] [--request-json <json>] [--name <name>] [--description <text>] [--status <status>] [--pool <id>] [--task-id <id>] [--split <name>] [--seed <n>] [--policy-name <name>] [--policy-config-json <json>] [--image-ref <ref>|--service-url <url>] [--runtime-kind <kind>] [--release-name <name>] [--provider <name>] [--json]`)
  console.error("  stack effort idea <effort> <title> [--origin HUMAN|AGENT|MIXED] [--body <text>]")
  console.error("  stack effort note <effort> <title> [--kind human|note] [--body <text>]")
  console.error("  stack effort repo <effort> --path <path> [--repo-ref <ref>] [--title <title>] [--filename <name>]")
  console.error("  stack effort finding <effort> [title] --kind idea|code|data|proof|result [--path <path>|--receipt-path <path>] [--body <text>]")
  console.error("  stack effort capture <effort> [title] --capture-kind terminal|browser|screenshot|video|local|monitor|memory|text|benchmark|optimizer [--kind idea|code|data|proof|result] [--path <path>|--receipt-path <path>|--body <text>]")
  console.error("  stack effort benchmark <effort> [title] [--benchmark-id <id>] [--name <name>] [--version <version>] [--source <url-or-ref>] [--license <license>] [--task-shape <text>] [--split <name>] [--metric <name>] [--path <path>|--receipt-path <path>] [--body <text>]")
  console.error("  stack effort optimizer-candidate <effort> [title] [--optimizer-run-id <id>] [--candidate-id <id>] [--score <value>] [--score-label <name>] [--split <name>] [--path <path>|--receipt-path <path>] [--body <text>]")
  console.error("  stack effort run-evidence <effort> [title] --run-kind <system> [--run-id <id>] [--project-id <id>] [--output-id <id>] [--artifact-name <name>] [--metric <text>] [--acceptance-level <claim>] [--path <path>|--receipt-path <path>] [--body <text>]")
  console.error("  stack effort release-artifact <effort> [title] [--version <version>] [--channel <channel>] [--target <triple>] [--archive <path-or-url>] [--sha256 <hex>] [--size <bytes>] [--manifest <path-or-url>] [--release-site <path-or-url>] [--publishable true|false] [--publish-blocker <text>] [--path <path>|--receipt-path <path>] [--body <text>]")
  console.error("  stack effort artifact <effort> --slug <page> [--split <name>] [--body <text>]")
  console.error("  stack effort status <effort> <active|paused|done|archived>")
  console.error("  stack effort archive <effort>")
}

function parseCliEffortStatus(status: string): { ok: true; status: StackEffortStatus } | { ok: false; message: string } {
  if (status === "blocked") {
    return {
      ok: false,
      message: "Efforts never use status=blocked; keep the Effort active or paused and record the blocker with `stack effort blocker`.",
    }
  }
  if (STACK_EFFORT_STATUSES.includes(status as StackEffortStatus)) {
    return { ok: true, status: status as StackEffortStatus }
  }
  return { ok: false, message: "status must be active, paused, done, or archived" }
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

function readFlagBoolean(parsed: ParsedFlags, name: string): boolean | undefined {
  const value = readFlagString(parsed, name)
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true
  if (normalized === "false" || normalized === "0" || normalized === "no") return false
  throw new Error(`${name} must be true or false`)
}

function readRunEvidenceKind(parsed: ParsedFlags, action: string): string {
  const value = readFlagString(parsed, "run-kind")
    ?? (action === "smr-evidence" ? "smr" : action === "tinker-evidence" ? "tinker" : undefined)
  if (value && /^[a-z][a-z0-9_-]*$/.test(value)) return value
  throw new Error("run-kind must be a lowercase identifier like smr, tinker, or local")
}

function readFlagList(parsed: ParsedFlags, name: string): string[] | undefined {
  const value = readFlagString(parsed, name)
  if (!value) return undefined
  return value.split(/;|\n/).map((entry) => entry.trim()).filter(Boolean)
}

function readFlagJsonObject(parsed: ParsedFlags, name: string): Record<string, unknown> | undefined {
  const value = readFlagString(parsed, name)
  if (!value) return undefined
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(value)
  } catch (error) {
    throw new Error(`${name} must be a JSON object: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return parsedJson as Record<string, unknown>
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
