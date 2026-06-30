<h1 align="center">Stack</h1>

<p align="center"><strong>A local cockpit for long coding-agent runs.</strong></p>

<p align="center">
  Stack makes long agent runs observable, turns every run into an auditable receipt,
  and works entirely on your machine — no signup required. Hosted Synth features are optional.
</p>

<p align="center">
  <a href="https://github.com/synth-laboratories/stack/releases"><img alt="Release" src="https://img.shields.io/github/v/release/synth-laboratories/stack?include_prereleases&sort=semver"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="https://docs.usesynth.ai/stack/overview"><img alt="Docs" src="https://img.shields.io/badge/docs-usesynth.ai-orange"></a>
</p>

---

> **Status: Nightly.** Stack is pre-1.0 and ships nightly. Expect rough edges and
> known limitations. macOS (Apple Silicon) today; Linux to follow.

## What is Stack?

Research engineering means babysitting long, expensive agent runs — and losing the
thread when they sprawl across hours and terminals. Stack is a terminal cockpit that
keeps those runs **observable** and **reproducible**:

- **See the whole run.** A live TUI over your coding agent — transcript, status, and
  progress in one place, even for multi-hour sessions.
- **Every run is a receipt.** Each run writes a local, auditable record of what
  happened and how to reproduce it.
- **Local-first.** `stack doctor`, `stack demo`, receipts, and update checks all work
  signed-out. Sign in only when you want hosted Synth features.

## Install

**Nightly (macOS, Apple Silicon):**

```bash
curl -fsSL https://stack.usesynth.ai/install.sh | sh
```

Or grab the tarball from [Releases](https://github.com/synth-laboratories/stack/releases)
and run the bundled installer.

**From source** (requires [Bun](https://bun.sh)):

```bash
git clone https://github.com/synth-laboratories/stack
cd stack && bun install
bun run src/main.ts
```

## Quickstart

```bash
stack            # launch the cockpit
stack demo       # run a local demo and write a receipt — no signup
stack doctor     # check your environment
stack update     # check for a newer nightly
```

That's the whole signed-out loop: launch, run, get a receipt.

## Features

| | |
| --- | --- |
| **Observable runs** | Live TUI over long agent sessions — transcript, status, progress. |
| **Receipts** | Every run produces a local, reproducible record. |
| **Meta-threads & handoffs** | Continuity across sessions; seal a run and continue it later. |
| **Local-first** | Core loop needs no account; hosted features are opt-in. |
| **OpenAI-compatible inference** | Call **Nemotron 3 Ultra** through Synth's drop-in `/v1/responses` endpoint with a Synth API key. |

## Hosted inference (optional)

Stack can call models through Synth's OpenAI-compatible endpoint. Point any OpenAI
client at Synth and use `nemotron-3-ultra`:

```bash
export SYNTH_API_KEY=sk_...    # from https://usesynth.ai/keys
curl https://api.usesynth.ai/api/v1/stack-aux/openai/v1/responses \
  -H "authorization: Bearer $SYNTH_API_KEY" \
  -H "x-stack-actor-role: aux" \
  -H "content-type: application/json" \
  -d '{"model":"nemotron-3-ultra","input":"hello"}'
```

Usage is metered per request and visible in your dashboard.

## Telemetry

Stack sends **anonymous** usage telemetry, **on by default**, to improve the product.
It never includes your code, prompts, file paths, commands, or secrets — only
allowlisted scalar product events tied to a random, resettable install id.

```bash
stack telemetry status     # see what's on and why
stack telemetry off        # disable (also: STACK_TELEMETRY=0 or DO_NOT_TRACK=1)
```

Details: [`docs/TELEMETRY.md`](./docs/TELEMETRY.md).

## Documentation

- [Overview](https://docs.usesynth.ai/stack/overview)
- [Changelog](https://docs.usesynth.ai/stack/changelog)
- [Telemetry & privacy](./docs/TELEMETRY.md)

## License

[MIT](./LICENSE). See [`NOTICE`](./NOTICE).
