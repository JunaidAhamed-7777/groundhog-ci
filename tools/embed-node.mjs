import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';
import { MODEL_INFO } from '../src/model-info.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
env.cacheDir = path.join(root, '.cache', 'models');
env.allowLocalModels = false;
let extractorPromise;

/** Same pinned q8 weights, tokenizer, pooling and normalization as the browser. */
export async function embedTextsNode(texts, onProgress) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) throw new TypeError('Expected an array of strings.');
  if (!texts.length) return [];
  extractorPromise ??= pipeline('feature-extraction', MODEL_INFO.id, {
    revision: MODEL_INFO.revision,
    device: 'cpu',
    dtype: MODEL_INFO.dtype,
    progress_callback: onProgress,
  });
  const extractor = await extractorPromise;
  extractor.tokenizer.model_max_length = MODEL_INFO.maxTokens;
  const vectors = [];
  for (let index = 0; index < texts.length; index += 8) {
    const output = await extractor(texts.slice(index, index + 8), {
      pooling: 'mean', normalize: true,
    });
    vectors.push(...output.tolist());
    output.dispose?.();
  }
  return vectors;
}

export { MODEL_INFO };
