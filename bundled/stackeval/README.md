# StackEval

StackEval task configs live in this directory and are owned by Stack.

## Active task id

| Task id | Command |
| --- | --- |
| **`banking77-local-gepa`** | `./bin/stackeval run banking77-local-gepa --preset smoke` |
| **`crafter-local-gepa`** | `./bin/stackeval run crafter-local-gepa --preset smoke` |
| **`tictactoe-harbor-env-rebuild`** | `bun run stackeval:tictactoe-harbor-env-rebuild:prepare` then `bun run stackeval:tictactoe-harbor-env-rebuild` |

Presets: Banking77 uses `smoke` / `dev` / `gate`. TicTacToe Harbor uses TS wrapper presets in `tasks/tictactoe-harbor-env-rebuild.toml` (`smoke`, `gate`).

Task prompts and task metadata live under `tasks/<task-id>.*`.
