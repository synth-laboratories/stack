---
name: artifact-authoring
description: Create or update local Stack Artifact Site pages for research/eval results, dashboards, comparisons, receipts, or other visual proof that should be inspected in a browser before publishing. Use when an agent needs to turn evidence into an Artifact Site page with split-labeled scores, local data files, and Stack receipts.
---

# Artifact Authoring

Create a local artifact page first. Publish or share only after the operator explicitly asks.

## Workflow

1. Gather the evidence paths, run ids, candidate ids, split names, and effort slug.
2. For a Factory experiment, consume the owner-assembled `smr_experiment_bundle.v1` from a file or the Project experiment bundle route. Use `stack experiment inspect` before rendering it. Read `references/experiment-bundle.md` for the contract.
3. Render Factory evidence with `stack experiment render <bundle.json>`. For other artifacts, write data to JSON and use `stack artifacts create <slug> --title <title> --page <page.tsx> --data <data.json>` or `--html <file>`.
4. Return the local URL from Stack. Do not manually ask the user to move files.
5. If publishing is requested, confirm the page has a `ReceiptFooter`, every score names its split, and no view-time external requests.

## Page Contract

- Use data from `.stack/artifacts/data/<slug>/data.json` or data copied with `--data`.
- Do not fetch network resources at render time.
- Include a `ReceiptFooter` with effort, source receipt paths, run/candidate ids, and digest when available.
- Every score, win rate, or benchmark metric must name the split it came from.
- Prefer the bundled kit for charts, tables, stat tiles, split badges, and receipt footer.

## Factory Experiment Contract

- Treat `smr_experiment_bundle.v1` as backend/Factory authority. Do not invent a second Stack schema or reconstruct missing evidence from workspace files.
- Preserve the exact candidate prompt or prompt artifact, model, config digest, container digest, run ids, trace index, economics, decision, provenance, and artifact index in the rendered page.
- A terminal bundle fails integrity checks when evaluation or required receipts are missing. Do not reconstruct terminal evidence from prose or an older artifact page.
- Rendering is local and safe by default. Hosted publish is an operator-confirmed action through `stack artifacts publish`.
- Update the same experiment artifact with `stack experiment render <bundle.json> --update`; do not mint a new identity for each refresh.

## References

- Read `references/kit-api.md` when using the bundled Artifact Site kit.
- Read `references/page-template.tsx` when starting a new TSX artifact page.
- Read `references/banking77-example.md` for a worked comparison page shape with split-labeled scores and receipts.
- Read `references/experiment-bundle.md` before rendering Factory experiment evidence.
