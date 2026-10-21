import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { env } from '@huggingface/transformers';
import { MODEL_INFO } from '../src/model-info.js';
import { createEmbeddingPipeline, createPinnedTokenizer, tokenizerAssetURL } from '../src/embedding-pipeline.js';
import { prepareSemanticText } from '../src/semantic-input.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
env.cacheDir = path.join(root, '.cache', 'models');
env.allowLocalModels = false;
let extractorPromise;
let tokenizerPromise;

async function readTokenizerJSON(filename) {
  const url = tokenizerAssetURL(filename);
  const localPath = path.join(env.cacheDir, MODEL_INFO.id, MODEL_INFO.revision, filename);
  try { return JSON.parse(await fs.readFile(localPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (env.allowRemoteModels === false) throw new Error(`Pinned tokenizer asset is not cached: ${filename}`);
  const response = await env.fetch(url);
  if (!response.ok) throw new Error(`Could not download pinned tokenizer asset ${filename} (HTTP ${response.status}).`);
  const json = await response.json();
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, JSON.stringify(json));
  return json;
}

/** Identical pinned tokenizer for inference and auditable token accounting. */
export function loadTokenizerNode() {
  tokenizerPromise ??= createPinnedTokenizer(readTokenizerJSON);
  return tokenizerPromise;
}

/** Same pinned q8 weights, tokenizer, pooling and normalization as the browser. */
export async function embedTextsNode(texts, onProgress) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) throw new TypeError('Expected an array of strings.');
  if (!texts.length) return [];
  extractorPromise ??= createEmbeddingPipeline('cpu', onProgress, loadTokenizerNode());
  const extractor = await extractorPromise;
  const preparedTexts = texts.map((text) => prepareSemanticText(text).text);
  const vectors = [];
  for (let index = 0; index < texts.length; index += 8) {
    const output = await extractor(preparedTexts.slice(index, index + 8), {
      pooling: 'mean', normalize: true,
    });
    vectors.push(...output.tolist());
    output.dispose?.();
  }
  return vectors;
}

export { MODEL_INFO };
