---
name: stack-local-setup
description: Use when a Stack user needs install, serve, prep, or Docker commands for local Synth research engineering — Stack itself, Codex/Claude skills (oss-gepa first), synth-ai, synth-optimizers, optimizers repo checkout, auth env files, and auto-start on launch. Load this skill before proposing first-time setup or copy-paste bootstrap commands.
---

# Stack local setup

Copy-paste commands for **Codex** and **Claude Code** operators. Stack is built for
**research engineering** (eval containers, OSS GEPA, StackEval) first.

Also load **`synth-stack-productivity`** (OSS + hosted map), **`oss-gepa`** (local GEPA),
**`synth-via-stack`** (optimizer/container mental model), and **`stack-agent-bridge`**
(usesynth.ai MCP ops). When `../optimizers` exists, load **`gepa`** for full TOML detail.

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

Claude Code skills (optional):

```bash
mkdir -p ~/.claude/skills
for skill in synth-stack-productivity stack-local-setup oss-gepa synth-via-stack stack-agent-bridge; do
  ln -sf "$(pwd)/.codex/skills/$skill" ~/.claude/skills/"$skill"
done
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

1. Load this skill + `synth-via-stack` + `stack-agent-bridge`.
2. Confirm `SYNTH_API_KEY` present (do not echo the key).
3. If local GEPA offline → `pip install synth-optimizers` or **Enter** on Local panel.
4. `stack_status` with `mode: "all"` — report which surfaces are ready vs missing.

Full command reference: `references/command-cheatsheet.md` in this skill directory.

## Guardrails

- Never print raw API keys.
- Do not scrape Postgres/Redis; use Stack MCP and owner API routes.
- Stack treats `~/.codex` as read-only (never read `auth.json` into Stack artifacts).
