# Handoff: exit/resume doesn't properly restore the Codex session

## The complaint (verbatim intent)

When you exit Stack and resume a thread/meta-thread, the underlying Codex
conversation should come back for real — the model should have its actual
memory of the thread restored, not just a string reminding it what the goal
was. A concurrent session in this repo built exactly that string-reminder
("inject goal context into every prompt") as a fix for "agent doesn't know
its own goal" — that's a reasonable safety net to keep, but it is **not** a
substitute for fixing real session continuity, and the user explicitly
rejected treating it as the fix. The real bug is upstream: resume isn't
reliably reconnecting to the original Codex thread.

## What's confirmed true (verified directly, not guessed)

1. **`codex app-server` has real persistent sessions.** `thread/start`
   returns a thread id backed by a rollout file on disk
   (`~/.codex/sessions/<date>/rollout-<timestamp>-<id>.jsonl`). Verified by
   spawning `codex app-server` directly and inspecting the `thread/start`
   response.
2. **Stack's resume code path calls the right RPC, in principle.**
   `CodexAppServerSession.ensureReady()`
   (`src/codex/app-server-session.ts`) does:
   ```ts
   if (this.threadId) {
     await this.client.request("thread/resume", { threadId: this.threadId })
     return
   }
   ```
   `this.threadId` is set from `options.resumeThreadId`, which is threaded
   from `assignHarnessSession(..., resumeBackendThreadId)` in `src/tui/app.ts`.
   The most recent checkpoint on disk
   (`<stackDataRoot>/.stack/checkpoints/latest.json`) for this user's session
   does show the wiring working: `codexTransport: "app-server"`,
   `harnessResume.resumeMethod: "thread/resume"`, and a real
   `backendSessionId` UUID. So the mechanism *can* work.
3. **Root cause of why it usually doesn't, found and fixed this session:**
   `codexAppServerArgs()` (`src/codex/app-server-client.ts`) was passing
   `-m <model>` straight through to `codex app-server`, which has **no**
   `-m`/`--model` flag (only `codex exec` does — confirmed via
   `codex app-server --help`). Every attempt to start app-server crashed
   immediately with `error: unexpected argument '-m' found`, and Stack
   silently caught that and fell back to **exec transport**:
   ```ts
   // src/tui/app.ts runOneTurn(), app-server branch
   catch (error) {
     codexSessionHandle.session = undefined
     state.codexTransport = "exec"
     appendStackBlock(state.blocks, `app-server unavailable; using codex exec (...)`)
   }
   ```
   **Exec transport has no native session/resume mechanism at all** — every
   `codex exec` invocation is a fresh, stateless process. Whatever continuity
   exec-mode sessions have is 100% synthetic, manually rebuilt by Stack from
   the last 8 turns (`buildStackHarnessPrompt`'s "Restored Stack transcript"
   section). This is why resume has felt broken: most/all sessions were
   silently stuck on the stateless transport, and nobody surfaced that they'd
   degraded.
   - Fix already landed: `-m <model>` is now translated to `-c model="<model>"`
     for app-server (the correct way, per `codex app-server --help`).
   - Regression test added: `scripts/smoke_codex_app_server_args.ts`
     (wired into `smoke:acceptance:t0`).
   - Also added: `CodexAppServerClient` now captures the last ~20 stderr
     lines + exit code/signal from the app-server process and folds them
     into thrown errors, instead of silently discarding stderr (it was doing
     that before, which is part of why this bug went unnoticed for so long).

## What's still broken / needs the next pass

### 1. Crash on resume — blocks verifying anything else (highest priority)

User's literal repro, pasted from their terminal:
```
stack resume 77580577
stack fatal: Error: Failed to create TextBuffer
    at createTextBuffer (.../@opentui/core/index-pcvh9d34.js:14033:17)
    ...
    at mountView (/Users/joshpurtell/Documents/GitHub/stack/src/tui/app.ts:1770:19)
    at remount (/Users/joshpurtell/Documents/GitHub/stack/src/tui/app.ts:1323:12)
```
This is a **fatal crash in opentui's native text-buffer allocation**, not a
JS exception — it happens while building the initial Box tree on first
render after resume. Not yet root-caused. Leading hypothesis (unverified):
the resumed session in question is the same one shown elsewhere in this
conversation with **329k tokens** of accumulated turn history, and something
in the transcript-rendering path is handing opentui's native `TextBuffer`
allocator an unbounded/oversized string for a single `Text` element, which
the native binding can't allocate.

Where to look:
- `buildStackHarnessPrompt` (`src/codex/app-server-session.ts`) already
  bounds *prompt construction* to the last 8 turns
  (`options.priorTurns.slice(-8)`), but that's a separate code path from
  *rendering* the transcript in the TUI.
- Check `state.blocks` population on resume
  (`refreshAgentContextFromSession`/`refreshAgentContextFromThread`,
  `src/tui/app.ts:7467` and `:7496`) and whatever turns
  `blocksFromTurnStdout`/`renderTurns` convert into `Text` content — is there
  any cap on how much raw `turn.stdout` gets concatenated into one
  `Text({content: ...})` element? If a single turn's stdout is enormous
  (e.g. a giant tool output), that alone could exceed whatever limit
  `createTextBuffer` has.
- Confirm by testing: resume a session with a deliberately huge single turn
  (e.g. a turn whose `stdout` is several MB) and see if it reproduces in
  isolation, to pin down whether it's total-conversation-size or
  single-turn-size that matters.

### 2. Stale transport gets blindly trusted on resume

`restoreWorkerSessionAfterResume` (`src/tui/app.ts:9610`) does:
```ts
if (checkpoint?.codexTransport) {
  state.codexTransport = checkpoint.codexTransport
}
```
It never re-probes whether app-server is available now — it just trusts
whatever was recorded at the *previous* exit. Any session that was
checkpointed while app-server was broken (i.e. basically every session
before the `-m` fix above) will keep resuming into exec transport forever,
even though app-server now works. Two options worth considering:
- Re-run `probeCodexAppServerAvailability` on resume instead of trusting the
  checkpoint's recorded transport unconditionally (at least when the
  checkpoint is old / from before this fix).
- Or: treat `codexTransport: "exec"` in a checkpoint as a soft preference,
  not a hard pin — retry app-server once per resume and only fall back if it
  genuinely fails again.

This is very likely why "meta goal is not working" reproduced even on a
freshly-relaunched window in this session — the session being tested was
probably one of the many checkpointed-while-broken sessions, permanently
stuck on stateless exec transport regardless of the `-m` fix landing later.

### 3. Resume-token format is inconsistent (UX confusion, lower priority)

`resumeCheckpointFromCheckpoint()` (`src/resume-checkpoint.ts`):
```ts
export function resumeCheckpointFromCheckpoint(checkpoint: StackResumeCheckpoint): string {
  if (checkpoint.metaThreadId) return resumeTokenFromMetaThreadId(checkpoint.metaThreadId)
  return checkpoint.sessionId.slice(0, 8)
}
```
The printed `stack resume <id>` hint alternates between an 8-char **thread**
id and a ~12-digit **meta-thread** numeric token, depending on whether a
meta-thread happened to be bound at the moment of exit. Both formats *are*
accepted by `resolveResumeCheckpointLocal` (it matches either
`session.id.startsWith(trimmed)` or `session.metaThreadId?.includes(trimmed)`),
so functionally it isn't broken, but it reads as "the id keeps changing for
no reason" from the user's side, especially across many exits while
bouncing between goal-bound and plain threads. Worth either:
- Always displaying (and preferring) the thread id, with the meta-thread id
  shown alongside but not substituted in, or
- Clearly labeling which kind of id is being printed (`thread:` / `goal:`
  prefix), consistent with the `⧉` copy-icon UI added earlier this session
  (`agentPanelIdsText` in `src/tui/app.ts`) which already shows both ids
  side by side in the panel header for exactly this reason.

## Do NOT re-investigate (already done this session)

- `codexAppServerArgs()` `-m` flag bug — fixed, has a regression test.
- `CodexAppServerClient` swallowing stderr on crash — fixed, now captured
  and surfaced in error messages.
- A TS narrowing bug in `formatActiveGoalForPrompt` that was blocking the
  whole project's typecheck — fixed (`src/codex/app-server-session.ts`).
- The goal-context-into-every-prompt mechanism itself
  (`buildStackHarnessPrompt`, `formatActiveGoalForPrompt`) — built by a
  concurrent session, confirmed working as a supplementary safety net (the
  model now gets a fresh "Active Stack goal" section with an explicit
  "answer from this section" instruction on every turn, across all three
  transports: exec, app-server, ACP). Keep it — just don't treat it as
  the fix for #1/#2 above.

## Suggested order of attack

1. Fix the `TextBuffer` crash (#1) — nothing else can be verified live until
   resume stops crashing.
2. Fix stale-transport-on-resume (#2) — this is very likely the actual
   reason "the agent doesn't remember anything" even after the `-m` fix.
3. Re-test the exact user repro (exit, resume, ask the agent "are you
   working on a goal?" without relying on the prompt-injection safety net to
   carry it) to confirm real session memory is restored.
4. Clean up the resume-token display inconsistency (#3) once the above are
   solid — it's cosmetic confusion, not a functional bug.
