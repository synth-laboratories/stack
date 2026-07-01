# Stack Agent Guide

## Repo boundary (read first)

**[`docs/DEVELOPERS.md`](docs/DEVELOPERS.md)** — the `stack` repo is **product-only**.
No testing, linting, or evals code is ever permitted here. Put smokes, harnesses,
graders, and lint gates in `evals/`, `testing/`, or `synth-dev/` and run them against
Stack from outside this repo.

You are often launched from **Stack** (`stack` TUI). On Synth/optimizer/container tasks, load
these Codex skills **before substantial work** (read each `SKILL.md`):

1. **`stack-local-setup`** — install, Docker, dev slot, GEPA, auth, auto-start commands
2. **`synth-via-stack`** — Synth via optimizers, synth-ai, eval containers, local → hosted path
3. **`stack-agent-bridge`** — Stack MCP operator workflow (SMR, Factory, hosted jobs, previews)

Skills ship under `.codex/skills/` in this repo and install to `~/.codex/skills/` on
`make install` or first Stack launch. For Claude Code, symlink the same folders into
`~/.claude/skills/` (see **stack-local-setup**).

## Versioning

- Semver in `package.json`; `stack --version` / `stack -V`.
- Changelog: `CHANGELOG.md`. Release process: `docs/RELEASE.md`.

## Defaults

- Read `stack.config.json` for `workingDir`, API environments, and optimizer service URLs.
- Stack registers the Stack MCP server on Codex turns from the Agent pane.
- On **dev**, Stack auto-starts local GEPA and tries `synth-dev/scripts/local.sh up slot1`
  when the dev API is offline (disable with `STACK_AUTO_START=0` or per-feature env vars).
- Start live ops with `stack_status` (`mode: "all"`), then narrow to local or remote.
- Never print raw API keys; use owner routes and Stack MCP instead of scraping persistence.
