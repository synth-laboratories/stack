#!/usr/bin/env bun

import { join } from "node:path"
import {
  fetchOpenAiModelPricing,
  loadOpenAiPricing,
  parseOpenAiModelDocPricing,
} from "../src/codex/openai-pricing.ts"

const fixture = `
<div>Input</div><div class="text-2xl font-semibold">$0.75</div>
<div>Cached input</div><div class="text-2xl font-semibold">$0.075</div>
<div>Output</div><div class="text-2xl font-semibold">$4.50</div>
`

const parsed = parseOpenAiModelDocPricing("gpt-5.4-mini", fixture)
if (
  !parsed ||
  parsed.inputPerMillion !== 0.75 ||
  parsed.cachedInputPerMillion !== 0.075 ||
  parsed.outputPerMillion !== 4.5
) {
  console.error("parseOpenAiModelDocPricing failed", parsed)
  process.exit(1)
}

const live = await fetchOpenAiModelPricing("gpt-5.4-mini")
if (
  !live ||
  live.inputPerMillion !== 0.75 ||
  live.cachedInputPerMillion !== 0.075 ||
  live.outputPerMillion !== 4.5
) {
  console.error("live OpenAI pricing fetch failed", live)
  process.exit(1)
}

const appRoot = join(import.meta.dir, "..")
const loaded = await loadOpenAiPricing({
  appRoot,
  models: ["gpt-5.4-mini", "gpt-5.5"],
  forceRefresh: true,
})
const mini = loaded.rows.find((row) => row.model === "gpt-5.4-mini")
const flagship = loaded.rows.find((row) => row.model === "gpt-5.5")
if (!mini || !flagship || loaded.source !== "openai") {
  console.error("loadOpenAiPricing failed", loaded)
  process.exit(1)
}

console.log("stack_openai_pricing_smoke_ok")
console.log(`source=${loaded.source} mini=$${mini.inputPerMillion}/$${mini.outputPerMillion} 5.5=$${flagship.inputPerMillion}/$${flagship.outputPerMillion}`)
