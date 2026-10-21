import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { embedTextsWasm, releaseWasmModel, MODEL_INFO, WASM_RUNTIME_INFO } from './embed-wasm-node.mjs';
import { embedTextsNode } from './embed-node.mjs';

const inputs = [
  'The build failed because the Node process exhausted its heap memory.',
  'JavaScript heap out of memory during the production build.',
  'The PostgreSQL server rejected the database password.',
  'The deployment finished successfully and all tests passed.',
];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const start = performance.now();
const vectors = await embedTextsWasm(inputs);
const wasmMs = performance.now() - start;
for (const vector of vectors) {
  assert.equal(vector.length, 384);
  assert.ok(vector.every(Number.isFinite));
  assert.ok(Math.abs(dot(vector, vector) - 1) < 1e-4);
}
assert.ok(dot(vectors[0], vectors[1]) > dot(vectors[0], vectors[2]) + 0.1);
const native = await embedTextsNode(inputs);
console.log(JSON.stringify({
  passed: true, model: MODEL_INFO, ...WASM_RUNTIME_INFO,
  samples: inputs.length, wasmInitializationAndInferenceMs: wasmMs,
  wasmRelatedCosine: dot(vectors[0], vectors[1]),
  wasmUnrelatedCosine: dot(vectors[0], vectors[2]),
  nativeRelatedCosine: dot(native[0], native[1]),
  nativeUnrelatedCosine: dot(native[0], native[2]),
  comparisonUsesIdenticalInputs: true,
  note: 'This executes actual WASM numerics in Node. It does not validate browser navigation, asset fetching, cache, worker creation, DOM, or offline readiness.',
}, null, 2));
await releaseWasmModel();
