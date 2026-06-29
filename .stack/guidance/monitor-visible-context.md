# Monitor-visible context manifest

STACK_MEMORY|ts=2026-06-29T02:48:00Z|repo=stack|kind=spec|file=.stack/guidance/monitor-visible-context.md|commit=pending|severity=LOW|time_lost=unknown

This file is the stable list of Stack/workspace context the Stack monitor is
allowed to retrieve through the bounded guidance index. The monitor does not
receive a raw dump of external memory trees.

## Indexed Context

| Source | Scope | Style layer | Notes |
| --- | --- | --- | --- |
| `backend/specifications/tanha/references/synthstyle.md` | `style` | `org` | Synth Style source of truth for this workspace. |
| `specifications/old/tanha/references/synthstyle.md` | `style` | `org` | Historical Synth Style copy when that checkout exists. |
| `.stack/guidance/style/*.md` | `style` | `app` | Stack product norms and focused excerpts. |
| `.stack/guidance/style/repo/*.md` | `style` | `repo` | Repo-local style conventions. |
| `STYLE.md` | `style` | `repo` | Workspace root style file when present. |
| `~/.stack/guidance/style/*.md` | `style` | `personal` | Operator personal style guidance; override root with `STACK_PERSONAL_GUIDANCE_DIR`. |
| `.stack/guidance/records/mldp/*.md` | `records` | none | Curated learnings, mistakes, and desires copied for monitor/StackEval visibility. |
| `.stack/guidance/records/papercuts/*.md` | `records` | none | Curated friction records. |
| `.stack/guidance/records/decisions/*.md` | `records` | none | Local Stack ADRs and decisions. |
| `.stack/guidance/workflows/*.md` | `workflows` | none | Optional local workflow prose when present. |

## Excluded By Default

- Arbitrary daily notes outside `.stack/guidance/**`
- External evidence packets
- External goal/spec progress files
- Full product specs and roadmaps
- Lint output, generated artifacts, and temporary run logs
- Growth records and unrelated product ledgers
- Secrets, `.env` files, raw credentials, and private API responses

Copy only the high-signal excerpt or record into `.stack/guidance/records/`
when a monitor, StackEval run, or rollout harness should see it.

## Proof

`bun run smoke:guidance:l2` proves that the active checkout indexes:

- at least one app-layer style item,
- Synth Style,
- curated MLDP records,
- curated papercuts.
