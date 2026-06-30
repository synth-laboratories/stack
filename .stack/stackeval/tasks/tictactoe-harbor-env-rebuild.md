# StackEval Task: TicTacToe Harbor env rebuild

**Task id:** `tictactoe-harbor-env-rebuild`  
**Owner/operator:** Josh  
**Mode:** Stack + Harbor spectrum verify (host)  
**Default model:** `gpt-5.4-mini-medium`  
**Status:** active  
**Harbor bundle:** `gamebench/adapters/harbor/bundles/tictactoe_singleplayer_gold`  
**Active packet pointer:** `stack/.stack/evidence/stackeval/tictactoe-harbor-env-rebuild/latest.json`

## Objective

Use Stack to rebuild the Harbor-native Tic-Tac-Toe singleplayer gold environment from specs:

1. Read normative specs under `workspace/spec/`.
2. Implement `workspace/candidate/gold/`, `workspace/candidate/policies/`, and `workspace/candidate/scripts/run_service.py`.
3. Pass Harbor spectrum verification (20 scenarios) via `spectrum_eval.py`.

This is **not** the code-policy hillclimb lane and **not** a single `heuristic_policy.py` deliverable.

## Starting Prompt

Harbor `instruction.md` is adapted to absolute packet paths at prepare time. See packet `initial_prompt.txt`.

## Commands

```bash
cd ~/Documents/GitHub/stack

# Prepare cleanroom packet only
bun run stackeval:tictactoe-harbor-env-rebuild:prepare

# Prepare + launch Stack (auto-submit prompt)
bun run stackeval:tictactoe-harbor-env-rebuild

# Verify an existing packet after Stack completes
bun run stackeval:tictactoe-harbor-env-rebuild:verify -- --packet-dir <packet>
```

GameBench-native Harbor run (no Stack):

```bash
cd ~/Documents/GitHub/gamebench
./adapters/harbor/run.sh dev codex tictactoe-singleplayer
```

## Acceptance gates

| Gate | Meaning |
| --- | --- |
| SE-TTT-HARBOR-1-WORKSPACE | Full candidate tree present |
| SE-TTT-HARBOR-2-SERVICE | HTTP service starts on 19081 |
| SE-TTT-HARBOR-3-SPECTRUM | `verifier/result.json` with harbor_reward |
| SE-TTT-HARBOR-4-TRACE | Stack session preserved in packet |
| SE-TTT-HARBOR-5-LANE | No policy-hillclimb artifacts |

## Forbidden lanes

- `tictactoe_gamebench_code_policy_deo_hillclimb_1cand`
- `run_tictactoe_gamebench_hillclimb_task.py`

## Related docs

- Jstack lane map: `.jstack/daily_notes/2026-06-29/gamebench_lane_map_env_codegen.md`
- Stack quality guide: `stack/docs/QUALITY.md` §GameBench
