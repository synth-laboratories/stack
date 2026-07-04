---
name: artifact-authoring
description: Create or update local Stack Artifact Site pages for research/eval results, dashboards, comparisons, receipts, or other visual proof that should be inspected in a browser before publishing. Use when an agent needs to turn evidence into an Artifact Site page with split-labeled scores, local data files, and Stack receipts.
---

# Artifact Authoring

Create a local artifact page first. Publish or share only after the operator explicitly asks.

## Workflow

1. Gather the evidence paths, run ids, candidate ids, split names, and effort slug.
2. Write data to JSON under a workspace file, then create a page that reads only local data.
3. Use `stack artifacts create <slug> --title <title> --page <page.tsx> --data <data.json>` or `--html <file>` for static HTML.
4. Return the local URL from Stack. Do not manually ask the user to move files.
5. If publishing is requested, confirm the page has a `ReceiptFooter`, every score names its split, and no view-time external requests.

## Page Contract

- Use data from `.stack/artifacts/data/<slug>/data.json` or data copied with `--data`.
- Do not fetch network resources at render time.
- Include a `ReceiptFooter` with effort, source receipt paths, run/candidate ids, and digest when available.
- Every score, win rate, or benchmark metric must name the split it came from.
- Prefer the bundled kit for charts, tables, stat tiles, split badges, and receipt footer.

## References

- Read `references/kit-api.md` when using the bundled Artifact Site kit.
- Read `references/page-template.tsx` when starting a new TSX artifact page.
