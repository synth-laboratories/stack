# Banking77 Local GEPA

Run the local Banking77 GEPA harness with Stack trace and export evidence.

Default harness mode is CLI-managed:

```bash
./bin/stackeval run banking77-local-gepa --preset smoke
```

Real service-managed mode submits to the local optimizer service through
`POST /runs`. If the configured service URL is not reachable, service mode
starts the checked-out `optimizers` service with a packet-local SQLite DB and
stops only that owned service process when the harness exits:

```bash
STACK_OPTIMIZER_SERVICE_URL=http://127.0.0.1:8879 \
  ./bin/stackeval run banking77-local-gepa --preset smoke --harness-mode service
```

Use the checked-out `optimizers` service for the current Banking77 cookbook
contract until the installed `synth-optimizers` tool is upgraded to the same
GEPA service contract.

Latest green service-mode smoke receipt:

- Packet:
  `.stack/evidence/stackeval/banking77-local-gepa/20260630T070710Z`
- Run: `gepa_39e4e00a9c434112bab47acae5e42dff`
- Service: existing source-backed optimizer service on isolated port,
  JSON `POST /runs`
- Result: `status=succeeded`, `phase=completed`, heldout accuracy `75.0%`
- Acceptance: `SE-B77-1-HARNESS` through `SE-B77-6-LEVERAGE` pass
- Runtime trace: `stack-runtime/tick.json`, `factory.json`, `events.json`,
  `stackeval-events.json`, `status.json`, and `codex/trace.json`;
  `events=83`, `stackeval_events=2`
- Grade/review: grade task `3/5`, Stack leverage `4/5`; reviewer confirmed both
  scores; `SE-B77-6-LEVERAGE=pass` because those
  effective scores clear the smoke preset minima.

Smoke proves plumbing and evidence quality. It is not heldout-lift proof.

Acceptance gates:

- SE-B77-1-HARNESS: GEPA config renders and `harness.json` proves the active harness mode; service mode must include service receipt/run-summary fields.
- SE-B77-2-RUN: The harness completes or records a clear failed-run packet.
- SE-B77-3-SCORE: Harvest captures final score and candidate metadata.
- SE-B77-4-ARTIFACTS: Packet includes logs, rendered config, run metadata, and harvest output.
- SE-B77-5-TRACE: stackd thread export, `codex/trace.json`, runtime tick/factory/status evidence, broad runtime events, and packet-matching `lever.stackeval.gepa.*` runtime receipts are present when required.
- SE-B77-6-LEVERAGE: Grader/reviewer JSON parses, reviewer does not reject, and
  effective task/leverage scores meet the preset minima.
