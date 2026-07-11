# Stack shipping — gates & procedure (locked-in)

The repeatable process for shipping Stack to the nightly channel. Built from the
2026-06-29/30 launch; codifies every gate and command so updates ship fast.

Canonical deploy mechanics: [`synth-dev/deployment/runbooks/stack_launch_prod_deploy.md`](../../synth-dev/deployment/runbooks/stack_launch_prod_deploy.md).

## The four surfaces (each ships on its own system)

| Surface | Repo | Prod mechanism |
| --- | --- | --- |
| Product (CLI/cockpit) | `stack` | merge `main` → cut GitHub release (`v…`) + manifest |
| Inference / API | `backend` | cherry-pick dev→staging→main → `railway up --service api` from a **clean worktree** |
| Marketing | `frontend` | promote dev→staging→main → Vercel auto-deploys |
| Docs | `docs` | merge → `main` → Mintlify auto-deploys |

There is no single button. Ship each surface; verify each.

## Gate ladder (must pass before deploy)

```
G0 SCOPE      change scoped; surfaces identified; no migration unless intended
G1 BUILD      stack: `bun run check` (tsc --noEmit && cargo build -p stackd) green
              backend: `python -m py_compile <changed>`; frontend: `bun run build:vercel`
G2 SMOKES     stack: telemetry-contract, stackd-telemetry, growth-ingestion (local),
              launch-docs-alignment, release-site-contract, bombadil-b0, first-run-local
G3 CANDIDATE  clean worktree; `bun run launch:candidate -- --select --write-evidence`
              essentials green: ready=N, needs_candidate=0, needs_live_proof=0, missing=0
G4 LIVE PROOF growth-ingestion live POST (staging, or prod with --allow-prod-post);
              auth→use→meter E2E green: `bun run scripts/smoke_auth_use_e2e.ts`
G5 DEPLOY     per-surface (below); deploy backend from a CLEAN worktree only
G6 POST-DEPLOY probe all surfaces live; verify SHA/behavior; growth + usage flowing
G7 MONITOR    record owners + monitoring window; watch growth funnel, Nemotron COGS, telemetry
```

## Deploy commands (G5)

**Backend** (clean worktree — `railway up` ships the working tree, never deploy a dirty checkout):
```bash
git fetch origin staging main
git worktree add ../backend-ship-main origin/main && cd ../backend-ship-main
git switch -c ship-main && git cherry-pick <commit>      # also onto dev + staging
python -m py_compile <changed files>
railway link --project c0f46994-46e0-4b3b-a08b-cc1138c0cba2 --environment production --service api
railway status            # MUST read: production / api  — verify before up
railway up --service api --environment production --detach
```

**Frontend**: cherry-pick/patch onto `staging` then `main`, push → Vercel deploys.
**Docs**: merge to `main` → Mintlify.
**Stack**: merge to `main`; rebuild artifact; `gh release create v… --prerelease` + manifest.

## Post-deploy probe (G6) — run after every ship
```bash
curl -s https://api.usesynth.ai/health                                  # env=prod
curl -s -o /dev/null -w '%{http_code}' https://api.usesynth.ai/api/v1/synth/models   # 401 (mounted)
SYNTH_API_KEY=… bun run stack/scripts/smoke_auth_use_e2e.ts             # auth→use→meter GREEN
curl -s -o /dev/null -w '%{http_code}' https://docs.usesynth.ai/stack/overview       # 200
```

## Known footguns (learned the hard way)

- **Dirty deploy checkout** — `cloud.sh`/`railway up` ship the working tree; the main
  backend checkout is often dirty with parallel WIP. Always deploy from a clean worktree.
- **Stale health SHA** — `railway up` does not set `RAILWAY_GIT_COMMIT_SHA`, so `/health`
  git_sha lags. Verify deploys by behavior (live endpoints + E2E), not the health SHA.
- **stack-aux requires `X-Stack-Actor-Role: aux`** — without it, inference 403s. Docs/E2E must send it.
- **Missing prod secret = silent failure** — set `BASETEN_AUX_API_KEY` (or
  `BASETEN_NEMOTRON_INFERENCE_API_KEY`) on the `api` service or inference 503s.
  `warn_if_baseten_unconfigured()` now logs this loudly at boot.
- **Divergent branches** — backend/frontend `dev`/`staging`/`main` are divergent lineages;
  **cherry-pick** between them, never `merge dev→staging`.
- **Direct main pushes are gated** — use PRs for `main` on every repo.

## Config & secrets (one-time, per environment)
```
api service (production): BASETEN_AUX_API_KEY | BASETEN_NEMOTRON_INFERENCE_API_KEY
hosting (ops): serve install.sh + nightly.json at stack.usesynth.ai
```

## What "shipped" means for Stack (the journey, not just the deploy)

A Stack nightly is shippable only when a new user can, end-to-end:
1. **discover** — landing + docs live
2. **download** — install.sh / release artifact runs (`stack`, `stack demo`)
3. **configure with Codex** — `.codex/skills/stack-local-setup`, `synth-via-stack`
4. **signup → Ultra aux** — Synth key → `nemotron-3-ultra` via stack-aux (E2E green)
5. **run on normal coding** — a real coding session in the cockpit
6. **run with GEPA optimizers** — `stackeval *-local-gepa` tasks pass
7. **proven** — `stackeval` run green + docs current

Track these in the readiness readout: `Jstack/.jstack/daily_notes/<date>/nightly_public_alpha_launch.md` (Stack launch SSOT).
