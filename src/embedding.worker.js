import { env, pipeline } from '@huggingface/transformers';
import { MODEL_INFO } from './model-info.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Single-thread WASM works without SharedArrayBuffer or special hosting headers.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

let extractorPromise;
let queue = Promise.resolve();

async function embed(id, texts) {
  const progress = (event) => self.postMessage({ id, type: 'progress', event });
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_INFO.id, {
      revision: MODEL_INFO.revision,
      device: 'wasm',
      dtype: MODEL_INFO.dtype,
      progress_callback: (event) => {
        const modelFile = event.file?.endsWith('.onnx');
        progress({
          status: 'loading',
          progress: event.status === 'ready' ? 90 : modelFile && Number.isFinite(event.progress) ? Math.round(event.progress * 0.9) : 0,
          message: modelFile ? 'Downloading the 23 MB open-source model (cached when supported)…' : 'Loading the local AI model…',
          file: event.file,
        });
      },
    });
  }
  const extractor = await extractorPromise;
  // FeatureExtractionPipeline 3.8.1 reads tokenizer.model_max_length; it does
  // not forward a call-time max_length option to the tokenizer.
  extractor.tokenizer.model_max_length = MODEL_INFO.maxTokens;
  const embeddings = [];
  for (let index = 0; index < texts.length; index += 8) {
    progress({ status: 'embedding', progress: 90 + Math.round(index / texts.length * 10), message: `Embedding ${Math.min(index + 8, texts.length)} of ${texts.length} passages locally…` });
    const output = await extractor(texts.slice(index, index + 8), {
      pooling: 'mean', normalize: true,
    });
    embeddings.push(...output.tolist());
    output.dispose?.();
  }
  progress({ status: 'ready', progress: 100, message: 'Local AI inference complete.' });
  self.postMessage({ id, type: 'result', embeddings });
}

self.onmessage = ({ data }) => {
  const { id, texts } = data;
  // Serialize requests because a WASM session cannot execute overlapping runs.
  queue = queue.then(() => embed(id, texts)).catch((error) => {
    extractorPromise = undefined;
    self.postMessage({ id, type: 'error', message: `${error.message || 'Model loading failed.'} No fallback results were substituted.` });
  });
};
