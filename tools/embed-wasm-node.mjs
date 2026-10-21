/** Execute the browser's CPU-only WASM backend in Node, not a browser UI. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web/wasm';
import { Tensor, mean_pooling } from '@huggingface/transformers';
import { loadTokenizerNode, MODEL_INFO } from './embed-node.mjs';
import { prepareSemanticText } from '../src/semantic-input.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
let sessionPromise;
let queue = Promise.resolve();

async function loadSession() {
  const filename = path.join(root, '.cache', 'models', MODEL_INFO.id, MODEL_INFO.revision, 'onnx/model_quantized.onnx');
  const bytes = await fs.readFile(filename).catch((error) => {
    if (error.code === 'ENOENT') throw new Error('Pinned model is not cached. Run npm run test:model before the WASM check.');
    throw error;
  });
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== MODEL_INFO.modelSha256) throw new Error('Cached model checksum differs from the pinned model.');
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
}

export function embedTextsWasm(texts) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) return Promise.reject(new TypeError('Expected an array of strings.'));
  if (!texts.length) return Promise.resolve([]);
  const run = async () => {
    sessionPromise ??= loadSession();
    const [session, tokenizer] = await Promise.all([sessionPromise, loadTokenizerNode()]);
    const prepared = texts.map((text) => prepareSemanticText(text).text);
    const vectors = [];
    for (let index = 0; index < prepared.length; index += 8) {
      const inputs = tokenizer(prepared.slice(index, index + 8), { padding: true, truncation: true, max_length: MODEL_INFO.maxTokens });
      const feeds = Object.fromEntries(Object.entries(inputs).map(([name, tensor]) => [name, new ort.Tensor(tensor.type, tensor.data, tensor.dims)]));
      const outputs = await session.run(feeds);
      const state = outputs.last_hidden_state;
      if (!state) throw new Error('Pinned BERT model did not produce last_hidden_state.');
      const hidden = new Tensor('float32', state.data, state.dims);
      const pooled = mean_pooling(hidden, inputs.attention_mask).normalize(2, -1);
      vectors.push(...pooled.tolist());
      for (const tensor of Object.values(outputs)) tensor.dispose();
      for (const tensor of Object.values(feeds)) tensor.dispose();
    }
    return vectors;
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
}

export const WASM_RUNTIME_INFO = Object.freeze({
  runtime: 'ONNX Runtime Web CPU-only WASM executed in Node; not browser UI',
  version: ort.env.versions.web,
  wasmBytes: 14_264_838,
  threads: 1,
});

export async function releaseWasmModel() {
  await queue;
  if (sessionPromise) await (await sessionPromise).release();
  sessionPromise = undefined;
}

export { MODEL_INFO };
