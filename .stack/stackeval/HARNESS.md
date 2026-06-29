# StackEval tmux harness (programmatic replay v0)

Codex/agent-driven Stack TUI testing for StackEval — ncode-style loop grounded in
stackd receipts.

## Quick start

```bash
cd ~/Documents/GitHub/stack
./bin/stackeval harness prepare banking77-local-gepa --preset smoke
export STACKEVAL_PACKET="<packet-dir-from-output>"
```

This creates:

- StackEval packet skeleton (`initial_prompt.txt`, `metadata.json`, …)
- `harness/OPERATOR.md` — Codex pickup commands
- tmux session `stack-stackeval` (stackd + `./bin/stack`)
- `harness.debug.json` — first stackd snapshot

## Codex inspection loop

| Step | Command | Purpose |
| --- | --- | --- |
| Structured state | `tail -80 "${STACKEVAL_PACKET}/harness.debug.json"` | stackd health, threads, trace pointers |
| Refresh state | `./bin/stackeval harness status --capture-pane -o "${STACKEVAL_PACKET}/harness.debug.json"` | update JSON + optional pane |
| Terminal snapshot | `./bin/stackeval harness capture -o "${STACKEVAL_PACKET}/harness.capture.json"` | pane text + stackd bundle |
| Receipt export | `./bin/stackeval harness export-thread --packet-dir "${STACKEVAL_PACKET}" -o "${STACKEVAL_PACKET}/harness.export.json"` | SE-B77-5-TRACE material |

## Finish automated pipeline

After human/agent completes the Banking77 task in Stack:

```bash
./bin/stackeval run banking77-local-gepa --preset smoke \
  --packet-dir "${STACKEVAL_PACKET}" \
  --from-stage harvest
```

## Commands

```bash
./bin/stackeval harness up [--packet-dir PATH]
./bin/stackeval harness down
./bin/stackeval harness attach
./bin/stackeval harness status [--capture-pane] [-o PATH]
./bin/stackeval harness capture [-o PATH] [--lines N]
./bin/stackeval harness export-thread [--thread-id ID] [--packet-dir PATH] -o PATH
```

Implementation: `stack/scripts/stackeval/tmux_harness.sh` +
`stack/scripts/stackeval/lib/tmux_harness.py`.
