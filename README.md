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

<details>
<summary>First-party installer (planned)</summary>

When release assets are live, the intended default path is:

```bash
curl -fsSL https://stack.usesynth.ai/install.sh | sh
```

Package-manager channels (Homebrew, npm) are deferred until they have their own
install, update, and rollback proofs.

</details>

## Docs

- [Usage & reference](docs/USAGE.md) — controls, stackd API, monitor, workspace config, Stack MCP
- [Synth productivity](docs/SYNTH_PRODUCTIVITY.md) — OSS + hosted workflows
- [Release process](docs/RELEASE.md) — channels, versioning, changelog
- [Distribution](docs/DISTRIBUTION.md) — installer/download contract
- [Telemetry](docs/TELEMETRY.md) — privacy posture and event allowlist
- [Quality](docs/QUALITY.md) — lint, acceptance tiers, StackEval
- [Security](SECURITY.md) — reporting and credential handling

## License

[MIT](LICENSE)
