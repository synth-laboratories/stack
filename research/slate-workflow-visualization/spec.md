# Slate Workflow Visualization Spec

Source: https://x.com/realmcore_/status/2074259057515643125  
Author: akira (@realmcore_)  
Published: 2026-07-06 22:27:51 UTC  
Local source video: `slate-deep-research-original.mp4`  
Review video: `slate-deep-research-review.mp4`  
Contact sheet: `contact-sheet.png`  
Screenshots: `screenshots/frame_01.png` through `screenshots/frame_08.png`

## Tweet Claim

The tweet frames Slate as a deep-research agent runner that parses agent orchestration control flow and renders it through the task harness. The visible product claim is not just "agents are running"; it is "the operator can inspect how the agent program is structured while it runs."

## Video Summary

The video shows a dark terminal UI split into two primary regions:

- Left pane: the live program run, including the user request, active subagents, status, elapsed time, model choices, and the agent's natural-language run note.
- Right pane: a visual graph for the active program, showing the control flow of a deep codebase research workflow.

The right pane is the notable feature. It visualizes a task program as a live execution graph with condition nodes, loop edges, subagent launch nodes, return nodes, and status-dependent branches.

## UI Anatomy

### Global Shell

- Branding: large `SLATE` wordmark in the upper-left.
- Workspace selector: shows `~/.../slate`.
- Account selector: `Personal`.
- Quick Start card: lightweight command prompts such as `/help` and `/docs`.
- Bottom command bar: prompt-like input area for mentions, files, and commands.
- Footer context: model, thinking level, mode, current path, and branch.

### Left Run Pane

The left pane is a live execution log for one program:

- User task: "Run the deep codebase research program to find where commands are registered in the tui."
- Program status row: `Running program deep-codebase-research`.
- Subagent count: transitions from `1 subagent, 0/1 complete` to `4 subagents, 1/4 complete`.
- Subagent list:
  - `deep-codebase-research::prober:1`
  - `deep-codebase-research::reader:1:2`
  - `deep-codebase-research::reader:1:3`
  - `deep-codebase-research::reader:1:1`
- Per-subagent model labels:
  - `anthropic/claude-opus-4.8`
  - `anthropic/claude-haiku-4.5`
- Per-subagent activity:
  - `Read tui.ts`
  - `Reading randomlab...`
  - `Working...`
  - `Listed utils`
  - `Listed config`
  - `Read app.tsx`
- Completion marker: green check and `Done` for completed subagents.
- Progress wait row: `Waiting for 3 subagents to complete...` with a compact progress indicator.
- Run setup note: `Set Program (Execute) model for this run to Claude 4.8 Opus`.
- Coordinator note: plain-language statement of what the program is doing and what it will report.
- Bottom status line: `Running the deep-codebase-research program for ...`.

### Right Graph Pane

The graph pane has:

- Breadcrumb: `Programs / deep-codebase-research`.
- Status: `Running...`.
- Tabs: `Graph` active, `Details` inactive.
- Scrollable canvas with vertical and horizontal overflow.
- Control-flow nodes laid out top-to-bottom.
- Orange-highlighted nodes for active or semantically important graph steps.
- Dim gray nodes for inactive, completed, blocked, or less prominent branches.
- Directed arrows connecting nodes.
- Branch labels such as `Yes`.
- A loop edge labeled `loop`.

## Graph Semantics

The graph is a rendered execution plan, not a generic dependency list. It appears to encode a program like:

```text
deep-codebase-research
  if !objective:
    return { status: "blocked", reason: ... }
  for round <= maxDepth:
    if nextProbes.length == 0:
      run prober subagent
    if s.status == "running":
      return { ...snapshot(s), note: ... }
    for result of readerResults:
      run reader subagent
    if evaluation.sufficient:
      finish
    else:
      loop to next round
```

The exact internal DSL is not visible, but the graph exposes these concepts:

- Objective gate: `!objective Yes=>Yes`.
- Early failure return: `return { status: "blocked", reason: "deep-codebase-rese..." }`.
- Bounded iterative search: `for round <= maxDepth Yes=>Yes`.
- Probe fanout gate: `nextProbes.length == 0 Yes=>Yes`.
- Dynamic subagent launch: ``deep-codebase-research:prober:${round}``.
- Runtime status check: `s.status == "running"`.
- Snapshot return while work continues: `return { ...snapshot(s), note: "This research packet is..." }`.
- Parallel reader launch: `Promise.all(probesThisRound) parallel`.
- Reader result aggregation: `for const result of readerResults`.
- Evaluator launch: ``deep-codebase-research:evaluator:${round}``.
- Sufficiency check: `evaluation.sufficient`.
- Loop back to the next probe round.

## Visual Encoding

### Node Types

- Program node: blue outline, used for the root program label.
- Condition node: orange outline, diamond icon, predicate text.
- Loop node: orange condition-style node with an external loopback edge.
- Subagent/action node: gray or orange box with a small circular icon and generated subagent id.
- Return node: gray box with code-like return payload.
- Parallel block: orange label `parallel` above a grouped action sequence.
- Aggregation node: orange box for `for const result of readerResults`.
- Evaluation node: orange condition/action box for `evaluation.sufficient`.

### Colors

- Background: near black.
- Primary text: off-white.
- Secondary text: gray.
- Accent purple: program names, status, model/run setup.
- Active graph accent: amber/orange.
- Completed state: green in the left run pane.
- Root/program accent: light blue.

### Motion and State

The video mostly shows panning/scrolling and incremental status changes, not elaborate animation. The important dynamic behavior is:

- The left run pane updates as subagents spawn and complete.
- The graph viewport scrolls down through the control flow as execution advances.
- The graph highlights the currently relevant section with orange nodes.
- The program status remains visible at the top of the graph pane.

## Workflow Visualization Pattern

The product pattern is "code-like control flow made operationally visible":

1. The operator starts a high-level program.
2. Slate compiles or parses that program into a visible control-flow graph.
3. The graph renders branches, loops, parallelism, and returns.
4. The live run pane ties graph execution to concrete subagents.
5. The operator can inspect both the human-readable run note and the exact orchestration structure.
6. The UI supports long-running work by showing where execution currently is, why it is waiting, and what subagents are active.

## Comparison To Stack

This maps directly to Stack's long-running Effort and Gardener direction:

- Slate `Programs` ~= Stack `Efforts` plus launchable work recipes.
- Slate graph ~= an Effort/Gardener control-flow plan view.
- Slate subagent list ~= Stack worker/meta-thread association and monitor sidecar events.
- Slate orange active nodes ~= Stack milestone/acceptance/current-action state.
- Slate return snapshots ~= Stack handoff packets, blocker receipts, and progress summaries.
- Slate reader/prober/evaluator agents ~= Stack worker lanes, eval lanes, artifact lanes, and review lanes.

The gap for Stack is visualizing the control plane itself. Stack already stores a lot of the required data: Effort refs, activity events, blockers, run evidence, worker associations, acceptance receipts, and monitor events. Slate's differentiator is turning that into a live execution graph instead of only list/detail panels.

## Stack Feature Spec: Effort Flow Graph

### Objective

Add a graph view for Stack Efforts that shows the current orchestration plan and live execution state across gardener, workers, evals, artifacts, blockers, and acceptance gates.

### Primary User

A research engineer or operator managing a long-running Stack Effort with several worker threads, local checks, hosted runs, and proof artifacts.

### Core Concepts

- Effort: durable workstream root.
- Milestone: ordered or DAG node representing an outcome.
- Gate: condition required before a transition.
- Worker: Codex thread, subagent, eval player, or external actor.
- Receipt: proof artifact that satisfies a gate.
- Blocker: external dependency with next owner and next safe action.
- Loop: repeated research/eval cycle until sufficient evidence exists.
- Snapshot: current state summary emitted while work remains active.

### Graph Node Types

- Effort root: title, status, active branch.
- Milestone node: intended outcome, scope, status.
- Gate node: acceptance predicate, required evidence, current pass/fail/unknown.
- Worker node: thread id, role, model/profile, current activity, elapsed time.
- Run node: optimizer, SMR, Factory, StackEval, or local command run.
- Artifact node: WorkProduct, screenshot, release tarball, benchmark packet, scorecard.
- Blocker node: owner, evidence, next safe action.
- Review node: branch review, roadmap audit, acceptance audit.
- Return/snapshot node: human-facing progress update.

### Edges

- `then`: normal progression.
- `parallel`: fanout to multiple workers or checks.
- `waits_on`: blocked by external dependency or prerequisite.
- `satisfies`: receipt/artifact satisfies gate.
- `loops_to`: repeated optimization/eval/research cycle.
- `routes_to`: gardener dispatch to worker/meta-thread.
- `graduates_to`: local proof graduates to hosted proof.

### Live State Encoding

- Active node: amber outline.
- Running worker/run: purple accent plus spinner or elapsed timer.
- Passed gate: green accent.
- Failed gate: red accent with reason.
- Waiting on external owner: yellow/amber blocker treatment, but Effort status remains active or paused, never blocked.
- Unknown/not started: gray.
- Root/coordinator: blue.

### Required Data Sources

- `efforts/<slug>/effort.toml`
- `efforts/<slug>/PROGRESS.md`
- `efforts/<slug>/ACTIVITY.jsonl`
- `efforts/<slug>/findings/proof/`
- `efforts/<slug>/findings/results/`
- Effort refs and session ledgers.
- Stack MCP activity and status tools.
- Meta-thread manifests with `gardener_thread_id` and `effort_ref`.
- Monitor sidecar events.
- Acceptance and blocker receipts.

### Minimum Viable View

1. Add `Graph` tab to `/efforts` detail view.
2. Render Effort root -> milestones -> gates -> receipts as a vertical graph.
3. Show active worker threads as side branches from the current milestone.
4. Highlight newest `ACTIVITY.jsonl` event.
5. Show unresolved blocker node with owner and next safe action.
6. Allow switching between `Graph` and `Details`.

### Better Version

1. Include loop edges for optimizer/eval cycles.
2. Include local-to-hosted graduation edges.
3. Include receipt-to-gate satisfaction edges.
4. Animate new activity with a short pulse.
5. Add keyboard navigation by node.
6. Press Enter on a node to open the source receipt, worker thread, artifact, or proof file.
7. Add an exportable PNG/SVG snapshot for handoffs.

### Non-Goals

- Do not infer hidden orchestration that is not represented in typed Stack data.
- Do not scrape backend databases, Redis, or raw Codex session state.
- Do not create a new lifecycle status named `blocked`.
- Do not make the graph the only way to inspect an Effort; it complements list/detail/handoff views.

### Acceptance Bar

- A Banking77 or Craftax Effort renders as a coherent graph from existing Effort files.
- Active worker/meta-thread refs appear in the graph.
- At least one proof receipt is linked to an acceptance gate.
- Unresolved blockers are visible as blocker nodes with next owner and next safe action.
- Generated graph state is deterministic from local files and typed Stack APIs.
- The graph can be exported as a static screenshot for handoff.

## Implementation Notes For Stack

- Use existing Effort storage as source of truth.
- Build an intermediate graph model before rendering:
  - `nodes: EffortGraphNode[]`
  - `edges: EffortGraphEdge[]`
  - `active_node_id`
  - `source_refs`
- Prefer TUI-native rendering first. A later HTML/SVG exporter can reuse the same graph model.
- Keep graph layout mostly vertical, with parallel lanes branching horizontally.
- Optimize for scanability in terminal width: compact labels, details panel on selection.
- Preserve keyboard ergonomics: `j/k` select nodes, `h/l` move across branches, `Enter` opens details, `e` exports.

## Open Questions

- Should Stack require explicit milestone graph declarations, or infer them from `PROGRESS.md` and receipts?
- Should gardener plans emit structured control-flow events that can be graphed directly?
- Should graph rendering live in stackd as JSON plus TUI renderer, or entirely in the client?
- How should very large Efforts collapse or summarize inactive branches?
- Can existing monitor sidecar events provide enough live state to animate active nodes without extra instrumentation?
