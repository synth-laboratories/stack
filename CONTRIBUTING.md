# Contributing to Stack

Stack is the Synth research-engineering cockpit (OpenTUI + Codex + Stack MCP). We welcome
bug reports, docs fixes, and focused improvements.

## Before you open a PR

1. Clone the repo and run `make install` (or `bun install` + `./bin/stack --version`).
2. Run `bun run check` — must pass.
3. Run `bun run scripts/check_version_drift.ts` — do not hand-edit versions in
   `package.json` or `Cargo.toml`; change `version.json` and run `make sync-version`.
4. Keep scope tight — one logical change per PR.

## Versioning

- **Source of truth:** `version.json` (`version`, `channel`, `release`).
- `package.json.version` mirrors `version`.
- `Cargo.toml` workspace version mirrors `release` (release floor, not the dev build id).
- Nightly dev cuts: `make bump-dev` (maintainers).

## Security

See [SECURITY.md](SECURITY.md). Do not open public issues for vulnerabilities.

## Code style

Match surrounding TypeScript/Rust conventions. Run `bun run check` before pushing.

## Questions

Open a [GitHub Discussion](https://github.com/synth-laboratories/stack/discussions) or file
an issue with the **question** label.
