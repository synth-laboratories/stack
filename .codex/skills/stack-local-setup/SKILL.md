---
name: stack-local-setup
description: Use when a Stack user needs install, serve, prep, or Docker commands for local Synth research engineering — Stack itself, Codex/Claude skills (oss-gepa first), synth-ai, synth-optimizers, optimizers repo checkout, synth-dev slots, auth env files, and auto-start on launch. Load this skill before proposing first-time setup or copy-paste bootstrap commands.
---

# Stack local setup

Copy-paste commands for **Codex** and **Claude Code** operators. Stack is built for
**research engineering** (eval containers, OSS GEPA, StackEval) first; these commands
also cover general dev bootstrap. Stack auto-runs much of this on launch (dev
environment); use this skill when the user needs manual recovery or a fresh machine.

Also load **`synth-stack-productivity`** (OSS + hosted map), **`oss-gepa`** (local GEPA +
optimizers repo), **`synth-via-stack`** (optimizer/container mental model), and
**`stack-agent-bridge`** (usesynth.ai MCP ops). When `../optimizers` exists, load **`gepa`**
for full TOML/cookbook detail.

## One-shot install

```bash
# Homebrew — stable public release
brew tap synth-laboratories/tap
brew install stack

# Homebrew — dev/nightly (main, update often)
brew install stack-dev

# Source — active development (skills → ~/.codex/skills/ on install)
make -C ~/Documents/GitHub/stack install

# Python surfaces used by Stack panels (research engineering default path)
pip install synth-optimizers synth-ai

# Optional: full GEPA skill + dev_examples (private org repo)
git clone git@github.com:synth-laboratories/optimizers.git ~/Documents/GitHub/optimizers
# Stack auto-bridges optimizers/skills/gepa → .stack/skills/gepa on launch
# Override: export STACK_SYNTH_OPTIMIZERS_ROOT=/path/to/optimizers

# Auth (never print the value)
# Default dev auth file from stack.config.json:
#   ../synth-ai/.env  →  SYNTH_API_KEY=sk_...
```

Claude Code skills (optional — same content as Codex):

```bash
mkdir -p ~/.claude/skills
for skill in synth-stack-productivity stack-local-setup oss-gepa synth-via-stack stack-agent-bridge; do
  ln -sf ~/Documents/GitHub/stack/.codex/skills/"$skill" ~/.claude/skills/"$skill"
done
```

## Docker + dev slot (backend, worker, eval containers)

Stack's **Synth Hosted** panel needs the dev API (`http://127.0.0.1:8000` by default).
The canonical path is **synth-dev slots** — not ad-hoc compose or bare uvicorn.

```bash
# 1) Docker daemon (OrbStack on macOS is the local default)
docker info

# 2) Start slot1 (backend + worker + container sidecar)
cd ~/Documents/GitHub/synth-dev
./scripts/local.sh up slot1

# 3) Status / teardown
./scripts/local.sh status slot1
./scripts/local.sh down slot1
```

**Dockerized eval smoke** (proves container contract through the slot):

```bash
cd ~/Documents/GitHub/synth-dev
./scripts/eval.sh run smr/suites/readme_smoke_docker_codex.toml \
  --target local-dockerized \
  --instance slot1
```

Container HTTP contract (required for optimizers): `GET /health`, `GET /info`, `POST /rollout`.
Reference: `synth-ai/openapi/container-contract-v1.yaml`.

## Local GEPA optimizer service

Stack **Local** panel reads `http://127.0.0.1:8879` (default).

```bash
# Manual start (Stack also auto-starts on dev launch)
synth-optimizers gepa service \
  --db ~/Documents/GitHub/stack/.stack/optimizers/gepa-service.sqlite \
  --bind 127.0.0.1:8879
```

In Stack: **Tab → Local**, empty prompt + **Enter** starts GEPA if auto-start failed.

## Launch Stack

```bash
stack
stack --version   # channel: stable | dev; dev shows stable release line
```

On **dev**, Stack tries on startup (disable piecemeal with env vars):

| Auto-start | Default (dev) | Disable |
| --- | --- | --- |
| Bundled Codex skills → `~/.codex/skills/` | on | — |
| Local GEPA (`synth-optimizers gepa service`) | on | `STACK_AUTO_START_LOCAL_OPTIMIZER=0` |
| Dev slot (`local.sh up slot1`) when API offline | on | `STACK_AUTO_START_DEV_SLOT=0` |
| All auto-start | on | `STACK_AUTO_START=0` |

Logs: `.stack/bootstrap/dev-slot.log`, `.stack/optimizers/gepa-service.log`.

Right ops panel (**`p`** toggles Local vs Synth Hosted) shows setup hints when auth, Docker,
API, CLI, or GEPA is missing.

## Config anchors

Read `stack.config.json` in the Stack repo:

- `workingDir` — Codex cwd
- `environments.dev.apiBaseUrl` — dev API (default `127.0.0.1:8000`)
- `environments.dev.authEnvFile` — where `SYNTH_API_KEY` is loaded from
- `readmeSmoke.instance` — slot name (default `slot1`)

Overrides: `STACK_SYNTH_DEV_ROOT`, `STACK_WORKING_DIR`, `STACK_ENVIRONMENT`,
`STACK_OPTIMIZER_*`, `STACK_README_SMOKE_INSTANCE`.

## Agent checklist (first session)

1. Load this skill + `synth-via-stack` + `stack-agent-bridge`.
2. Confirm `docker info` and `SYNTH_API_KEY` present (do not echo the key).
3. If dev API offline → `cd synth-dev && ./scripts/local.sh up slot1`.
4. If local GEPA offline → `pip install synth-optimizers` or **Enter** on Local panel.
5. `stack_status` with `mode: "all"` — report which surfaces are ready vs missing.

Full command reference: `references/command-cheatsheet.md` in this skill directory.

## Guardrails

- Never print raw API keys.
- Prefer synth-dev wrappers over ad-hoc Docker compose for backend/slots.
- Do not scrape Postgres/Redis; use Stack MCP and owner API routes.
- On shared machines, do not `down` or kill slots you did not start.
