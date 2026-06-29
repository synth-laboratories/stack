# Style layers

Stack indexes **multiple style docs** per operator. Each layer is optional,
grep-friendly markdown, and tagged with `style_layer` in MCP search results.

| Layer | Where | Who maintains | Examples |
| --- | --- | --- | --- |
| **org** | Workspace Synth Style source | Org / platform | `backend/specifications/tanha/references/synthstyle.md` |
| **repo** | Workspace root | Team per repo | `STYLE.md`, `.stack/guidance/style/repo/*.md` |
| **personal** | Operator home | Each user | `~/.stack/guidance/style/*.md` |
| **app** | Stack app root | Stack product | `.stack/guidance/style/stack-norms.md`, `.stack/guidance/style/jstack-style-excerpt.md`, excerpts |

## Precedence (inject / conflict)

When guidance is injected into a thread, **narrower layers win**:

`personal` → `repo` → `app` → `org`

Search returns **all** matching layers; filter with MCP `style_layer`.

## Personal setup

```bash
mkdir -p ~/.stack/guidance/style
cp ~/Documents/GitHub/stack/fixtures/guidance/personal.example.md ~/.stack/guidance/style/coding.md
```

Override: `STACK_PERSONAL_GUIDANCE_DIR`.

## Repo setup

Add a top-level `STYLE.md` and/or drop focused files under
`.stack/guidance/style/repo/` (e.g. `api.md`, `frontend.md`). Multiple files
are encouraged — one topic per file beats a monolith.

## MCP

```text
stack_guidance_list scope=style style_layer=personal
stack_search_guidance query="no git stash" style_layer=repo
```

## Monitor steering

Style steering uses this same style index. A detected violation searches
`scope=style`, records a thread-scoped `guidance.query`, then emits
`monitor.steer` with the selected `guidance_id` and excerpt. The monitor sees
bounded excerpts, not the entire guidance corpus.
