import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadGardenerConfig, gardenerToolAllowed, resolveGardenerSystemPrompt } from "./gardener-config.js"

function seed(allow: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "stack-gard-"))
  mkdirSync(join(root, ".stack", "gardeners"), { recursive: true })
  writeFileSync(join(root, ".stack", "operator-profile.json"), JSON.stringify({ active: "engineering" }))
  writeFileSync(
    join(root, ".stack", "gardeners", "engineering.toml"),
    `[gardener]\nid = "engineering"\n\n[model]\nprovider = "openai"\nmodel = "gpt-5.5"\n\n[tools]\nallow = [${allow.map((t) => `"${t}"`).join(", ")}]\n`,
  )
  return root
}

test("backfill adds create-thread owner tools to a drifted gardener that has stack_ tools", () => {
  const root = seed(["stack_status", "stack_meta_threads_list", "stack_effort_list"])
  const cfg = loadGardenerConfig(root)
  expect(gardenerToolAllowed(cfg, "stack_worker_thread_create")).toBe(true)
  expect(gardenerToolAllowed(cfg, "stack_meta_thread_create")).toBe(true)
})

test("backfill does not add owner tools to a gardener with no stack_ MCP tools", () => {
  const root = seed(["gardener.inbox", "gardener.route"])
  const cfg = loadGardenerConfig(root)
  expect(gardenerToolAllowed(cfg, "stack_worker_thread_create")).toBe(false)
})

test("resolved prompt carries the spawn_agent-vs-worker guardrail", () => {
  const root = seed(["stack_status", "stack_effort_list"])
  const cfg = loadGardenerConfig(root)
  const prompt = resolveGardenerSystemPrompt(root, cfg)
  expect(prompt.includes("A spawn_agent thread_id alone is not a durable worker")).toBe(true)
})
