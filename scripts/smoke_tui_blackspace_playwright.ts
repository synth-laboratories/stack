#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium } from "playwright"
import {
  estimateShortTranscriptLines,
  transcriptPaneFlexGrowForContent,
  transcriptViewportForEstimatedContent,
} from "../src/tui/transcript-layout.js"
import {
  renderTranscriptView,
  type ToolLog,
  type TranscriptBlock,
  type TranscriptRenderOptions,
} from "../src/tui/transcript.js"
import type { SubagentLog } from "../src/tui/subagents.js"

type BlackspaceCase = {
  name: string
  title: string
  columns: number
  transcriptRows: number
  blocks: TranscriptBlock[]
  tools: ToolLog[]
  subagents: SubagentLog[]
  options: TranscriptRenderOptions
}

type RenderedCase = {
  name: string
  title: string
  estimatedLines: number | undefined
  exactLines: number
  visibleLines: string[]
  footerLines: string[]
  spacerRows: number
  transcriptFooterGapRows: number
  bottomGapRows: number
  short: boolean
  screenshotPath: string
}

const appRoot = resolve(process.env.STACK_REPO_ROOT ?? resolve(import.meta.dir, ".."))
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z"
const proofDir = join(appRoot, ".stack", "evidence", "tui-blackspace", stamp)
mkdirSync(proofDir, { recursive: true })

const renderOptions: TranscriptRenderOptions = {
  expandedBlockIds: new Set<string>(),
  showDetails: false,
  running: false,
  spinnerFrame: 0,
}

const cases: BlackspaceCase[] = [
  {
    name: "worker-resumed-new-thread-short-tail",
    title: "worker",
    columns: 118,
    transcriptRows: 43,
    blocks: [
      {
        id: "worker-new-thread",
        kind: "stack",
        text: "new thread 172b924f · gpt-5.4-mini",
      },
    ],
    tools: [],
    subagents: [],
    options: renderOptions,
  },
  {
    name: "worker-resumed-short-visible-tail",
    title: "worker",
    columns: 118,
    transcriptRows: 34,
    blocks: [
      ...thinkingBlocks(24),
      {
        id: "worker-user",
        kind: "user",
        text: "Stop hardcoding the saved-run path; enumerate the actual evals/smr/reportbench/_runs/reportbench/**/artifacts directories before drawing any score conclusions.",
      },
      {
        id: "worker-agent",
        kind: "agent",
        text: [
          "I enumerated the actual lane runs under evals/smr/reportbench/_runs/reportbench/**/artifacts, found the discovered run with both files, and read:",
          "",
          "- reportbench_output.json",
          "- artifacts/workproduct_container/eval_summary.json",
          "",
          "From that discovered run:",
          "- baseline score: 0.0848",
          "- best candidate: max_achievements",
          "- best score: 0.1515",
          "- delta: +0.0667",
          "",
          "I also removed the saved-run hardcodes from the Craftax candidate wrappers.",
        ].join("\n"),
      },
    ],
    tools: [],
    subagents: [],
    options: renderOptions,
  },
  {
    name: "monitor-sidecar-short-visible-tail",
    title: "monitor",
    columns: 45,
    transcriptRows: 40,
    blocks: [
      ...thinkingBlocks(18),
      {
        id: "monitor-agent",
        kind: "agent",
        text: [
          "Craftax candidate wrappers.",
          "",
          "Current status:",
          "- improved_policy now imports repo-local policies/heuristic_max_achievements.py",
          "- ai_planner now imports repo-local exotic_cybernetics/reference/ai_planner/heuristic_policy.py",
          "- both files compile cleanly",
          "- no remaining hardcoded evals/smr/reportbench/.out references in the Craftax candidate lane",
          "",
          "What's still open:",
          "- the hillclimb has not yet been rerun to prove a better result",
          "- existing lane artifacts show 0.0848 baseline and 0.1515 best candidate, so it's improved but not yet at the 2x target",
          "",
          "I've paused the sidecar and it will wake on the next worker event, operator message, or goal change.",
        ].join("\n"),
      },
    ],
    tools: [],
    subagents: [],
    options: {
      ...renderOptions,
      agentSpeakerLabel: "Monitor",
    },
  },
]

const renderedCases = cases.map(renderCase)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1 })
  for (const rendered of renderedCases) {
    await page.setContent(renderHtml(rendered), { waitUntil: "domcontentloaded" })
    const measured = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(".terminal-row")]
      const lastOccupied = rows.findLastIndex((row) => row.dataset.kind !== "bottom-gap")
      const lastText = rows.findLastIndex((row) => row.dataset.kind === "text")
      const firstFooter = rows.findIndex((row) => row.dataset.kind === "footer")
      const bottomGapRows = rows.length - lastOccupied - 1
      const footerRows = rows.filter((row) => row.dataset.kind === "footer")
      const lastFooter = rows.findLastIndex((row) => row.dataset.kind === "footer")
      const transcriptFooterGapRows =
        lastText >= 0 && firstFooter >= 0
          ? rows.slice(lastText + 1, firstFooter).filter((row) => row.dataset.kind === "spacer").length
          : 0
      return {
        bottomGapRows,
        transcriptFooterGapRows,
        footerAtBottom: lastFooter === lastOccupied,
        footerRows: footerRows.length,
        rows: rows.length,
      }
    })
    rendered.bottomGapRows = measured.bottomGapRows
    rendered.transcriptFooterGapRows = measured.transcriptFooterGapRows
    if (!measured.footerAtBottom || measured.footerRows !== rendered.footerLines.length) {
      rendered.bottomGapRows = Math.max(rendered.bottomGapRows, 1)
    }
    await page.locator(".terminal").screenshot({ path: rendered.screenshotPath })
  }
} finally {
  await browser.close()
}

const failures: string[] = []
for (const rendered of renderedCases) {
  if (rendered.estimatedLines !== undefined && rendered.estimatedLines < rendered.exactLines) {
    failures.push(
      `${rendered.name}: estimated ${rendered.estimatedLines} lines but exact render has ${rendered.exactLines}`,
    )
  }
  if (rendered.bottomGapRows > 0) {
    failures.push(`${rendered.name}: detected ${rendered.bottomGapRows} bottom blackspace rows below input`)
  }
  if (rendered.transcriptFooterGapRows > 0) {
    failures.push(`${rendered.name}: detected ${rendered.transcriptFooterGapRows} blackspace rows between transcript and input`)
  }
}

const summary = {
  ok: failures.length === 0,
  proofDir,
  cases: renderedCases.map((item) => ({
    name: item.name,
    estimatedLines: item.estimatedLines,
    exactLines: item.exactLines,
    visibleLines: item.visibleLines.length,
    spacerRows: item.spacerRows,
    transcriptFooterGapRows: item.transcriptFooterGapRows,
    bottomGapRows: item.bottomGapRows,
    short: item.short,
    screenshotPath: item.screenshotPath,
  })),
  failures,
}
writeFileSync(join(proofDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8")

if (failures.length > 0) {
  console.error(`stack_tui_blackspace_failed: ${failures.join("; ")}`)
  console.error(`proof_dir=${proofDir}`)
  process.exit(1)
}

console.log("stack_tui_blackspace_ok")
console.log(`proof_dir=${proofDir}`)

function renderCase(input: BlackspaceCase): RenderedCase {
  const baseViewport = {
    columns: input.columns,
    lines: input.transcriptRows,
    pageLines: Math.max(3, Math.floor(input.transcriptRows * 0.8)),
  }
  const estimatedLines = estimateShortTranscriptLines(
    input.blocks,
    input.tools,
    input.subagents,
    input.columns,
  )
  const { viewport, short } = transcriptViewportForEstimatedContent(baseViewport, estimatedLines)
  const exactLines = renderTranscriptView(
    input.blocks,
    input.tools,
    input.subagents,
    { ...baseViewport, lines: 500, pageLines: 100 },
    input.options,
    0,
  ).split("\n").length
  const visibleLines = renderTranscriptView(
    input.blocks,
    input.tools,
    input.subagents,
    viewport,
    input.options,
    0,
  ).split("\n")
  const flexGrow = transcriptPaneFlexGrowForContent()
  const emptyRows = Math.max(0, input.transcriptRows - visibleLines.length)
  const spacerRows = flexGrow > 0 ? emptyRows : 0
  const bottomGapRows = flexGrow > 0 ? 0 : emptyRows
  return {
    name: input.name,
    title: input.title,
    estimatedLines,
    exactLines,
    visibleLines,
    footerLines: footerLines(input.title),
    spacerRows,
    transcriptFooterGapRows: 0,
    bottomGapRows,
    short,
    screenshotPath: join(proofDir, `${input.name}.png`),
  }
}

function thinkingBlocks(count: number): TranscriptBlock[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `thinking-${index}`,
    kind: "thinking" as const,
    text: `internal planning heartbeat ${index}`,
  }))
}

function footerLines(title: string): string[] {
  if (title === "monitor") return ["> Message sidecar · enter to send"]
  return [
    "Goal - find a code policy for craftax gamebench and hillclimb it",
    "Active · 1.3M tokens · 31m",
    "> Build anything · /help",
    "worker 5.4-mini med env dev sub on mon on hide",
  ]
}

function renderHtml(input: RenderedCase): string {
  const rows = [
    ...Array.from({ length: input.spacerRows }, () => ({ kind: "spacer", text: "" })),
    ...input.visibleLines.map((line) => ({ kind: "text", text: line })),
    ...input.footerLines.map((line) => ({ kind: "footer", text: line })),
    ...Array.from({ length: input.bottomGapRows }, () => ({ kind: "bottom-gap", text: "" })),
  ]
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; background: #0b0b0c; color: #d7d7dc; }
    .terminal {
      box-sizing: border-box;
      width: ${Math.max(620, input.title === "monitor" ? 420 : 1220)}px;
      padding: 12px;
      background: #0b0b0c;
      border: 2px solid #fd6600;
      font: 20px/1.32 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: pre-wrap;
    }
    .title { color: #fd6600; margin-bottom: 8px; }
    .terminal-row { min-height: 26px; }
    .terminal-row[data-kind="spacer"],
    .terminal-row[data-kind="bottom-gap"] { background: #0b0b0c; }
    .terminal-row[data-kind="footer"] { color: #d7a900; }
  </style>
</head>
<body>
  <main class="terminal" data-case="${escapeHtml(input.name)}">
    <div class="title">${escapeHtml(input.title)}</div>
    ${rows.map((row) => `<div class="terminal-row" data-kind="${row.kind}" data-gap="${row.kind === "gap"}">${escapeHtml(row.text) || "&nbsp;"}</div>`).join("\n")}
  </main>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
