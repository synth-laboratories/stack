# Banking77 Example

Use this shape for eval comparison artifacts where the audience needs to inspect model, prompt, harness, and split evidence in one browser page.

## Data Shape

```json
{
  "effort": "banking77-top-score",
  "sha256": "compiled-html-or-source-digest",
  "receipts": [
    "evals/stackeval/_runs/effort-bench/banking77-agent-eval/REVIEW-20260704T1724Z.md",
    "efforts/banking77-top-score/findings/results/<receipt>.json"
  ],
  "candidates": [
    {
      "id": "gpt-5.5",
      "harness": "parallel-eval",
      "model": "gpt-5.5",
      "prompt": "candidate prompt id or short label",
      "train_score": 0.9375,
      "train_split": "train/search rows 0-15",
      "heldout_score": null,
      "heldout_split": "heldout/test rows 0-15",
      "note": "15/16 train"
    },
    {
      "id": "baseline_seed",
      "harness": "parallel-eval",
      "model": "cheap_strict",
      "prompt": "baseline",
      "train_score": 0.75,
      "train_split": "train/search rows 0-15",
      "heldout_score": null,
      "heldout_split": "heldout/test rows 0-15",
      "note": "12/16 train"
    },
    {
      "id": "gepa_ab08773e2a9b",
      "harness": "parallel-eval",
      "model": "optimizer-selected",
      "prompt": "GEPA frontier",
      "train_score": null,
      "train_split": "train/search rows 0-15",
      "heldout_score": 0.75,
      "heldout_split": "heldout",
      "note": "heldout 0.750"
    }
  ]
}
```

## Page Pattern

- Header: one sentence naming the comparison and the exact evidence source.
- Metric row: one `StatTile` per candidate. Put the split in `detail`, for example `split train/search rows 0-15`.
- Chart: bar chart over the scored split. Do not mix train and heldout scores without labeling the split in each row.
- Table: columns for candidate id, harness, model, prompt, score, split, and note.
- Footer: `ReceiptFooter` with effort slug, review path, receipt paths, and digest.

## Commands

```bash
stack artifacts create banking77-parallel-eval --title "Banking77 Parallel Eval" --effort banking77-top-score --page banking77-page.tsx --data banking77-data.json
stack artifacts lint banking77-parallel-eval
```

Publishing from MCP requires explicit operator confirmation on the first publish:

```json
{
  "slug": "banking77-parallel-eval",
  "hosted_effort_id": "<hosted-effort-id>",
  "visibility": "org",
  "confirm_publish": true
}
```

Public sharing also requires `confirm_public: true`.
