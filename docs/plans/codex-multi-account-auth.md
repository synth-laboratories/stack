# Codex multi-account auth

Plan for Stack-managed Codex login, logout, account rotation, and auth sync between
personal `~/.codex` and Stack's isolated `CODEX_HOME`.

## Problem

Stack runs Codex workers with `CODEX_HOME=<workspace>/.stack/codex-home`, but the TUI
historically observed auth from `~/.codex`. Re-auth in the Codex app updates personal
home only; isolated home keeps a one-time-seeded `auth.json` until manually fixed.
Result: Lights shows a healthy account while gardener/workers hit **401 Unauthorized**.

Observed on 2026-07-07:

| Home | Email | last_refresh |
|------|-------|--------------|
| `~/.codex/auth.json` | jmvpurtell@gmail.com | 2026-07-06 |
| `.stack/codex-home/auth.json` | josh@usesynth.ai | 2026-07-05 |

## Principles

1. **Isolated home stays** — workers never write to personal `~/.codex` sessions.
2. **Codex owns OAuth** — Stack wraps `codex login` / `codex logout`, does not reimplement.
3. **Metadata only on disk** — `accounts.json` and `auth_ledger.jsonl` never store tokens.
4. **Tokens live in `auth.json`** — copying between homes is explicit operator action or auto-sync policy.
5. **Display what workers use** — all Stack auth reads use `config.codexHome`.

## On-disk layout

```
.stack/codex/
  accounts.json          # registry of known accounts (metadata)
  auth_ledger.jsonl      # existing passive sign-in/out observations
  auth_ledger_state.json

.stack/codex-home/
  auth.json              # tokens used by Stack Codex subprocesses
  sessions/              # Stack-only threads

~/.codex/
  auth.json              # personal Codex CLI / desktop auth
  profiles/*.json        # saved account snapshots (Codex CLI legacy)
```

### `accounts.json` schema

```json
{
  "schema_version": "stack.codex_accounts.v1",
  "active_account_id": "f5771de9-27a…",
  "updated_at": "2026-07-07T…",
  "accounts": [
    {
      "account_id": "f5771de9-27a…",
      "email": "jmvpurtell@gmail.com",
      "auth_mode": "chatgpt",
      "label": "jmvpurtell@gmail.com",
      "first_seen_at": "…",
      "last_seen_at": "…",
      "last_refresh": "2026-07-06T19:09:02Z",
      "status": "active",
      "sources": ["personal", "isolated", "profile"],
      "profile_slug": "jmvpurtell_gmail"
    }
  ]
}
```

## CLI surface

```
stack codex status [--json]              Active account, drift, probe health
stack codex login [--no-browser] [--json]   CODEX_HOME=isolated codex login
stack codex logout [--json]              CODEX_HOME=isolated codex logout
stack codex sync [--force] [--profile <slug>] [--json]
stack codex accounts list [--json]
stack codex accounts scan [--json]       Import ~/.codex/profiles/*.json metadata
stack codex accounts use <email|id|profile> [--json]
```

## TUI surface

- Connection bar shows isolated account; red suffix when auth drift/stale/unhealthy.
- Slash commands: `/codex status`, `/codex sync`, `/codex login`, `/codex logout`, `/codex use <selector>`.
- `/codex login` opens browser flow via detached CLI hint when interactive login is needed.

## Sync policy

On Stack startup (`loadConfig`), unless `STACK_CODEX_AUTO_SYNC=0`:

- If isolated `auth.json` is missing → copy from personal.
- If personal `last_refresh` is newer than isolated → copy personal → isolated.
- If account identities differ and personal is newer → copy and log drift resolution.

Explicit: `stack codex sync` or `/codex sync`.

Account rotation: `stack codex accounts use <selector>` copies profile or registry-known auth into isolated home.

## Health probe

`stack codex status` runs a short-lived app-server `account/rateLimits/read` against isolated home.
Failure with auth errors → `healthy: false`, TUI shows `auth expired · stack codex login`.

## Implementation checklist

- [x] `src/codex/accounts-registry.ts` — registry read/write, scan profiles, upsert
- [x] `src/codex/auth-sync.ts` — status, sync, login, logout, activate, auto-sync
- [x] `src/codex/codex-auth-cli.ts` — CLI wiring
- [x] `src/config.ts` — startup auto-sync
- [x] `src/tui/app.ts` — read isolated home, staleness in connection bar
- [x] `src/tui/slash-commands.ts` — `/codex …`
- [x] `src/main.ts` — `stack codex` subcommand

## Future (not v1)

- Restart gardener/worker app-server sessions on account switch (operator restart Stack for now).
- MCP tools `stack_codex_status`, `stack_codex_login`.
- Watch personal `auth.json` mtime and prompt sync in TUI.
