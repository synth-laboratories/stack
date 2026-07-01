# Synth stack productivity — Stack north star

**Status:** Active · **Priority:** P0  
**Audience:** Stack engineers, agent skills, launch gates  
**One line:** Stack must make research engineers hyper-productive across **Synth OSS** and **Synth hosted** (`synth-ai` + `usesynth.ai`) from one cockpit.

---

## What “hyper-productive” means

An operator or agent in Stack should reach any Synth surface in **one environment switch + one skill read + one MCP call** — not by hunting repos, guessing URLs, or reimplementing HTTP.

| Outcome | Pass bar |
| --- | --- |
| Local OSS GEPA | `pip install synth-optimizers` → Local Research panel live → job list + artifacts |
| Container eval | synth-dev slot up → container `/rollout` smoke → synth-ai SDK list/create |
| StackEval receipt | `bun run stackeval:run` → packet with ids |
| Hosted optimize | Same container config → Hosted Optimizers panel → preview artifact |
| Live SMR / Factory | `stack_status` remote → list → message/preview with run ids |
| Auth | `SYNTH_API_KEY` from env file; signup/keys URLs in TUI; never leak secrets |

General software engineering works in Stack; **research engineering** (eval → optimize → receipt → publish) is the default path we optimize.

---

## Two stacks, one cockpit

```text
                    ┌─────────────────────────────────────┐
                    │              Stack TUI               │
                    │  env: dev | staging | prod           │
                    │  local ◀──▶ remote (Agent Bridge)      │
                    └───────────┬─────────────┬─────────────┘
                                │             │
           OSS / local          │             │  Hosted / closed
                                ▼             ▼
        synth-optimizers GEPA   │      api.usesynth.ai
        optimizers repo skill   │      usesynth.ai (keys, signup)
        synth-dev slots         │      synth-ai SDK + CLI
        StackEval / GameBench   │      SMR · Factory · hosted optimizers
        local containers        │      WorkProducts · artifacts
```

**Rule:** prove on OSS locally, graduate to hosted with the **same container config** and cite run ids on both sides.

---

## Operator surfaces in Stack

| Panel / mode | OSS | Hosted |
| --- | --- | --- |
| **Local Research** | `synth-optimizers gepa service` | — |
| **Hosted Optimizers** | — | backend `/api/v1/optimizers/*` via MCP |
| **Remote SMR / Factory** | local README-smoke wrapper | live runs on selected env |
| **Environment (`j/k`)** | dev API + local slot | staging/prod `api.usesynth.ai` |
| **Skills** | `oss-gepa`, `gepa`, `stackeval` | `stack-agent-bridge`, `synth-via-stack` |
| **Stack MCP** | local status, skills, stackd | list/preview/message/cancel remote resources |

---

## Agent-first defaults

Load order for Codex in Stack:

1. **`synth-stack-productivity`** — this doc’s skill summary (OSS + hosted map)
2. **`oss-gepa`** — install CLI + optimizers checkout when optimizing locally
3. **`synth-via-stack`** — container contract, local → hosted graduation
4. **`stack-agent-bridge`** — MCP live ops on usesynth.ai
5. **`gepa`** — full TOML/cookbook depth when optimizers repo is present

Stack symlinks bundled skills on install/launch and bridges `optimizers/skills/gepa` when sibling checkout exists.

**stackd registry (first-class):** on serve, stackd bootstraps preinstalled skills (`oss-gepa`, `hosted-gepa`, `synth-ai`) into `.stack/skills/registry.json` and exposes `GET/POST /skills`. Gardener can add custom skills via `skills.register` / `skill register …` in chat. See Jstack note `stack_skill.md`.

---

## Bootstrap (dev)

On **dev**, Stack auto-starts when possible:

| Substrate | Default | Disable |
| --- | --- | --- |
| Codex skills → `~/.codex/skills/` | on | — |
| Local GEPA service | on | `STACK_AUTO_START_LOCAL_OPTIMIZER=0` |
| synth-dev slot1 when API offline | on | `STACK_AUTO_START_DEV_SLOT=0` |

Missing pieces surface in the right ops panel with copy-paste fix commands — not silent failure.

---

## Launch gates tied to productivity

These are P0 for “Stack is hyper-productive with Synth” claims:

| Gate | Proves |
| --- | --- |
| `smoke:install-skills` | oss-gepa + core skills (+ bridged gepa when present) |
| Real goal acceptance in `../testing/stack/end_to_end/tui_goal/` | meta-thread + monitor + handoff (long-horizon RE) |
| `stackeval:banking77-local-gepa --preset smoke` | OSS optimizer path through Stack |
| `smoke:stackd` + MCP local threads | stackd + agent bridge substrate |
| Hosted optimizer preview/download smoke | closed-stack artifact path (T1) |
| Environment auth smoke dev/staging/prod | usesynth.ai key loads per env |

---

## Non-goals (explicit)

- Stack is not a second backend — typed stackd/MCP only; no scraping Postgres/Redis.
- Stack is not a generic IDE — it orchestrates Synth research loops.
- Nightly builds may be rough; they must not break install, skills sync, or env/auth wiring.

---

## Related

- Skills: `.codex/skills/synth-stack-productivity/`, `oss-gepa`, `synth-via-stack`, `stack-agent-bridge`
- Launch prep: `Jstack/.jstack/daily_notes/2026-06-29/stack_synth_productivity_north_star.md`
- Public docs: `docs/docs/stack/overview.mdx`
- Acceptance: `Jstack/.jstack/product/specs/stack_acceptance.md`
