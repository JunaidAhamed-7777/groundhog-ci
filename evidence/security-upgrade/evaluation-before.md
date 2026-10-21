# Groundhog retrieval evaluation

This is a regression verification on the previously inspected held-out split, using the original frozen policies without retuning. The first held-out run is retained in JSON.

Generated: 2026-10-21T04:41:45.499Z. Configuration frozen: 2026-10-21T04:37:30.452Z.

**Synthetic evidence only.** Three authored historical memories; 13 calibration cases and 24 held-out language variants. No production logs, real developer time savings, or verified root causes are claimed.

## Method

The exact baseline compares normalized symptom strings. The lexical baseline uses token-set Jaccard similarity. The semantic system uses the real pinned q8 all-MiniLM-L6-v2 model. All methods use only symptom text, never the stored fix or evidence.

Use calibration only. Require zero accepted wrong or novel matches; maximize correctly accepted known cases; ties prefer higher minimum score, then higher margin. No held-out labels or scores participate.

Frozen semantic threshold: 0.68; margin: 0.2. Frozen lexical threshold: 0.2; margin: 0.05. Original semantic defaults (0.78, margin 0.08) are reported separately, not silently replaced.

## Held-out results

### normalizedExact

- Accepted: 0/24; correct accepted: 0; wrong accepted: 0.
- Accepted precision: not defined (no accepted candidates); abstention: 100.0%.
- Known-case correct acceptance: 0/12 (0.0%).
- Novel false matches: 0/12 (0.0%).
- Known top-1 / top-3 before abstention: 0.0% / 0.0%.

### lexicalJaccardCalibrated

- Accepted: 11/24; correct accepted: 9; wrong accepted: 2.
- Accepted precision: 81.8%; abstention: 54.2%.
- Known-case correct acceptance: 9/12 (75.0%).
- Novel false matches: 2/12 (16.7%).
- Known top-1 / top-3 before abstention: 100.0% / 100.0%.

### semanticOriginalDefaults

- Accepted: 2/24; correct accepted: 2; wrong accepted: 0.
- Accepted precision: 100.0%; abstention: 91.7%.
- Known-case correct acceptance: 2/12 (16.7%).
- Novel false matches: 0/12 (0.0%).
- Known top-1 / top-3 before abstention: 100.0% / 100.0%.

### semanticCalibrated

- Accepted: 9/24; correct accepted: 8; wrong accepted: 1.
- Accepted precision: 88.9%; abstention: 62.5%.
- Known-case correct acceptance: 8/12 (66.7%).
- Novel false matches: 1/12 (8.3%).
- Known top-1 / top-3 before abstention: 100.0% / 100.0%.

## Measured runtime

Runtime: Node.js v24.19.0, native ONNX Runtime CPU, AMD EPYC 9V74 80-Core Processor. Not browser WASM.

Warm single-query embedding plus retrieval, 24 sequential queries: median 3.58 ms; p95 11.87 ms. Model initialization plus three corpus embeddings: 169.62 ms with cache state not asserted.

## Observed false accepts

- lexicalJaccardCalibrated: test-auth-2 accepted incident-db-refused; expected abstention.
- lexicalJaccardCalibrated: test-http-503 accepted incident-timeout; expected abstention.
- semanticCalibrated: test-http-503 accepted incident-timeout; expected abstention.

## Adversarial security regression checks

Command: node --test --test-reporter=tap tests/adversarial.test.js. Result: 14/14 passed; 0 failed; exit 0.

XML malformed/DTD/entity/byte-depth-field-count rejection; diagnostic-value preservation; memory import validation; inert text preservation; invalid embeddings; ambiguity abstention; no command execution.

These deterministic Node tests do not execute the browser DOM. Imported markup remains literal data, so UI output escaping must also be verified in the browser. Common-secret redaction is best effort, not a security guarantee.

Two normalization collisions were found during review and fixed with explicit regression tests: duration assertion values were being erased, and Unicode compatibility folding merged superscript ² with ordinary 2.

Static UI review found escaping at inspected symptom/title/fix/evidence display sites. This source inspection is not a substitute for dynamic browser injection testing. Imported notes must not be represented as verified by the current user merely because JSON validation succeeded.

## Limits and interpretation

- Authored synthetic cases and a three-memory corpus are not evidence of production accuracy or saved developer time.
- Calibration and held-out cases share the same three authored failure families; this is a language-variant stress test, not an independently sampled distribution.
- The calibration set is tiny; zero observed false matches does not establish a low real-world false-match rate.
- Cosine similarity is not a probability, confidence, or root-cause proof. Every accepted result is only a human-review candidate.
- Top-3 retrieval is nearly trivial because the corpus contains only three incidents.
- Tokenization truncates to 256 tokens; long reports can lose causal information. This benchmark uses short individual symptoms.
- Node CPU timings do not establish browser performance, offline readiness, or cross-device performance.
- Retrieval queries are individual symptom strings. This is not an end-to-end evaluation of JUnit type/message/detail assembly or a full CI triage workflow.

The three exact-replay controls are reported separately in JSON and excluded from held-out accuracy metrics. Their purpose is to verify that the exact baseline can retrieve unchanged memories, not to inflate results.

Detailed ranks, acceptance decisions, calibration scores, file hashes, model revision/hash and timings are in evaluation.json.

Reproduce from the project root:

    NODE_USE_ENV_PROXY=1 node tools/evaluate.mjs

Or preserve the two-phase boundary explicitly:

    NODE_USE_ENV_PROXY=1 node tools/evaluate.mjs --calibrate
    NODE_USE_ENV_PROXY=1 node tools/evaluate.mjs --heldout

After implementation-only changes, reuse the frozen policies without retuning:

    NODE_USE_ENV_PROXY=1 node tools/evaluate.mjs --verify
