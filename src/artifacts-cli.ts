import type { StackConfig } from "./config.js"
import {
  artifactGalleryUrl,
  artifactLocalUrl,
  lintArtifact,
  publishArtifact,
  readArtifactStatus,
  readLatestArtifacts,
  serveArtifactSite,
  stopArtifactSite,
  writeArtifactPage,
} from "./artifacts.js"
import { openUrlInSystemBrowser } from "./remote/actions.js"

type ParsedFlags = {
  args: string[]
  flags: Map<string, string | true>
}

export async function runArtifactsCli(config: StackConfig, argv: string[]): Promise<number> {
  const [, action] = argv
  const parsed = parseFlags(argv.slice(2))
  const json = Boolean(parsed.flags.get("json"))
  const help = Boolean(parsed.flags.get("help") || parsed.flags.get("h"))
  if (!action || action === "help" || action === "--help" || action === "-h" || help) {
    printArtifactsUsage()
    return action ? 0 : 2
  }

  try {
    if (action === "serve") {
      const result = await serveArtifactSite(config)
      printServeResult(result, json)
      return result.ok ? 0 : 1
    }

    if (action === "status") {
      const status = await readArtifactStatus(config)
      if (json) console.log(JSON.stringify(status, null, 2))
      else {
        console.log(`${status.running ? "running" : "stopped"} ${status.url}`)
        console.log(`artifacts: ${status.manifestEntries}`)
        console.log(`site: ${status.siteDir}`)
        console.log(`log: ${status.logPath}`)
        if (status.running) console.log("auto-stop: set STACK_ARTIFACT_SITE_TTL_SECONDS=0 to disable")
        console.log(status.message)
      }
      return status.ok ? 0 : 1
    }

    if (action === "stop") {
      const result = await stopArtifactSite(config)
      printServeResult(result, json)
      return result.ok ? 0 : 1
    }

    if (action === "create" || action === "update") {
      const slug = parsed.args[0]
      if (!slug) return usageError(`usage: stack artifacts ${action} <slug> --title <title> (--page <tsx-file> | --html <file>) [--data <json>]`)
      const result = await writeArtifactPage(config, {
        slug,
        title: readFlagString(parsed, "title"),
        kind: readFlagString(parsed, "kind"),
        effort: readFlagString(parsed, "effort"),
        pagePath: readFlagString(parsed, "page"),
        htmlPath: readFlagString(parsed, "html"),
        dataPath: readFlagString(parsed, "data"),
        update: action === "update",
      })
      if (json) console.log(JSON.stringify(result, null, 2))
      else {
        console.log(`${action === "update" ? "updated" : "created"} ${result.artifact.slug}`)
        console.log(result.localUrl)
        if (!result.served.ok) console.log(`serve warning: ${result.served.message}`)
      }
      return result.served.ok ? 0 : 1
    }

    if (action === "list" || action === "ls") {
      const artifacts = readLatestArtifacts(config)
      if (json) console.log(JSON.stringify({ artifacts, gallery_url: artifactGalleryUrl() }, null, 2))
      else if (artifacts.length === 0) console.log("No artifact pages yet.")
      else {
        console.log(`gallery: ${artifactGalleryUrl()}`)
        for (const artifact of artifacts) {
          const effort = artifact.effort ? ` effort=${artifact.effort}` : ""
          const cloud = artifact.hosted_url ? ` hosted=${artifact.hosted_url}` : ""
          const version = artifact.artifact_version ? ` v${artifact.artifact_version}` : ""
          console.log(`${artifact.slug}  ${artifact.kind}${version}  ${artifact.title}${effort}${cloud}  ${artifact.local_url}`)
        }
      }
      return 0
    }

    if (action === "open") {
      const slug = parsed.args[0]
      const url = slug ? artifactLocalUrl(slug) : artifactGalleryUrl()
      const result = await openUrlInSystemBrowser(url)
      if (json) console.log(JSON.stringify({ ...result, url }, null, 2))
      else console.log(result.message)
      return result.ok ? 0 : 1
    }

    if (action === "lint") {
      const slug = parsed.args[0]
      if (!slug) return usageError("usage: stack artifacts lint <slug> [--json]")
      const result = lintArtifact(config, slug)
      if (json) console.log(JSON.stringify(result, null, 2))
      else if (result.ok) console.log(`ok ${result.artifact?.slug}`)
      else {
        console.log(`failed ${slug}`)
        for (const error of result.errors) console.log(`  ${error}`)
      }
      if (!json && result.warnings.length > 0) {
        for (const warning of result.warnings) console.log(`warning: ${warning}`)
      }
      return result.ok ? 0 : 1
    }

    if (action === "publish") {
      const slug = parsed.args[0]
      if (!slug) return usageError(`usage: stack artifacts ${action} <slug> [--project-id <id>] [--visibility org|private|public] [--json]`)
      const request = {
        slug,
        visibility: readVisibility(parsed),
        projectId: readFlagString(parsed, "project-id"),
        hostedEffortId: readFlagString(parsed, "hosted-effort-id"),
        sourceRunIds: readFlagList(parsed, "source-run-id"),
        traceId: readFlagString(parsed, "trace-id"),
        confirmPublish: true,
      }
      const result = await publishArtifact(config, request)
      if (json) console.log(JSON.stringify(result, null, 2))
      else printPublishResult(result)
      return result.ok ? 0 : 1
    }

    return usageError(`unknown stack artifacts command: ${action}`)
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
    } else {
      console.error(error instanceof Error ? error.message : String(error))
    }
    return 1
  }
}

function printServeResult(result: Awaited<ReturnType<typeof serveArtifactSite>>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(`${result.running ? "running" : "stopped"} ${result.url}`)
  console.log(result.message)
  if (result.ttlSeconds) console.log(`auto-stop: ${result.ttlSeconds}s`)
  console.log(`site: ${result.siteDir}`)
  console.log(`log: ${result.logPath}`)
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
    const eq = raw.indexOf("=")
    if (eq >= 0) {
      flags.set(raw.slice(0, eq), raw.slice(eq + 1))
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

function readFlagString(parsed: ParsedFlags, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readFlagList(parsed: ParsedFlags, name: string): string[] {
  const values: string[] = []
  for (const [key, value] of parsed.flags.entries()) {
    if (key !== name || typeof value !== "string") continue
    values.push(...value.split(",").map((part) => part.trim()).filter(Boolean))
  }
  return values
}

function readFlagBoolean(parsed: ParsedFlags, name: string): boolean | undefined {
  const value = parsed.flags.get(name)
  if (value === undefined) return undefined
  if (value === true) return true
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "y"].includes(normalized)) return true
  if (["0", "false", "no", "n"].includes(normalized)) return false
  return undefined
}

function readVisibility(parsed: ParsedFlags): "private" | "org" | "public" | undefined {
  const visibility = readFlagString(parsed, "visibility")
  if (visibility === "private" || visibility === "org" || visibility === "public") return visibility
  return undefined
}

function printPublishResult(result: Awaited<ReturnType<typeof publishArtifact>>): void {
  if (!result.ok) {
    console.log(`failed ${result.artifact.slug}: ${result.message}`)
    for (const error of result.lint.errors) console.log(`  ${error}`)
    if (result.hosted && !result.hosted.ok) console.log(`  hosted: ${result.hosted.message}`)
    return
  }
  console.log(result.message)
  if (result.artifact.hosted_url) console.log(result.artifact.hosted_url)
  if (result.artifact.artifact_version) console.log(`version: ${result.artifact.artifact_version}`)
  if (result.receipt) console.log(result.receipt)
  if (result.evidencePath) console.log(`effort evidence: ${result.evidencePath}`)
  if (result.evidenceError) console.log(`effort evidence warning: ${result.evidenceError}`)
  for (const warning of result.lint.warnings) console.log(`warning: ${warning}`)
}

function usageError(message: string): number {
  console.error(message)
  return 2
}

function printArtifactsUsage(): void {
  console.error("Usage:")
  console.error("  stack artifacts serve [--json]")
  console.error("    Auto-stops after 30m by default; set STACK_ARTIFACT_SITE_TTL_SECONDS=0 to disable.")
  console.error("  stack artifacts status [--json]")
  console.error("  stack artifacts stop [--json]")
  console.error("  stack artifacts create <slug> --title <title> [--kind result|analysis|bloglet|blog] [--effort <slug>] (--page <tsx-file> | --html <file>) [--data <json>] [--json]")
  console.error("  stack artifacts update <slug> [--title <title>] [--kind result|analysis|bloglet|blog] [--effort <slug>] [--page <tsx-file> | --html <file>] [--data <json>] [--json]")
  console.error("  stack artifacts list [--json]")
  console.error("  stack artifacts open [slug] [--json]")
  console.error("  stack artifacts lint <slug> [--json]")
  console.error("  stack artifacts publish <slug> [--project-id <id>] [--hosted-effort-id <id>] [--visibility org|private|public] [--source-run-id <id>] [--json]")
}
