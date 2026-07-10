# SMR Experiment Bundle

`smr_experiment_bundle.v1` is the backend/Factory-owned joined experiment view.
Stack consumes and renders it; Stack does not create a parallel evidence schema.

The owner bundle includes:

- experiment, Project, Factory, Effort, and run identity;
- hypothesis, intervention, comparison, protocol, status, and verdict;
- candidate id, model, exact prompt or prompt artifact, config, and config digest;
- container executions, image digests, task ids, scorer identity, and runtime state;
- evaluation rows with baseline, candidate value, delta, split, seed set, per-example artifact, cost, and tokens;
- trace and artifact indexes;
- economics and decisions;
- experiment-registration, Synth Wiki, git-server, budget, and source-identity provenance;
- owner-computed `smr_experiment_bundle_integrity.v1`.

Stack independently recomputes the integrity-required field list. A terminal bundle is rejected when the owner projection and the bundle contents disagree, or when `accepted_cycle` is false.

Inspect a downloaded bundle:

```text
stack experiment inspect artifacts/experiment_bundle.json
```

Inspect directly through the authenticated owner route:

```text
stack experiment inspect --project-id <project-id> --experiment-id <experiment-id>
```

Render locally:

```text
stack experiment render artifacts/experiment_bundle.json
stack experiment render --project-id <project-id> --experiment-id <experiment-id>
```

Refresh the same Artifact identity:

```text
stack experiment render artifacts/experiment_bundle.json --update
```

Rendering is local. Hosted publish and public promotion remain separate, operator-confirmed actions through `stack artifacts publish` and `stack artifacts share`.
