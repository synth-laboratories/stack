# Stack developer policy

**Audience:** anyone committing to the `stack` repository — humans and coding agents.

This repo ships the **Stack product**: the operator cockpit (OpenTUI TUI), Stack MCP,
stackd runtime, packaging, and product documentation. It is not a home for verification
machinery.

---

## Hard rule (non-negotiable)

**No testing, linting, or evals code is ever permitted in the `stack` repository.**

Do not add it. Do not move it here from other repos. Do not “temporarily” land it while
you iterate. If a change needs tests, linters, smokes, harnesses, graders, or eval tasks,
those belong in the repos listed below — not in `stack`.

Agents and reviewers should treat any PR that introduces the forbidden categories as
**out of scope** and block it regardless of how small or “obviously helpful” the diff looks.

---

## Forbidden in `stack`

### Testing

- Directories named `tests/`, `test/`, `__tests__/`, `spec/`, `e2e/`, `acceptance/`, or similar
- Files whose primary job is automated verification: `*_test.rs`, `*_test.ts`, `test_*.py`,
  `*.spec.ts`, `*.test.ts`, expect/tmux harness scripts, Bombadil property packs
- Smoke, acceptance, regression, or end-to-end **runner scripts** under `stack/scripts/`
- In-repo CI suites whose purpose is to execute tests against Stack (GitHub Actions jobs,
  `make test`, `npm test`, etc.)
- Test fixtures, golden files, snapshot dirs, and mock servers used only for verification

**Allowed:** product runtime code that happens to expose a `--help` or health check is fine.
That is not a test suite.

### Linting and static-analysis tooling owned by this repo

- ESLint, Biome, Prettier-as-gate, Ruff, Clippy-as-gate, rustfmt-as-gate configs under `stack/`
- `package.json` / `Makefile` targets whose primary purpose is lint or format enforcement
- Pre-commit hooks in this repo that run linters or formatters
- Custom lint rules, boundary checkers, or “quality gate” scripts that live in `stack/`

**Allowed:** `tsc --noEmit` or `cargo check` run **manually** by a developer before commit
is a local habit, not something this repo defines or owns. Stack does not ship lint config.

### Evals

- StackEval task definitions, pipeline TOML, graders, reviewers, harness engines, or wrappers
- GameBench / GE-* eval implementations, property tests framed as eval receipts, or dogfood
  scoring code
- `.stack/stackeval/**` task packs or eval configs checked into `stack`
- Scripts whose name or purpose is `stackeval:*`, `smoke:*`, `accept:*`, `bombadil:*`, or equivalent

Eval **integration hooks** in product code (e.g. stackd routes that *call* hosted eval APIs)
are product surface — still no eval harness or grader code in this repo.

---

## Where verification lives instead

| Kind of work | Canonical repo / path |
| --- | --- |
| StackEval tasks, pipeline, graders | `~/Documents/GitHub/evals/stackeval/` |
| TUI / goal / tmux end-to-end acceptance | `~/Documents/GitHub/testing/stack/` |
| Bombadil B0/B1 probes and TUI smokes | `~/Documents/GitHub/testing/stack/smoke/` (or sibling under `testing/`) |
| CI wrappers (`./scripts/ci.sh …`) | `~/Documents/GitHub/synth-dev/` |
| Acceptance specs and launch proof IDs | `~/Documents/GitHub/Jstack/.jstack/product/` |
| Monitor / gardener eval user stories | `~/Documents/GitHub/evals/stackeval/monitor-eval/`, `gardener-eval/` |

Run evals and smokes **against** an installed or cloned Stack checkout; do not copy the
harness into `stack` to make that easier.

---

## What belongs in `stack`

| Area | Examples |
| --- | --- |
| Product source | `src/`, `crates/stackd/`, `crates/stack-core/` |
| Operator/runtime scripts | install, release, bump, daemon, wake policy — not verification |
| Packaging | Homebrew formulae, installer assets |
| Product docs | `README.md`, `docs/USAGE.md`, `CHANGELOG.md`, actor scope notes |
| Bundled operator guidance | `.codex/skills/`, `bundled/guidance/` (product norms, not eval tasks) |

When in doubt: **if deleting it would not remove a feature the operator uses in the TUI or
MCP, it probably does not belong here.**

---

## Legacy note

Older branches may still contain smoke scripts, eval stubs, or quality docs that reference
in-repo gates. Those are **migration debt**, not permission to add more. New work follows
this policy; retiring in-repo verification is tracked separately.

For how release proof is collected without violating this boundary, see
[`QUALITY.md`](./QUALITY.md) (operator-facing gate names) and run the actual commands from
`evals/`, `testing/`, or `synth-dev/` — not from new files under `stack/scripts/`.

---

## Agent instruction (copy-paste)

> The `stack` repo is product-only. Never add tests, lint configs, smoke scripts, acceptance
> harnesses, Bombadil packs, or StackEval tasks here. Implement verification in `evals/`,
> `testing/`, or `synth-dev/` and execute it against Stack from outside the repo.

See also [`AGENTS.md`](../AGENTS.md) for Stack operator defaults.
