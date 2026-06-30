#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { discoverStackGuidance } from "../src/codex/guidance.js"
import { StackMcpServer } from "../src/mcp/server.js"
import { ensureStackDefaults } from "../src/seed/defaults.js"

const appRoot = resolve(import.meta.dir, "..")
const workspaceRoot = process.env.STACK_WORKSPACE_ROOT ?? resolve(appRoot, "..")
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "guidance-l2", stamp)
const failures: string[] = []

mkdirSync(proofDir, { recursive: true })
ensureStackDefaults(appRoot, appRoot)

const all = discoverStackGuidance(appRoot, { workspaceRoot })
const appItems = all.filter((item) => item.styleLayer === "app")
const orgItems = all.filter((item) => item.styleLayer === "org")
const orgSynthStyle = all.find((item) => item.styleLayer === "org" && item.guidanceId.includes("synthstyle"))
const stackNorms = all.find(
  (item) => item.styleLayer === "app" && item.guidanceId === "app/style/stack-norms",
)
const externalMemoryItems = all.filter(
  (item) =>
    item.sourcePath.includes("/Jstack/.jstack/") ||
    item.sourcePath.includes("\\Jstack\\.jstack\\") ||
    item.sourcePath.includes("/.jstack/"),
)

if (appItems.length === 0) failures.push("no app-layer style items discovered")
if (!stackNorms) failures.push("seeded stack-norms not indexed")
if (orgItems.length > 0 && !orgSynthStyle) failures.push("org style items present but synthstyle source not indexed")
if (externalMemoryItems.length > 0) failures.push("external memory sources must not be indexed")

const appOnly = discoverStackGuidance(appRoot, { workspaceRoot, styleLayer: "app" })
if (appOnly.some((item) => item.styleLayer !== "app")) {
  failures.push("style_layer=app filter returned non-app items")
}
if (appOnly.length === 0) failures.push("style_layer=app filter returned empty")

const server = new StackMcpServer(appRoot)
const mcpSearch = (await server.searchGuidance({
  query: "stack norms operator loop",
  scope: "style",
  limit: 10,
})) as { count?: number; guidance?: Array<{ style_layer?: string; guidance_id?: string }> }

if ((mcpSearch.count ?? 0) < 1) failures.push("MCP stack_search_guidance returned no hits for stack norms")

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
  stack_norms_id: stackNorms?.guidanceId ?? null,
  external_memory_count: externalMemoryItems.length,
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
