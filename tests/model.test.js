import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { embedTexts, MODEL_INFO, releaseModel } from '../src/model.js';

const originalWorker = globalThis.Worker;
let instances;

class FakeWorker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    instances.push(this);
  }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(data) { this.onmessage({ data }); }
}

beforeEach(() => {
  instances = [];
  globalThis.Worker = FakeWorker;
});

afterEach(() => {
  releaseModel();
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
});

test('model provenance is pinned and inference is empty-input lazy', async () => {
  assert.equal(MODEL_INFO.dimensions, 384);
  assert.equal(MODEL_INFO.dtype, 'q8');
  assert.match(MODEL_INFO.revision, /^[a-f0-9]{40}$/);
  assert.match(MODEL_INFO.modelSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await embedTexts([]), []);
  assert.equal(instances.length, 0);
});

test('input validation bounds payloads before starting a worker', async () => {
  await assert.rejects(embedTexts('not an array'), TypeError);
  await assert.rejects(embedTexts(['valid', 12]), TypeError);
  await assert.rejects(embedTexts(Array(1001).fill('log')), /1,000/);
  await assert.rejects(embedTexts(['x'.repeat(20001)]), /20,000/);
  assert.equal(instances.length, 0);
});

test('one worker routes multiple responses by request id', async () => {
  const first = embedTexts(['first']);
  const second = embedTexts(['second']);
  assert.equal(instances.length, 1);
  const instance = instances[0];
  assert.equal(instance.options.type, 'module');
  const [a, b] = instance.messages;
  instance.emit({ id: b.id, type: 'result', embeddings: [[2]] });
  instance.emit({ id: a.id, type: 'result', embeddings: [[1]] });
  assert.deepEqual(await first, [[1]]);
  assert.deepEqual(await second, [[2]]);
});

test('presentation callback exceptions do not break inference', async () => {
  const progress = [];
  const result = embedTexts(['log'], (event) => { progress.push(event); throw new Error('render failed'); });
  const instance = instances[0];
  const { id } = instance.messages[0];
  instance.emit({ id, type: 'progress', event: { status: 'embedding', progress: 95 } });
  instance.emit({ id, type: 'result', embeddings: [[0.5]] });
  assert.deepEqual(await result, [[0.5]]);
  assert.equal(progress.at(-1).progress, 95);
});

test('worker failure rejects pending requests and next attempt starts cleanly', async () => {
  const first = embedTexts(['first']);
  const second = embedTexts(['second']);
  const firstRejected = assert.rejects(first, /Model unavailable/);
  const secondRejected = assert.rejects(second, /Model unavailable/);
  const instance = instances[0];
  instance.emit({ id: instance.messages[0].id, type: 'error', message: 'Model unavailable' });
  await Promise.all([firstRejected, secondRejected]);
  assert.equal(instance.terminated, true);
  const retry = embedTexts(['retry']);
  assert.equal(instances.length, 2);
  const replacement = instances[1];
  replacement.emit({ id: replacement.messages[0].id, type: 'result', embeddings: [[1]] });
  assert.deepEqual(await retry, [[1]]);
});

test('hung worker times out instead of leaving the UI pending', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = embedTexts(['log']);
  const rejected = assert.rejects(result, /timed out after three minutes/);
  t.mock.timers.tick(180_001);
  await rejected;
  assert.equal(instances[0].terminated, true);
});

test('releasing a model rejects any pending work', async () => {
  const result = embedTexts(['log']);
  const rejected = assert.rejects(result, /released/);
  releaseModel();
  await rejected;
  assert.equal(instances[0].terminated, true);
});
