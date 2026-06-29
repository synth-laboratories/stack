#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { discoverStackGuidance, searchStackGuidance } from "../src/codex/guidance.js"
import { StackMcpServer } from "../src/mcp/server.js"

const appRoot = resolve(import.meta.dir, "..")
const workspaceRoot = process.env.STACK_WORKSPACE_ROOT ?? resolve(appRoot, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "guidance-l2", stamp)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })

const all = discoverStackGuidance(appRoot, { workspaceRoot })
const appItems = all.filter((item) => item.styleLayer === "app")
const orgItems = all.filter((item) => item.styleLayer === "org")
const orgSynthStyle = all.find((item) => item.styleLayer === "org" && item.guidanceId.includes("synthstyle"))
const jstackStyle = all.find(
  (item) =>
    item.styleLayer === "org" &&
    item.sourcePath.includes("/Jstack/.jstack/style/") &&
    item.sourcePath.endsWith(".md"),
)
const jstackStandard = all.find(
  (item) =>
    item.styleLayer === "org" &&
    (item.sourcePath.includes("/Jstack/.jstack/anger/standards/") ||
      item.sourcePath.includes("/Jstack/.jstack/tanha/standards/")) &&
    item.sourcePath.endsWith(".md"),
)
const mldpLearning = all.find((item) => item.guidanceId.includes("mldp/learnings") || item.relativePath.includes("mldp/learnings"))
const papercutHit = searchStackGuidance(appRoot, "banking77-policy-api-key-env", { workspaceRoot, limit: 5 })

if (appItems.length === 0) failures.push("no app-layer style items discovered")
if (orgItems.length === 0) failures.push("no org-layer style items discovered")
if (!orgSynthStyle) failures.push("org synthstyle source not indexed")
if (!jstackStyle) failures.push("Jstack .jstack/style source not indexed")
if (!jstackStandard) failures.push("Jstack standards source not indexed")
if (!mldpLearning) failures.push("records/mldp/learnings.md not indexed")
if (papercutHit.length === 0 || papercutHit[0]?.score === 0) {
  failures.push("papercut id banking77-policy-api-key-env not searchable")
}

const appOnly = discoverStackGuidance(appRoot, { workspaceRoot, styleLayer: "app" })
if (appOnly.some((item) => item.styleLayer !== "app")) {
  failures.push("style_layer=app filter returned non-app items")
}
if (appOnly.length === 0) failures.push("style_layer=app filter returned empty")

const server = new StackMcpServer(appRoot)
const mcpSearch = (await server.searchGuidance({
  query: "gardener voice inbox",
  scope: "records",
  limit: 10,
})) as { count?: number; guidance?: Array<{ style_layer?: string; guidance_id?: string }> }

if ((mcpSearch.count ?? 0) < 1) failures.push("MCP stack_search_guidance returned no hits for gardener voice")
const voiceDecision = mcpSearch.guidance?.find((hit) => hit.guidance_id?.includes("voice-gardener"))
if (!voiceDecision) failures.push("MCP search missing voice-gardener decision hit")

const mcpStyle = (await server.listGuidance({
  scope: "style",
  style_layer: "app",
  limit: 20,
})) as { count?: number; guidance?: Array<{ style_layer?: string }> }

if ((mcpStyle.count ?? 0) < 1) failures.push("MCP stack_guidance_list style_layer=app empty")
if (mcpStyle.guidance?.some((item) => item.style_layer !== "app")) {
  failures.push("MCP list returned items without style_layer=app")
}

const summary = {
  ok: failures.length === 0,
  stamp,
  workspace_root: workspaceRoot,
  app_layer_count: appItems.length,
  org_layer_count: orgItems.length,
  org_synthstyle_id: orgSynthStyle?.guidanceId ?? null,
  jstack_style_id: jstackStyle?.guidanceId ?? null,
  jstack_standard_id: jstackStandard?.guidanceId ?? null,
  mldp_learning_id: mldpLearning?.guidanceId ?? null,
  papercut_top_hit: papercutHit[0]?.guidanceId ?? null,
  mcp_search_count: mcpSearch.count ?? 0,
  failures,
}

writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`stack_guidance_l2_failed: ${failures.join("; ")}`)
  process.exit(1)
}

console.log("stack_guidance_l2_ok")
console.log(`app_layer_items=${appItems.length}`)
console.log(`org_layer_items=${orgItems.length}`)
console.log(`proof_dir=${proofDir}`)
