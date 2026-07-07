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
import {
  gardenerAgentBlockHeight,
  gardenerPlanBlockHeight,
  gardenerTranscriptRowsWithReserve,
} from "../src/tui/gardener-pane-layout.js"

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

// Tier-2 overlap detection: compose the gardener pane as regions with an allocation (flex box
// height) and content (rows rendered), composite into a fixed row grid, and flag any cell written
// by two regions. The transcript's content height comes from the app's real
// gardenerTranscriptRowsWithReserve, so a regression in that reservation resurfaces here as overlap.
type PaneCompositeSpec = {
  name: string
  paneRows: number
  columns: number
  planSteps: number
  agents: number
  controlRows: number
  reserveWidgets: boolean
  expectOverlap: boolean
}

const paneCompositeSpecs: PaneCompositeSpec[] = [
  { name: "gardener-pane-reserved-3agents-4steps", paneRows: 24, columns: 80, planSteps: 4, agents: 3, controlRows: 2, reserveWidgets: true, expectOverlap: false },
  { name: "gardener-pane-reserved-9agents-no-plan", paneRows: 20, columns: 60, planSteps: 0, agents: 9, controlRows: 2, reserveWidgets: true, expectOverlap: false },
  // Detector self-test: the pre-fix behavior (transcript ignores the widgets below) MUST overlap.
  { name: "gardener-pane-detector-selftest-unreserved", paneRows: 24, columns: 80, planSteps: 4, agents: 3, controlRows: 2, reserveWidgets: false, expectOverlap: true },
]

const paneComposites = paneCompositeSpecs.map((spec) => {
  const regions = gardenerPaneRegions(spec)
  const collisions = paneOverlaps(regions, spec.paneRows)
  const grid = compositePaneDisplay(regions, spec.paneRows)
  return { spec, regions, collisions, grid, screenshotPath: join(proofDir, `${spec.name}.png`) }
})

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
  for (const composite of paneComposites) {
    await page.setContent(renderPaneHtml(composite), { waitUntil: "domcontentloaded" })
    await page.locator(".terminal").screenshot({ path: composite.screenshotPath })
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

for (const composite of paneComposites) {
  const overlapped = composite.collisions.length > 0
  if (overlapped !== composite.spec.expectOverlap) {
    const detail = composite.collisions.map((c) => `row ${c.row} (${c.under}↔${c.over})`).join(", ")
    failures.push(
      composite.spec.expectOverlap
        ? `${composite.spec.name}: overlap detector failed to flag a known overlap (expected collisions, found none)`
        : `${composite.spec.name}: text overlap detected — ${composite.collisions.length} colliding rows: ${detail}`,
    )
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
  paneComposites: paneComposites.map((composite) => ({
    name: composite.spec.name,
    expectOverlap: composite.spec.expectOverlap,
    overlapRows: composite.collisions.length,
    collisions: composite.collisions,
    screenshotPath: composite.screenshotPath,
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

type PaneRegion = { name: string; allocation: number; lines: string[] }
type PaneCell = { text: string; collision: boolean; region?: string }

function paneFillerLines(prefix: string, count: number, columns: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => `${prefix} ${index + 1}`.slice(0, columns))
}

function gardenerPaneRegions(spec: {
  paneRows: number
  columns: number
  planSteps: number
  agents: number
  controlRows: number
  reserveWidgets: boolean
}): PaneRegion[] {
  const planHeight = gardenerPlanBlockHeight(spec.planSteps)
  const agentHeight = gardenerAgentBlockHeight(spec.agents)
  // buildAgentTranscriptViewport hands the transcript a budget that already excludes the control row.
  const transcriptViewportLines = spec.paneRows - spec.controlRows
  const transcriptContent = spec.reserveWidgets
    ? gardenerTranscriptRowsWithReserve(transcriptViewportLines, planHeight, agentHeight)
    : transcriptViewportLines // pre-fix bug: fill the whole budget, ignore the widgets below
  const transcriptAllocation = spec.paneRows - spec.controlRows - planHeight - agentHeight
  return [
    { name: "transcript", allocation: Math.max(1, transcriptAllocation), lines: paneFillerLines("transcript", transcriptContent, spec.columns) },
    { name: "plan", allocation: planHeight, lines: paneFillerLines("Plan · Step", planHeight, spec.columns) },
    { name: "control", allocation: spec.controlRows, lines: paneFillerLines("gardener gpt-5.5 · low · env dev", spec.controlRows, spec.columns) },
    { name: "agents", allocation: agentHeight, lines: paneFillerLines("Agents · live", agentHeight, spec.columns) },
  ]
}

/** Place each region at its allocated row offset; flag any row a second region writes over. */
function paneOverlaps(regions: readonly PaneRegion[], paneRows: number): { row: number; over: string; under: string }[] {
  const owner: (string | undefined)[] = new Array(paneRows).fill(undefined)
  const collisions: { row: number; over: string; under: string }[] = []
  let cursor = 0
  for (const region of regions) {
    for (let index = 0; index < region.lines.length; index += 1) {
      const row = cursor + index
      if (row < 0 || row >= paneRows) continue
      if (!region.lines[index]?.trim()) continue
      const existing = owner[row]
      if (existing !== undefined && existing !== region.name) {
        collisions.push({ row, under: existing, over: region.name })
      } else {
        owner[row] = region.name
      }
    }
    cursor += region.allocation // advance by the allocated box height, not the content length
  }
  return collisions
}

/** Composite the pane for the screenshot; overlapping rows show both regions' text merged. */
function compositePaneDisplay(regions: readonly PaneRegion[], paneRows: number): PaneCell[] {
  const grid: PaneCell[] = Array.from({ length: paneRows }, () => ({ text: "", collision: false }))
  let cursor = 0
  for (const region of regions) {
    for (let index = 0; index < region.lines.length; index += 1) {
      const row = cursor + index
      if (row < 0 || row >= paneRows) continue
      const line = region.lines[index]
      if (!line?.trim()) continue
      const cell = grid[row]
      if (cell.region && cell.region !== region.name) {
        cell.text = `${cell.text}${line}`
        cell.collision = true
      } else {
        cell.text = line
        cell.region = region.name
      }
    }
    cursor += region.allocation
  }
  return grid
}

function renderPaneHtml(composite: { spec: { name: string }; grid: PaneCell[] }): string {
  const rows = composite.grid
    .map(
      (cell) =>
        `<div class="terminal-row" data-region="${escapeHtml(cell.region ?? "")}" data-collision="${cell.collision}">${escapeHtml(cell.text) || "&nbsp;"}</div>`,
    )
    .join("\n")
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; background: #0b0b0c; color: #d7d7dc; }
    .terminal {
      box-sizing: border-box; width: 1220px; padding: 12px; background: #0b0b0c;
      border: 2px solid #fd6600;
      font: 20px/1.32 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: pre;
    }
    .title { color: #fd6600; margin-bottom: 8px; }
    .terminal-row { min-height: 26px; }
    .terminal-row[data-region="agents"] { color: #fd6600; }
    .terminal-row[data-region="control"] { color: #d7a900; }
    .terminal-row[data-collision="true"] { background: #5a1111; color: #ffb3b3; }
  </style>
</head>
<body>
  <main class="terminal">
    <div class="title">${escapeHtml(composite.spec.name)}</div>
    ${rows}
  </main>
</body>
</html>`
}
