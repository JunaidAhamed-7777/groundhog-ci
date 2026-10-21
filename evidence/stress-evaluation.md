# Groundhog larger-memory stress evaluation

**Authored synthetic stress data, not production evidence. No real developer time savings are measured.**

Protocol frozen: 2026-10-21T05:03:44.231Z. Status: evaluated.

## Predeclared protocol

New, hand-authored synthetic stress corpus. Written before model scoring; independent from the existing three-memory calibration/held-out fixture, but not externally sampled or independently annotated.

- 20 distinct historical memories, 40 known variants, 20 deliberately close novel causes, and 5 separate long-log/negation probes.
- Every query becomes two generated JUnit failures. Parse, normalize and group them using the actual engine before embedding each group signature.
- Memory embeddings contain only normalized symptoms. Labels, IDs, titles, fixes and evidence are never passed to the model.
- Fixed semantic threshold 0.68 and margin 0.20; fixed lexical Jaccard threshold 0.20 and margin 0.05. Both originate from the earlier three-memory calibration, not this dataset.
- Report known top-1/top-3 ranking over 20 memories before abstention, accepted precision and known coverage, novel false acceptance, exact grouping, truncation and runtime.
- Novel examples explicitly identify a different underlying cause, even when a diagnostic code overlaps. Labels are authored hypotheses rather than outcomes of real failed tests.
- Report stress probes separately from the 60 ordinary cases. Exact-replay controls are separate and cannot inflate variant accuracy.
- No threshold search, relabeling, score-based case removal or application changes. Retain first-run results; later runs are regression verification, not fresh held-out evidence.
- A cache-only tokenizer configuration error was corrected before any model score. The original freeze hashes, error and amendment are retained in JSON; data and thresholds did not change.

Reproduce with the existing cached pinned model:

    node tools/stress-evaluate.mjs --freeze
    node tools/stress-evaluate.mjs --run

For an already completed run:

    node tools/stress-evaluate.mjs --verify
    node tools/stress-evaluate.mjs --verify-wasm

The evaluator refuses network downloads. Populate the normal pinned model cache with the project model setup if it is not already present. It uses the unmodified embed-node adapter for all embedding calls.

## First run: 60 ordinary cases

Scored: 2026-10-21T05:04:15.911Z. Policies were not tuned on these results.

### exact

- Accepted 0/60: 0 correct, 0 wrong. Accepted precision undefined (no accepted results).
- Known correct acceptance 0/40 (0.0%); novel false accepts 0/20 (0.0%).
- Known top-1 0/40 (0.0%); top-3 0/40 (0.0%), before abstention over 20 candidates.

### lexical

- Accepted 30/60: 21 correct, 9 wrong. Accepted precision 70.0%.
- Known correct acceptance 21/40 (52.5%); novel false accepts 9/20 (45.0%).
- Known top-1 36/40 (90.0%); top-3 37/40 (92.5%), before abstention over 20 candidates.

### semantic

- Accepted 25/60: 16 correct, 9 wrong. Accepted precision 64.0%.
- Known correct acceptance 16/40 (40.0%); novel false accepts 9/20 (45.0%).
- Known top-1 39/40 (97.5%); top-3 40/40 (100.0%), before abstention over 20 candidates.

## Five stress probes

- stress-01, long-cause-at-tail: 1098 tokens → 256; expected memory-08; semantic abstained (top memory-07); lexical memory-08 (top memory-08).
- stress-02, long-cause-at-tail: 1101 tokens → 256; expected memory-03; semantic abstained (top memory-07); lexical abstained (top memory-03).
- stress-03, long-cause-at-front: 1105 tokens → 256; expected memory-08; semantic abstained (top memory-08); lexical memory-08 (top memory-08).
- stress-04, negated-decoy-known: 72 tokens → 72; expected memory-19; semantic abstained (top memory-19); lexical memory-19 (top memory-19).
- stress-05, negated-decoy-novel: 76 tokens → 76; expected abstention; semantic abstained (top memory-08); lexical abstained (top memory-08).

The two tail-cause cases have different true labels and different normalized logs, but identical retained token sequences. Their embedding cosine is 1. The model cannot distinguish diagnoses it never receives.

## Exact grouping and runtime

- All 130 generated failure records formed the expected 65 groups, with both duplicate occurrences retained and no cross-case merges. Successful/skipped tests were omitted.
- All 20 separate exact-replay controls retrieved their corresponding stored signature. Eight diagnostic-value controls remained distinct.
- First-run parse 7.86 ms; grouping 5.07 ms.
- Model initialization plus 20 corpus embeddings 195.78 ms; warm single-query embedding median 8.49 ms, p95 24.65 ms.
- Warm retrieval-only median 0.41 ms, p95 0.56 ms.

Sequential batch-of-one inference; model already initialized. CPU native runtime with existing cache, uncontrolled shared-host load. No browser, first download, network, end-to-end human workflow or time-saved measurement.

## Observed false accepts

- lexical: novel-01 accepted memory-01, expected abstention; score 0.2500, margin 0.1071.
- lexical: novel-04 accepted memory-04, expected abstention; score 0.2432, margin 0.1502.
- lexical: novel-06 accepted memory-06, expected abstention; score 0.2500, margin 0.1750.
- lexical: novel-07 accepted memory-07, expected abstention; score 0.2250, margin 0.1762.
- lexical: novel-08 accepted memory-08, expected abstention; score 0.3158, margin 0.2491.
- lexical: novel-13 accepted memory-13, expected abstention; score 0.2250, margin 0.1274.
- lexical: novel-14 accepted memory-14, expected abstention; score 0.2222, margin 0.0794.
- lexical: novel-15 accepted memory-15, expected abstention; score 0.2368, margin 0.1702.
- lexical: novel-18 accepted memory-18, expected abstention; score 0.2727, margin 0.1894.
- semantic: novel-01 accepted memory-01, expected abstention; score 0.7455, margin 0.2824.
- semantic: novel-04 accepted memory-04, expected abstention; score 0.7863, margin 0.3854.
- semantic: novel-05 accepted memory-05, expected abstention; score 0.7857, margin 0.3306.
- semantic: novel-06 accepted memory-06, expected abstention; score 0.7696, margin 0.2950.
- semantic: novel-08 accepted memory-08, expected abstention; score 0.7682, margin 0.4157.
- semantic: novel-10 accepted memory-10, expected abstention; score 0.7744, margin 0.2691.
- semantic: novel-11 accepted memory-11, expected abstention; score 0.8071, margin 0.2635.
- semantic: novel-15 accepted memory-15, expected abstention; score 0.7199, margin 0.4020.
- semantic: novel-18 accepted memory-18, expected abstention; score 0.6987, margin 0.3926.

## Interpretation and independent checks

Acceptance metrics refer to the top-ranked accepted historical incident, not a probability that its fix will work. Labels describe authored cause identity. Diagnostic texts were not executed, and a suggested fix could coincidentally help a different cause.

- Independent Python recomputation matched all accepted/correct/wrong counts.
- The cached q8 model file SHA-256 matched the pinned provenance hash.
- Existing parser, adversarial and CLI regressions: 63/63 passed before the runtime upgrade.

## Product-safe next steps, not applied by this benchmark

- Keep matches explicitly labeled historical candidates requiring review. Do not translate cosine scores into probabilities or promise root-cause detection.
- Expose when a normalized log exceeds the model context and avoid implying the entire report was considered. Any head/tail or error-extraction strategy needs a new predeclared dataset, not tuning against these probes.
- Collect consented, independently labeled realistic examples with a larger notebook before claiming a semantic advantage. Check precision/coverage and distinct-cause negatives together.
- Preserve a lexical/exact reference path, full original failure evidence and easy dismissal of inapplicable notes. Do not automatically apply a retrieved fix.

## Limits

- All cases and labels were authored by one evaluator, not externally sampled, independently annotated or confirmed by execution.
- The 20-memory notebook and 65 probes are still small. Precision and false-accept rates describe this exact construction only.
- Shared error codes can mask distinct causes. Neither exact symptoms nor cosine similarity establishes that a historical fix is applicable.
- The fixed policies were originally calibrated against just three memories. No claim is made that they are calibrated for larger or different notebooks.
- The lexical baseline uses full normalized text; semantic inference truncates at 256 tokens. This reflects the actual pipelines, not matched input budgets.
- Top-3 ranking is now over 20 candidates and is measured before abstention, not the number of suggestions actually surfaced.
- Generated JUnit exercises parser/group/model integration but is not the UI import path, browser WASM, a production report, or a real CI remediation study.
- Runtime numbers are shared-host Node CPU measurements and must not be presented as browser latency or developer time saved.

Regression verification runs retained in JSON: 5. First-run metrics remain unchanged above.

Detailed normalized model inputs, per-case ranks/decisions, tokenizer counts, source hashes, timing samples and later verification results are retained in stress-evaluation.json.

## Latest implementation regression on the already inspected cases

Run: 2026-10-21T05:18:55.983Z; ONNX Runtime Web CPU-only WASM executed in Node; not browser UI; Transformers.js 4.3.1; input preparation diagnostic-lines-v1. This is not a fresh held-out test and did not retune thresholds or labels.

- exact, ordinary cases: top-1 0/40; top-3 0/40; 0 correct and 0 wrong accepted, precision undefined (no accepted results), known correct coverage 0.0%.
- lexical, ordinary cases: top-1 36/40; top-3 37/40; 21 correct and 9 wrong accepted, precision 70.0%, known correct coverage 52.5%.
- semantic, ordinary cases: top-1 39/40; top-3 40/40; 16 correct and 9 wrong accepted, precision 64.0%, known correct coverage 40.0%.

- stress-01: 1098 original tokens → 66 prepared → 66 retained; semantic abstained, top rank memory-08; expected memory-08.
- stress-02: 1101 original tokens → 69 prepared → 69 retained; semantic memory-03, top rank memory-03; expected memory-03.
- stress-03: 1105 original tokens → 73 prepared → 73 retained; semantic abstained, top rank memory-08; expected memory-08.
- stress-04: 72 original tokens → 72 prepared → 72 retained; semantic abstained, top rank memory-19; expected memory-19.
- stress-05: 76 original tokens → 76 prepared → 76 retained; semantic abstained, top rank memory-08; expected abstention.

Tail-probe retained token sequences identical: false; embedding cosine 0.6070149314010534.

Bounded diagnostic-line selection remains lossy: it can omit relevant context and the tokenizer still has a 256-token cap. Passing these already-inspected probes does not establish long-log accuracy on unseen reports.
