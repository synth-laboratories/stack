#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { loadConfig } from "../src/config.js"
import { readGardenerInbox, markGardenerInboxRouted } from "../src/gardener.js"
import { readThreadMetaEvents } from "../src/thread-events.js"
import { transcribeAndEnqueueGardenerVoice } from "../src/voice/dictation.js"
import { loadVoiceApiKeys } from "../src/voice/keys.js"

process.env.STACK_VOICE_ENABLED ??= "1"

const DEMO_PHRASE = "Route the artifacts end to end proof through gardener inbox."
const EXPECTED_TOKENS = ["route", "artifacts", "gardener", "inbox"] as const

const appRoot = resolve(import.meta.dir, "..")
const config = await loadConfig(appRoot)
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const threadId = process.env.STACK_VOICE_DEMO_THREAD_ID ?? `voice-demo-${randomUUID()}`
const proofDir =
  process.env.STACK_VOICE_PROOF_DIR ?? join(appRoot, ".stack", "evidence", "voice-demo", stamp)
const audioPath = process.env.STACK_VOICE_DEMO_AUDIO ?? join(proofDir, "demo.wav")

mkdirSync(proofDir, { recursive: true })

const keys = loadVoiceApiKeys(config.voice)
if (!keys.groq && !keys.openai) {
  console.error("stack_voice_gardener_demo_failed: GROQ_API_KEY and OPENAI_API_KEY both missing")
  process.exit(1)
}

ensureDemoAudio(audioPath)
const audio = readFileSync(audioPath)
const startedAt = Date.now()

const result = await transcribeAndEnqueueGardenerVoice({
  stackRoot: config.appRoot,
  threadId,
  audio,
  mime: "audio/wav",
  durationMs: estimateWavDurationMs(audio),
  voiceConfig: config.voice,
})

const events = readThreadMetaEvents(config.appRoot, threadId)
const inbox = readGardenerInbox(config.appRoot, threadId)
const failures: string[] = []

if (!textMatchesDemo(result.transcription.text)) {
  failures.push(`transcript missing expected tokens: ${result.transcription.text}`)
}
if (!events.some((event) => event.type === "voice.dictation.start")) {
  failures.push("missing voice.dictation.start")
}
if (!events.some((event) => event.type === "voice.dictation.final")) {
  failures.push("missing voice.dictation.final")
}
const queued = events.find((event) => event.type === "gardener.queued")
if (!queued) failures.push("missing gardener.queued")
if (queued?.payload.source !== "voice") failures.push("gardener.queued source is not voice")
if (events.some((event) => event.type === "gardener.routed")) {
  failures.push("gardener.routed present before explicit route step")
}
if (inbox.length !== 1) failures.push(`expected 1 pending inbox item, got ${inbox.length}`)

const routedItem = inbox[0]
if (routedItem) {
  markGardenerInboxRouted(config.appRoot, threadId, routedItem)
  const afterRoute = readGardenerInbox(config.appRoot, threadId)
  if (afterRoute.some((item) => item.id === routedItem.id)) {
    failures.push("inbox item still pending after gardener.routed")
  }
}

const summary = {
  ok: failures.length === 0,
  stamp,
  thread_id: threadId,
  demo_phrase: DEMO_PHRASE,
  transcript: result.transcription.text,
  stt_provider: result.transcription.provider,
  stt_model: result.transcription.model,
  stt_fallback_used: result.transcription.fallbackUsed,
  inbox_item_id: result.inboxItemId,
  event_log: join(config.appRoot, ".stack", "events", "threads", `${threadId}.jsonl`),
  audio_path: audioPath,
  elapsed_ms: Date.now() - startedAt,
  keys_present: { groq: Boolean(keys.groq), openai: Boolean(keys.openai) },
  failures,
}

writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
writeFileSync(join(proofDir, "run_meta.json"), `${JSON.stringify({ threadId, stamp, appRoot: config.appRoot }, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`stack_voice_gardener_demo_failed: ${failures.join("; ")}`)
  console.error(JSON.stringify(summary, null, 2))
  process.exit(1)
}

console.log("stack_voice_gardener_demo_ok")
console.log(`thread_id=${threadId}`)
console.log(`provider=${result.transcription.provider} model=${result.transcription.model}`)
console.log(`transcript=${result.transcription.text}`)
console.log(`proof_dir=${proofDir}`)

function ensureDemoAudio(path: string): void {
  if (existsSync(path) && !process.env.STACK_VOICE_REGENERATE_AUDIO) return
  const aiffPath = path.replace(/\.wav$/, ".aiff")
  const say = spawnSync("say", ["-o", aiffPath, DEMO_PHRASE], { encoding: "utf8" })
  if (say.status !== 0) {
    throw new Error(`say failed: ${say.stderr || say.stdout}`)
  }
  const ffmpeg = spawnSync("ffmpeg", ["-y", "-i", aiffPath, "-ar", "16000", "-ac", "1", path], {
    encoding: "utf8",
  })
  if (ffmpeg.status !== 0) {
    throw new Error(`ffmpeg failed: ${ffmpeg.stderr || ffmpeg.stdout}`)
  }
}

function textMatchesDemo(text: string): boolean {
  const normalized = text.toLowerCase()
  return EXPECTED_TOKENS.every((token) => normalized.includes(token))
}

function estimateWavDurationMs(audio: Buffer): number {
  if (audio.length < 44) return 0
  const sampleRate = audio.readUInt32LE(24)
  const channels = audio.readUInt16LE(22)
  const bitsPerSample = audio.readUInt16LE(34)
  const dataBytes = audio.length - 44
  if (!sampleRate || !channels || !bitsPerSample) return 0
  const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8
  return Math.round((dataBytes / bytesPerSecond) * 1000)
}
