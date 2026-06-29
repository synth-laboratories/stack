# Banking77 Local GEPA

Run the local Banking77 GEPA harness with Stack trace and export evidence.

Acceptance gates:

- SE-B77-1-HARNESS: GEPA config renders and the harness starts from the pinned template.
- SE-B77-2-RUN: The harness completes or records a clear failed-run packet.
- SE-B77-3-SCORE: Harvest captures final score and candidate metadata.
- SE-B77-4-ARTIFACTS: Packet includes logs, rendered config, run metadata, and harvest output.
- SE-B77-5-TRACE: stackd trace/export evidence is present when required.
- SE-B77-6-LEVERAGE: Grader/reviewer can judge how Stack helped the operator.
