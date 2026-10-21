import { AutoModel, BertTokenizer, FeatureExtractionPipeline, env } from '@huggingface/transformers';
import { MODEL_INFO } from './model-info.js';

export function tokenizerAssetURL(filename) {
  if (!['tokenizer.json', 'tokenizer_config.json'].includes(filename)) throw new Error('Unexpected tokenizer asset.');
  return `https://huggingface.co/${MODEL_INFO.id}/resolve/${MODEL_INFO.revision}/${filename}`;
}

async function readBrowserTokenizerJSON(filename) {
  const url = tokenizerAssetURL(filename);
  let cache;
  try { if (typeof caches !== 'undefined') cache = await caches.open('groundhog-pinned-tokenizers-v1'); }
  catch { /* Cache availability must not be required for inference. */ }
  const cached = await cache?.match(url);
  if (cached) return cached.json();
  if (env.allowRemoteModels === false) throw new Error(`Pinned tokenizer asset is not cached: ${filename}`);
  const response = await env.fetch(url);
  if (!response.ok) throw new Error(`Could not download pinned tokenizer asset ${filename} (HTTP ${response.status}).`);
  try { await cache?.put(url, response.clone()); } catch { /* Private browsing can disable writes. */ }
  return response.json();
}

/** The pinned artifact declares BertTokenizer; avoid v4's mutable-main discovery. */
export async function createPinnedTokenizer(readJSON = readBrowserTokenizerJSON) {
  const [json, config] = await Promise.all(['tokenizer.json', 'tokenizer_config.json'].map(readJSON));
  if (config.tokenizer_class?.replace(/Fast$/, '') !== 'BertTokenizer') throw new Error('Unexpected pinned tokenizer architecture.');
  return new BertTokenizer(json, { ...config, model_max_length: MODEL_INFO.maxTokens });
}

/** Load every inference asset from the same pinned model revision. */
export async function createEmbeddingPipeline(device, onProgress, tokenizerPromise = createPinnedTokenizer()) {
  const options = { revision: MODEL_INFO.revision, progress_callback: onProgress };
  // v4's high-level pipeline() metadata discovery does not forward revision.
  // AutoTokenizer has the same unpinned discovery issue, so construct the
  // declared official BertTokenizer from pinned JSON/config. Pooling and
  // normalization still use the official FeatureExtractionPipeline unchanged.
  const [tokenizer, model] = await Promise.all([
    tokenizerPromise,
    AutoModel.from_pretrained(MODEL_INFO.id, { ...options, device, dtype: MODEL_INFO.dtype }),
  ]);
  onProgress?.({ status: 'ready', task: 'feature-extraction', model: MODEL_INFO.id });
  return new FeatureExtractionPipeline({ task: 'feature-extraction', tokenizer, model });
}
