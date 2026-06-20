# Stack

Private Synth Labs repository for the local/remote research stack: cloud SMR,
Research Factory control, local terminal operations, optimizer flows, and
WorkProduct data exchange.

## Notes

- [SMR code TUI sketch](notes/2026-06-19-smr-code.txt)

## Prototype 0

Prototype 0 is a local OpenTUI cockpit with a working Codex agent pane.

```bash
bun install
./bin/stack
```

Controls:

- `Enter`: send the Agent prompt to local Codex
- `Tab`: switch between Agent input and Local Context
- `j` / `k`: move through Local Context files
- `Space`: include/exclude the highlighted context file
- `Esc`: quit

Stack writes local session logs under `.stack/sessions/`. Remote SMR,
WorkProducts, and hosted optimizer jobs are placeholders in Prototype 0.

The status bar shows the Codex model and reasoning effort from
`~/.codex/config.toml`. Override them for a run with `STACK_CODEX_MODEL` and
`STACK_CODEX_REASONING_EFFORT`.
