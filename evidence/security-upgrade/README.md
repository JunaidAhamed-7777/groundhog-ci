# Dependency security upgrade: Transformers.js 3.8.1 → 4.3.1

This folder preserves the security and regression evidence from the targeted upgrade, before the later long-log input-preparation change. It is not a new held-out study.

## Why this changed

The initial npm audit reported six vulnerable dependency entries, including two high-severity entries. The vulnerable paths involved native image dependencies (`sharp` and its bundled libraries) and the native ONNX installation/proxy logging chain. This is not evidence that a CI report exploited those paths.

The official [4.3.1 release](https://github.com/huggingface/transformers.js/releases/tag/4.3.1) retained the feature-extraction API. We upgraded only the pinned Transformers.js dependency with npm lifecycle scripts disabled, rather than running a forced audit fix. The resolved package tree includes `sharp` 0.35.5 and `onnxruntime-node` 1.30.0.

The after-audit reports zero known vulnerabilities. This is a point-in-time dependency audit, not proof that the application is vulnerability-free.

## API adaptations and model integrity

- v4 exposes `tokenizer.model_max_length` as a getter. The explicit 256-token limit now uses `tokenizer.config.model_max_length`.
- The high-level v4 `pipeline()` metadata-discovery preflight does not forward the requested model revision. `AutoTokenizer` also probes mutable-main metadata and failed a cache-only regression despite all pinned assets being present. We instead construct the official `BertTokenizer` from pinned JSON/config, load `AutoModel` from the pinned revision, and construct the official `FeatureExtractionPipeline`. This keeps pooling and normalization in the library while avoiding mutable-main preflight metadata. The reusable `loadTokenizerNode()` lets the evaluator measure exactly the production tokenizer.
- The model remains `Xenova/all-MiniLM-L6-v2`, q8, revision `751bff37182d3f1213fa05d7196b954e230abad9`.
- The downloaded ONNX SHA-256 remains `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`.
- The initial getter-assignment failure is preserved in `model-smoke-initial-migration-failure.txt`; the corrected inference result is in `model-smoke-after.txt`.

## Results at this stage

- 75 deterministic tests passed; zero failed.
- Production Vite build passed.
- Real Node CPU inference passed, including normalized 384-dimensional vectors and a 256-token truncation check.
- On the original 24-case synthetic regression, every accepted/abstained decision stayed unchanged under the original frozen thresholds. Semantic retrieval still accepted eight correct matches and one false match; lexical retrieval accepted nine correct and two false matches.
- The largest absolute semantic-score difference on that fixture was about 0.01744. Numerical parity was not assumed.
- The engine's normalization was separately hardened in the same workspace. `comparison.json` identifies this combined implementation change; it does not mislabel the entire regression as a dependency-only experiment.
- The larger-memory first run is preserved unchanged as `firstRun` in `../stress-evaluation.json`. Later verification runs are tracked separately in that same report rather than overwriting the first result.

## Remaining limits

The initial security-stage tests execute native ONNX Runtime on a cloud CPU. Later work also executes the official CPU-only WASM runtime in Node, with results under `../diagnostic-input/`; that is not browser UI verification. The default v4 WASM asset was approximately 26.9 MB before compression, exceeding the hosting limit. The final Vite configuration uses the supported CPU-only entry and matching bundled runtime, reducing that asset to 14,264,838 bytes. A 25 MiB per-file budget now runs on every production build and has boundary tests. Model weights remain a separate approximately 23 MB download. Browser cache, worker startup, UI, and offline behavior require their own observed verification.

See `comparison.json`, the before/after audits, and the retained evaluation records for exact metrics and hashes. Original authored synthetic data and threshold choices were not retuned to improve the upgrade results.
