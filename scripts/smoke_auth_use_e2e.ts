#!/usr/bin/env bun
// Auth -> use -> meter E2E proof for the hosted Synth surface Stack depends on.
//
// Proves the full signed-in path that a freshly-signed-up user follows:
//   1. AUTH  — the Synth API key resolves (GET /api/v1/synth/models returns the catalog)
//   2. USE   — a real Nemotron Ultra inference call succeeds
//              (POST /api/v1/stack-aux/openai/v1/responses)
//   3. METER — usage is recorded server-side (GET /api/v1/stack-aux/usage moves)
//
// Signup itself is a Clerk browser flow (manual / Playwright); this harness starts
// from the API key that signup produces, which is the contract the launch needs.
//
// Usage:
//   SYNTH_API_KEY=sk_... bun run scripts/smoke_auth_use_e2e.ts
//   SYNTH_API_KEY=sk_... STACK_E2E_BASE_URL=https://staging-api.usesynth.ai bun run scripts/smoke_auth_use_e2e.ts

const baseUrl = (process.env.STACK_E2E_BASE_URL ?? "https://api.usesynth.ai").replace(/\/$/, "")
const apiKey = process.env.SYNTH_API_KEY?.trim()
const model = process.env.STACK_E2E_MODEL ?? "nemotron-3-ultra"

const failures: string[] = []
const steps: Record<string, unknown> = {}

if (!apiKey) {
  console.error("auth_use_e2e_failed: SYNTH_API_KEY is required (the key signup issues)")
  process.exit(2)
}

const authHeaders = { authorization: `Bearer ${apiKey}` }

function spent(payload: unknown): number {
  const synthWide = (payload as { synth_wide?: { spent_cents?: number } })?.synth_wide
  return Number(synthWide?.spent_cents ?? 0)
}

// 1. AUTH — key resolves and the model catalog is visible.
try {
  const res = await fetch(`${baseUrl}/api/v1/synth/models`, { headers: authHeaders })
  const body = await res.json().catch(() => ({}))
  const names = Array.isArray((body as { data?: Array<{ id?: string }> }).data)
    ? (body as { data: Array<{ id?: string }> }).data.map((m) => m.id)
    : []
  steps.auth = { status: res.status, models: names }
  if (!res.ok) failures.push(`auth: models returned ${res.status}`)
  if (res.ok && names.length > 0 && !names.includes(model)) {
    failures.push(`auth: model ${model} not in catalog ${JSON.stringify(names)}`)
  }
} catch (error) {
  failures.push(`auth: ${error instanceof Error ? error.message : String(error)}`)
}

// snapshot usage before the call
let before = 0
try {
  const res = await fetch(`${baseUrl}/api/v1/stack-aux/usage`, { headers: authHeaders })
  before = spent(await res.json().catch(() => ({})))
} catch {
  /* usage snapshot is best-effort */
}

// 2. USE — a real Nemotron Ultra inference call.
try {
  const res = await fetch(`${baseUrl}/api/v1/stack-aux/openai/v1/responses`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ model, input: "Reply with the single word: pong." }),
  })
  const body = await res.json().catch(() => ({}))
  const usage = (body as { usage?: { output_tokens?: number } }).usage
  steps.use = { status: res.status, has_usage: Boolean(usage), output_tokens: usage?.output_tokens }
  if (!res.ok) failures.push(`use: inference returned ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
} catch (error) {
  failures.push(`use: ${error instanceof Error ? error.message : String(error)}`)
}

// 3. METER — usage moved.
try {
  const res = await fetch(`${baseUrl}/api/v1/stack-aux/usage`, { headers: authHeaders })
  const after = spent(await res.json().catch(() => ({})))
  steps.meter = { spent_cents_before: before, spent_cents_after: after, increased: after >= before }
  if (after < before) failures.push("meter: spend went backwards")
} catch (error) {
  failures.push(`meter: ${error instanceof Error ? error.message : String(error)}`)
}

const summary = { ok: failures.length === 0, base_url: baseUrl, model, steps, failures }
if (failures.length > 0) {
  console.error("auth_use_e2e_failed")
  console.error(JSON.stringify(summary, null, 2))
  process.exit(1)
}
console.log("auth_use_e2e_ok")
console.log(JSON.stringify(summary, null, 2))
