import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { embedTextsNode, loadTokenizerNode, MODEL_INFO } from './embed-node.mjs';

const inputs = [
  'The build failed because the Node process exhausted its heap memory.',
  'JavaScript heap out of memory during the production build.',
  'The PostgreSQL server rejected the database password.',
  'The deployment finished successfully and all tests passed.',
];
const start = performance.now();
let announced = false;
const vectors = await embedTextsNode(inputs, (event) => {
  if (!announced && event.file?.endsWith('.onnx')) {
    announced = true;
    console.error('Loading pinned MiniLM q8 model for real CPU inference…');
  }
});
const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
assert.equal(vectors.length, inputs.length);
for (const vector of vectors) {
  assert.equal(vector.length, MODEL_INFO.dimensions);
  assert.ok(vector.every(Number.isFinite));
  assert.ok(Math.abs(cosine(vector, vector) - 1) < 1e-4);
}
const related = cosine(vectors[0], vectors[1]);
const unrelated = cosine(vectors[0], vectors[2]);
assert.ok(related > unrelated + 0.1, 'Real model should rank paraphrased memory failure above unrelated database error.');
// Test the exact production tokenizer independently of diagnostic excerpt
// selection, which intentionally changes overflowing log inputs before this step.
const tokenizer = await loadTokenizerNode();
const bounded = tokenizer('hello '.repeat(300), { truncation: true, padding: true });
assert.equal(bounded.input_ids.dims[1], MODEL_INFO.maxTokens, 'Tokenizer must honor the explicit 256-token limit.');
console.log(JSON.stringify({
  passed: true, model: MODEL_INFO.id, revision: MODEL_INFO.revision,
  dtype: MODEL_INFO.dtype, dimensions: MODEL_INFO.dimensions,
  libraryVersion: MODEL_INFO.libraryVersion,
  inputPreparationVersion: MODEL_INFO.inputPreparationVersion,
  runtime: 'ONNX Runtime CPU (Node)',
  elapsedSeconds: Math.round((performance.now() - start) / 100) / 10,
  relatedCosine: related, unrelatedCosine: unrelated,
  samples: inputs.length,
  truncationVerified: true,
}, null, 2));
