---
name: stack-local-setup
description: Use when a Stack user needs install, serve, prep, or Docker commands for local Synth research engineering — Stack itself, Codex/Claude skills (oss-gepa first), synth-ai, synth-optimizers, optimizers repo checkout, auth env files, and auto-start on launch. Load this skill before proposing first-time setup or copy-paste bootstrap commands.
---

# Stack local setup

Copy-paste commands for **Codex** and **Claude Code** operators. Stack is built for
**research engineering** (eval containers, OSS GEPA, StackEval) first.

Load **`oss-gepa`** only when local GEPA work is requested. When `../optimizers` exists,
load **`gepa`** for full TOML detail.

## One-shot install

```bash
git clone https://github.com/synth-laboratories/stack.git
cd stack
make install
stack --version
stack doctor

# Python surfaces used by Stack panels
pip install synth-optimizers synth-ai

# Optional: full GEPA skill from optimizers repo checkout
git clone https://github.com/synth-laboratories/optimizers.git ../optimizers
# Override: export STACK_SYNTH_OPTIMIZERS_ROOT=/path/to/optimizers

# Auth — create key at https://usesynth.ai/keys (never print the value)
export SYNTH_API_KEY="..."
# Or set environments.*.authEnvFile in stack.config.json
```

## Local GEPA optimizer service

Stack **Local** panel reads `http://127.0.0.1:8879` (default).

```bash
synth-optimizers gepa service \
  --db .stack/optimizers/gepa-service.sqlite \
  --bind 127.0.0.1:8879
```

In Stack: **Tab → Local**, empty prompt + **Enter** starts GEPA if auto-start failed.

## Launch Stack

```bash
stack
stack --version
```

On **dev**, Stack can auto-start local GEPA (`STACK_AUTO_START_LOCAL_OPTIMIZER=0` to disable).
Disable all auto-start with `STACK_AUTO_START=0`.

Bundled skills live in `.codex/skills/`; Stack syncs them to `~/.stack/skills/` and mirrors
custom skills into the workspace `.codex/skills/` for Codex discovery. Stack **never**
writes to `~/.codex/`.

Logs: `.stack/bootstrap/dev-slot.log`, `.stack/optimizers/gepa-service.log`.

## Config anchors

Read `stack.config.json`:

- `workingDir` — Codex cwd
- `environments.*.apiBaseUrl` — Synth API base URL
- `environments.*.authEnv` / `authEnvFile` — where `SYNTH_API_KEY` is loaded from

Overrides: `STACK_WORKING_DIR`, `STACK_ENVIRONMENT`, `STACK_OPTIMIZER_*`,
`STACK_SYNTH_OPTIMIZERS_ROOT`, `STACK_SYNTH_DEV_ROOT` (optional advanced eval wrappers).

## Agent checklist (first session)

1. Confirm `SYNTH_API_KEY` present when the requested workflow needs hosted auth; do not echo it.
2. If local GEPA is requested and offline, install `synth-optimizers` or use the Local panel.
3. Use only tools and services that are actually available in the current session.

Full command reference: `references/command-cheatsheet.md` in this skill directory.

## Guardrails

- Never print raw API keys.
- Do not scrape Postgres/Redis; use the owning typed SDK, CLI, or API route.
- Stack treats `~/.codex` as read-only (never read `auth.json` into Stack artifacts).
