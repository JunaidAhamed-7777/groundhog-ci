import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { embedTextsNode, MODEL_INFO } from './embed-node.mjs';

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
// Both inputs overflow the explicit 256-token window and share its prefix.
// Extra trailing content must not silently expand that window.
const [bounded, long] = await embedTextsNode([
  'hello '.repeat(300),
  'hello '.repeat(300) + 'password invalid database authentication '.repeat(30),
]);
assert.ok(bounded.every((value, index) => Math.abs(value - long[index]) < 1e-6), 'Tokenizer must honor the explicit 256-token limit.');
console.log(JSON.stringify({
  passed: true, model: MODEL_INFO.id, revision: MODEL_INFO.revision,
  dtype: MODEL_INFO.dtype, dimensions: MODEL_INFO.dimensions,
  runtime: 'ONNX Runtime CPU (Node)',
  elapsedSeconds: Math.round((performance.now() - start) / 100) / 10,
  relatedCosine: related, unrelatedCosine: unrelated,
  samples: inputs.length,
  truncationVerified: true,
}, null, 2));
