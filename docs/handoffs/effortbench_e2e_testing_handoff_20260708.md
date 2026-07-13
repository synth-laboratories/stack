# Handoff: EffortBench E2E effort runs

**Date:** 2026-07-08

**Goal for the next operator:** turn the ad hoc three-lane policy effort referee into a repeatable EffortBench end-to-end testing pattern. The target behavior is: isolated lanes, separate Stack roots and gardener instances, local services only, candidate creation from the supplied substrate, baseline, TTC/test-time-compute or rollout search where applicable, final eval, and a submit script that can run on heldout.

**Operator stance:** poll and steer. Do not code by default. Fix referee, Stack, Docker, GEPA, or workspace seeding only when the worker is blocked on infrastructure or an actual harness defect.

**Hard constraints from this run:**

- Do not use OpenRouter or hosted optimizers.
- Use local Stack/GEPA services only. If a report says `local_gepa_used: false`, do not claim GEPA optimization happened, even if the local GEPA service was running.
- Keep each comparison lane isolated: separate `STACK_ROOT`, `STACK_WORKING_DIR`, stackd port, GEPA port, worker thread, and workspace.
- Use `gemini-3.1-flash-lite` as a benchmark/policy model through the local harness, not as the Codex agent model. This Codex account rejected it as an agent model.
- For valid real-Gemini proofs, load credentials from `/Users/joshpurtell/Documents/GitHub/synth-ai/.env` without printing secrets.

---

## Main files

| Purpose | Path |
| --- | --- |
| Referee script | `/Users/joshpurtell/Documents/GitHub/efforts/craftax-harvey-policy-gardener-20260708/tools/policy_effort_referee.py` |
| Shared effort notes | `/Users/joshpurtell/Documents/GitHub/efforts/craftax-harvey-policy-gardener-20260708/notes/attempt_log.md` |
| This handoff | `/Users/joshpurtell/Documents/GitHub/stack/docs/handoffs/effortbench_e2e_testing_handoff_20260708.md` |

The referee currently supports these targets:

- `craftax-code-policy`
- `craftax-gemini-policy`
- `harvey-gemini-policy`

Useful commands:

```bash
/Users/joshpurtell/Documents/GitHub/efforts/craftax-harvey-policy-gardener-20260708/tools/policy_effort_referee.py --target craftax-code-policy poll
/Users/joshpurtell/Documents/GitHub/efforts/craftax-harvey-policy-gardener-20260708/tools/policy_effort_referee.py --target craftax-code-policy collect
/Users/joshpurtell/Documents/GitHub/efforts/craftax-harvey-policy-gardener-20260708/tools/policy_effort_referee.py --target craftax-code-policy stop
```

Swap `craftax-code-policy` for the other targets as needed. The script also has prepare/start/create-workers/start-runs style subcommands; inspect `--help` before launching a fresh run.

---

## Service matrix from the completed run

All services from this run were stopped at handoff. A final process check found no remaining `codex exec`, `stackd serve`, or `synth-optimizers gepa service` for these effort roots/ports.

| Target | Lane ports |
| --- | --- |
| Craftax Rust code policy | stackd `8990/8992/8994`, GEPA `9010/9012/9014` |
| Craftax Gemini policy | stackd `9020/9022/9024`, GEPA `9040/9042/9044` |
| Harvey Gemini policy | stackd `9050/9052/9054`, GEPA `9070/9072/9074` |

The valid parallel comparison pattern is one independent Stack/gardener lane per candidate effort. Earlier concern was correct: shared Stack/gardener instances would make effort-run timing and worker-count comparisons invalid.

---

## Results summary

### 1. Craftax Rust code policy

Run root:

`/Users/joshpurtell/Documents/GitHub/efforts/craftax-code-policy-independent-20260708`

Aggregate:

`/Users/joshpurtell/Documents/GitHub/efforts/craftax-code-policy-independent-20260708/referee/aggregate_summary.json`

Outcome: all 3 lanes successful.

| Lane | Baseline | Final | Lift | Wall time | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 0.0371 | 0.0650 | +0.0279 | 160s | Existing `hybrid_growth` candidate beat pinned Rust baseline. |
| B | 0.0303 | 0.0667 | +0.0364 | 453s | Candidate-root and loader-path mismatches corrected. |
| C | 0.0303 | 0.0667 | +0.0364 | 338s | Best lane by speed among tied top scores. |

What worked:

- The workers produced runnable candidates and baseline/final evidence.
- Rust sweeps used `--parallel 20`.
- Submit/verifier artifacts exist for lanes A/B, and lane C has verifier results plus a command-string submit recipe in the final report.

What did not fully satisfy the desired future contract:

- Workers reused existing task-local candidate families rather than building the full container/code substrate from raw data.
- `local_gepa_used` was false in all lane reports.

Primary artifacts:

- `/Users/joshpurtell/Documents/GitHub/efforts/craftax-code-policy-independent-20260708/lane-a/workspace/lane_outputs/submit_eval.sh`
- `/Users/joshpurtell/Documents/GitHub/efforts/craftax-code-policy-independent-20260708/lane-a/workspace/lane_outputs/verifier_result.json`
- `/Users/joshpurtell/Documents/GitHub/efforts/craftax-code-policy-independent-20260708/lane-b/workspace/lane_outputs/submit_eval.sh`
- `/Users/joshpurtell/Documents/GitHub/efforts/craftax-code-policy-independent-20260708/lane-b/workspace/lane_outputs/verifier_result.json`
- `/Users/joshpurtell/Documents/GitHub/efforts/craftax-code-policy-independent-20260708/lane-c/workspace/lane_outputs/verifier_result.json`

### 2. Craftax Gemini 3.1 Flash Lite policy

Run root:

`/Users/joshpurtell/Documents/GitHub/efforts/craftax-gemini-policy-independent-20260708`

Aggregate:

`/Users/joshpurtell/Documents/GitHub/efforts/craftax-gemini-policy-independent-20260708/referee/aggregate_summary.json`

Outcome: one primary valid success, one mock success, one lane without a final report at collection time.

| Lane | Baseline | Final | Lift | Wall time | Validity |
| --- | ---: | ---: | ---: | ---: | --- |
| A | n/a | n/a | n/a | n/a | No final report at collection. |
| B | 0.0333 | 0.0606 | +0.0273 | 938s | Mock mode only. Do not count as real uplift. |
| C | 0.0333 | 0.0455 | +0.0122 | 356s | Primary real Gemini success. |

What worked:

- Lane C ran real `gemini-3.1-flash-lite` policy calls through the local benchmark path after loading `/Users/joshpurtell/Documents/GitHub/synth-ai/.env`.
- Lane C emitted a submit script and verifier result:
  - `/Users/joshpurtell/Documents/GitHub/efforts/craftax-gemini-policy-independent-20260708/lane-c/workspace/lane_outputs/submit_eval.sh`
  - `/Users/joshpurtell/Documents/GitHub/efforts/craftax-gemini-policy-independent-20260708/lane-c/workspace/lane_outputs/verifier_result.json`
- Lane B was useful as a harness/proxy smoke, but it set `GAMEBENCH_CYBERNETICS_MOCK=1`.

What blocked or weakened the evidence:

- Workers did not consistently discover/export the Gemini credential.
- Lane B reported success despite mock mode, which can mislead aggregate comparisons unless the operator filters for real model use.
- `local_gepa_used` was false.
- Rollout parallelism was much weaker than the Rust code-policy run; lane C was serial proxy evals.

### 3. Harvey Gemini 3.1 Flash Lite policy

Run root:

`/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708`

Aggregate:

`/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708/referee/aggregate_summary.json`

Outcome: end-to-end harness proof exists, but no winning candidate.

| Lane | Baseline | Final | Lift | Wall time | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 0.0 | 0.0 | 0.0 | 1240s | Ran local Harvey Gemini harness end to end; final underperformed on criteria count. |
| B | 0.8571428571 | 0.8571428571 | 0.0 | 413s | Fixture/static smoke evidence only; Codex-agent model path blocked. |
| C | n/a | n/a | n/a | 1249s | Found no shipped Harvey Gemini policy benchmark entrypoint. |

Lane A is the important one:

- Harness:
  - `/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708/lane-a/workspace/lane_outputs/harvey_lab_gemini_policy_eval.py`
- Final report:
  - `/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708/lane-a/workspace/lane_outputs/final_report.json`
- Verifier:
  - `/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708/lane-a/workspace/lane_outputs/verifier_result.json`
- Results:
  - `/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708/lane-a/workspace/harvey-labs/results/lane-a-harvey-gemini-baseline/`
  - `/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708/lane-a/workspace/harvey-labs/results/lane-a-harvey-gemini-final/`

Lane A command used for the repaired run:

```bash
set -a && source /Users/joshpurtell/Documents/GitHub/synth-ai/.env && set +a && uv run --project harvey-labs python lane_outputs/harvey_lab_gemini_policy_eval.py --harvey-labs-root harvey-labs --model gemini-3.1-flash-lite --judge-model gemini-3.1-flash-lite --baseline-run-id lane-a-harvey-gemini-baseline --final-run-id lane-a-harvey-gemini-final
```

What worked:

- The operator found and ran a local Harvey Labs benchmark substrate.
- The run generated baseline/final `.docx` and `.xlsx` deliverables.
- The scorer ran and produced criteria-level counts.

What blocked success:

- Baseline passed 12/50 criteria; final passed 10/50. Benchmark score stayed 0.0 for both due the all-pass threshold.
- The prompt/profile got worse, not better.
- Minimal Harvey seeding initially missed helper files required by the report path. Lane-local files were added:
  - `/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708/lane-a/workspace/harvey-labs/utils/__init__.py`
  - `/Users/joshpurtell/Documents/GitHub/efforts/harvey-gemini-policy-independent-20260708/lane-a/workspace/harvey-labs/utils/stdio.py`
- Lane B showed the StackEval wrapper is agent-centric and hard-wired through `codex exec -m {model}`. This environment rejects `gemini-3.1-flash-lite` as a Codex agent model:
  - `The 'gemini-3.1-flash-lite' model is not supported when using Codex with a ChatGPT account.`
- Lane C concluded there was no shipped Harvey-specific Gemini policy benchmark entrypoint. Lane A superseded that with a custom local harness, but the candidate was not successful.

Recommended Harvey next step:

- Improve the harness/prompt around deterministic extraction of planted facts before synthesis.
- Improve tracker schema and issue coverage. The final tracker had only 8 rows and missed many required planted issues.
- Separate policy-model use from agent-model use. Use Gemini through `google.genai` or the local policy harness, not through `codex exec -m gemini-3.1-flash-lite`.

---

## What to build into EffortBench

1. **First-class isolated-lane runner**

   The referee pattern is correct: one run root, three or more lanes, each with its own Stack root, stackd port, GEPA port, workspace, and worker. Promote this into the official EffortBench runner rather than relying on a one-off script.

2. **Explicit target contract**

   Every target should declare:

   - raw substrate/source inputs
   - container or harness build command
   - baseline command
   - TTC/test-time-compute plan
   - candidate eval command
   - final heldout command
   - submit script contract
   - artifact manifest
   - whether local GEPA is required or merely available

3. **Real vs mock validity bit**

   Add an aggregate field such as `model_calls_real: true/false` and fail success if a run used mock mode unless the target explicitly asks for a mock smoke.

4. **Local GEPA proof**

   The run launched local GEPA services, but final reports said `local_gepa_used: false`. Future runs need either:

   - a real local GEPA optimizer invocation with receipts, or
   - wording that says the run was local Stack/gardener plus local benchmark, not GEPA-optimized.

5. **Stop-after-report behavior**

   Workers can continue after writing final reports and overwrite artifacts. The operator should collect and stop immediately after a lane has enough results. EffortBench should snapshot final artifacts atomically and pause the lane.

6. **JSON artifact hardening**

   Collection currently assumes valid JSON. Harvey lane C produced malformed/duplicate final-report JSON during the run, requiring manual repair/removal. The collector should validate, preserve the bad file under a timestamped name, and continue collecting other lanes.

7. **Workspace seed manifests**

   The minimal seeding idea is right, but it needs declared include/exclude manifests per target.

   Specific misses from this run:

   - A bad rsync exclude copied an 8.2G Craftax Rust target cache before interruption.
   - Harvey seeding omitted `utils/stdio.py`, which the local report path needed.

8. **Worker-count and time accounting**

   For comparisons, record:

   - number of worker agents
   - lane count
   - rollout parallelism
   - start/end timestamps per lane
   - end-to-end target wall time
   - model call counts and token counts
   - whether the worker was still running when collected

9. **Submit script verification**

   Require an actual file path for `submit_script`, not just a command string. Lane C Craftax code-policy reported a command string, which is less useful for heldout handoff.

10. **Credential discovery**

   Workers need a standard local credential lookup that can source `/Users/joshpurtell/Documents/GitHub/synth-ai/.env` without printing keys. This should be part of the target runner contract.

---

## Papercuts already logged

Rsync exclude copied the Craftax Rust target cache:

```text
jsk papercut "Policy effort referee rsync exclude pattern copied Craftax Rust target cache into lane workspace, making a single lane 8.2G before interrupt." --repo efforts --file efforts/craftax-harvey-policy-gardener-20260708/tools/policy_effort_referee.py:227 --sev MED --time-lost 12m --context "Launching isolated Craftax code-policy gardener lanes"
```

stackd monitor scheduler log spam:

```text
jsk papercut "stackd monitor scheduler spams 'monitor wake policy failed; using legacy trigger policy: No such file or directory' every ~0.5s in isolated effort lanes while workers run" --repo stack --file stack/crates/stackd/src/monitor_scheduler.rs:211 --sev MED --time-lost 10m --context "Running three local Stack lanes for Harvey Gemini policy effort; stackd logs became noisy and harder to inspect"
```

Related issue to check before future runs:

- Workers can keep running after final-report creation and overwrite artifacts. Search Jstack for `threads.rs` and final-report overwrite if this recurs.

---

## First action for the next operator

1. Read:

   - `/Users/joshpurtell/Documents/GitHub/efforts/craftax-harvey-policy-gardener-20260708/notes/attempt_log.md`
   - the three `referee/aggregate_summary.json` files listed above

2. Decide whether the next push is:

   - **productize EffortBench runner:** turn the referee pattern into a reusable runner with target contracts and validity bits, or
   - **run another benchmark effort:** start new isolated lanes with a target that already has baseline/final/submit contracts.

3. If running another effort, start with the valid pattern:

   - one target root
   - three or more isolated lanes
   - separate Stack/GEPA ports
   - explicit policy model vs agent model
   - real heldout baseline seeds and separate worker calibration seeds
   - no mock mode unless the run is explicitly a smoke
   - collect and stop as soon as a lane writes a valid final report

4. For Harvey specifically, do not spend another full run on agent-model plumbing. Build or repair the local policy harness first, then run the three-lane effort.

