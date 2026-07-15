<h1 align="center">Stack</h1>
<p align="center">A local research-engineering cockpit — a Codex agent pane, GEPA prompt optimization, and Stack MCP for hosted Synth ops, in one terminal UI.</p>

Stack runs locally: an OpenTUI cockpit with a [Codex](https://developers.openai.com/codex) agent pane, OSS prompt optimization (GEPA via `synth-optimizers`), StackEval receipts, and Stack MCP for hosted Synth ops — SMR, Research Factory, optimizers, and WorkProducts — across dev, staging, and prod. It is built for research engineering first and works for everyday coding too.

Open source (MIT), public alpha. Install from source today; a first-party installer is planned.

## Quickstart

### Requirements

- [Bun](https://bun.sh)
- [Codex CLI](https://developers.openai.com/codex)

### Install from source

```bash
git clone https://github.com/synth-laboratories/stack.git
cd stack
make install
stack --version
```

### First run

```bash
stack doctor   # check your environment
stack demo     # local, signed-out demo
stack          # launch the cockpit
```

To update: `git pull && make install`.

### Hosted features (optional)

SMR, Research Factory, and hosted optimizers need a Synth API key from
[usesynth.ai/keys](https://usesynth.ai/keys). Set `SYNTH_API_KEY` in your
environment, or point `stack.config.json` at a key file via
`environments.*.authEnvFile`. The local cockpit, demo, and OSS optimizers work
without an account.

For remote development, select `slot1-cloud` or `slot2-cloud` beside the normal
`dev`/`staging`/`prod` target. The same hosted cockpit continues to show SMRs,
Factories, WorkProducts, and artifacts while adding the selected
CloudDeployment's endpoint, exact source SHA, lifecycle, health, claim, fencing,
and failure truth. The Agent bridge can discover declared services, inspect or
materialize exact repository state, execute bounded argv, and retrieve declared
service logs without a provider-side path. Cloud slots are retained remote VMs,
so claim/heartbeat, fenced mutations, and owned retirement are explicit; Stack
sends those operations only through the typed Synth owner routes.

<details>
<summary>First-party installer (planned)</summary>

When release assets are live, the intended default path is:

```bash
curl -fsSL https://stack.usesynth.ai/install.sh | sh
```

Package-manager channels (Homebrew, npm) are deferred until they have their own
install, update, and rollback proofs.

</details>

## What's new — Monitor Gardener Goal release (dev)

Stack `0.2.0-dev.20260703.2` sharpens the live cockpit: `/lights on` opens a
right-panel status view with scrollable/filterable threads, gardener/actor/cloud
status, local runtime, and usage. `/gardener` opens in the core panel, goal mode
keeps worker chat and slash commands available, and Stack MCP now gives the
gardener owner-route tools for creating durable worker/meta threads.

See [CHANGELOG.md](CHANGELOG.md) and [Usage § Slash commands](docs/USAGE.md#slash-commands).

## Docs

**Website:** [docs.usesynth.ai/stack](https://docs.usesynth.ai/stack/overview) — quickstart, goal mode, cockpit, MCP, configuration.

**In-repo (engineers):**

- [Usage & reference](docs/USAGE.md) — deep operator reference
- [Synth productivity](docs/SYNTH_PRODUCTIVITY.md) — OSS + hosted workflows
- [Release process](docs/RELEASE.md) — channels, versioning, changelog
- [Distribution](docs/DISTRIBUTION.md) — installer/download contract
- [Telemetry](docs/TELEMETRY.md) — privacy posture and event allowlist
- [Quality](docs/QUALITY.md) — lint, acceptance tiers, StackEval
- [Security](SECURITY.md) — reporting and credential handling

## License

[MIT](LICENSE)
