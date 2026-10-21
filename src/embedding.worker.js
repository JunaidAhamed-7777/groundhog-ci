import { env } from '@huggingface/transformers';
import { MODEL_INFO } from './model-info.js';
import { createEmbeddingPipeline } from './embedding-pipeline.js';
import { prepareSemanticText } from './semantic-input.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Single-thread WASM works without SharedArrayBuffer or special hosting headers.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
// Vite aliases ORT to its supported CPU-only entry. Resolve that entry's
// matching bundled .mjs/.wasm instead of Transformers' WebGPU CDN default.
env.backends.onnx.wasm.wasmPaths = undefined;

let extractorPromise;
let queue = Promise.resolve();

async function embed(id, texts) {
  const progress = (event) => self.postMessage({ id, type: 'progress', event });
  if (!extractorPromise) {
    extractorPromise = createEmbeddingPipeline('wasm', (event) => {
        const modelFile = event.file?.endsWith('.onnx');
        progress({
          status: 'loading',
          progress: event.status === 'ready' ? 90 : modelFile && Number.isFinite(event.progress) ? Math.round(event.progress * 0.9) : 0,
          message: modelFile ? 'Downloading the 23 MB open-source model (cached when supported)…' : 'Loading the local AI model…',
          file: event.file,
        });
    });
  }
  const extractor = await extractorPromise;
  const preparedTexts = texts.map((text) => prepareSemanticText(text).text);
  const embeddings = [];
  for (let index = 0; index < texts.length; index += 8) {
    progress({ status: 'embedding', progress: 90 + Math.round(index / texts.length * 10), message: `Embedding ${Math.min(index + 8, texts.length)} of ${texts.length} passages locally…` });
    const output = await extractor(preparedTexts.slice(index, index + 8), {
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
