# Stack Agent Guide

## Repo boundary (read first)

**[`docs/DEVELOPERS.md`](docs/DEVELOPERS.md)** — the `stack` repo is **product-only**.
No testing, linting, or evals code is ever permitted here. Put smokes, harnesses,
graders, and lint gates in `evals/`, `testing/`, or `synth-dev/` and run them against
Stack from outside this repo.

You may be launched from the **Stack** TUI. Repository context must not imply that an
external tool, MCP server, or hosted control surface is available. Use only tools that
are actually exposed in the current session. For Synth work outside this product repo,
follow the owning repository and its typed SDK or CLI.

## Versioning

- Semver in `package.json`; `stack --version` / `stack -V`.
- Changelog: `CHANGELOG.md`. Release process: `docs/RELEASE.md`.

## Defaults

- Read `stack.config.json` for `workingDir`, API environments, and optimizer service URLs.
- On **dev**, Stack auto-starts local GEPA and tries `synth-dev/scripts/local.sh up slot1`
  when the dev API is offline (disable with `STACK_AUTO_START=0` or per-feature env vars).
- Never print raw API keys or scrape another service's persistence.
