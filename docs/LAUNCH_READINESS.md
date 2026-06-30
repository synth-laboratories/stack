# Stack launch readiness

Stack launch prep is tracked as a pipeline, but the public repo only contains
contributor-safe commands and product-local evidence. Private release decisions,
waivers, cross-repo policy, and operator readouts live in Jstack and `synth-dev`.

Run the public readiness inventory:

```bash
cd ~/Documents/GitHub/stack
make launch-readiness
```

Write a local evidence snapshot:

```bash
bun run launch:readiness -- --write-evidence
```

Line up the first nightly packet:

```bash
make launch-nightly1
```

Exercise the signed-out first-value path:

```bash
stack demo
```

The command reports the current launch stages without launching or publishing
anything.

## Pipeline stages

| Stage | Public repo meaning |
| --- | --- |
| `S0_SCOPE` | Scope, channel model, changelog, release, and quality docs exist. |
| `S1_STATIC` | Static and aggregate quality scripts are wired. |
| `S2_RUST_SERVER` | Rust/stackd contract and state-transition gates are represented. |
| `S3_TS_CLIENT` | TS/TUI remains a typed client and does not write stackd-owned state directly. |
| `S4_TUI_BOMBADIL` | Bombadil terminal invariants are wired and can grow beyond B0. |
| `S5_LOCAL_PRODUCT` | First local value works without Synth signup and emits a receipt. |
| `S6_DISTRIBUTION` | Advertised install/update channel is documented and eventually proven. |
| `S7_AUTH_GROWTH` | Optional auth and privacy-safe lifecycle measurement are planned outside this repo. |
| `S8_DOCS_CHANGELOG` | README, changelog, release, and quality docs agree. |
| `S9_SHIP_READOUT` | Launch readout is captured after dogfood or a real candidate. |

Related launch docs:

- [`NIGHTLY_1.md`](NIGHTLY_1.md)
- [`DISTRIBUTION.md`](DISTRIBUTION.md)
- [`TELEMETRY.md`](TELEMETRY.md)

Allowed statuses:

```text
pass
partial
fail
waived
not_applicable
not_started
```

Do not use `blocked` in ship records. If a gate cannot move, record the owner,
evidence, and next safe action in Jstack.

## Boundary rule

```text
Rust / stackd owns core state and transitions.
TypeScript / TUI owns operator experience.
stackd HTTP/MCP is the boundary.
Bombadil proves TUI behavior.
Contract smokes prove Rust <> TS shape.
```

The public repo should expose commands like `quality:dev`,
`quality:release`, and `launch:readiness`. It should not expose private launch
decision policy or internal evidence ledgers.
