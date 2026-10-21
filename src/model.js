import { MODEL_INFO } from './model-info.js';

export { MODEL_INFO };

let worker;
let nextId = 0;
const pending = new Map();
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_TEXT_CHARACTERS = 20_000;

function report(callback, event) {
  // A presentation callback must never break the inference request.
  try { callback?.(event); } catch { /* Caller owns presentation errors. */ }
}

function failAll(error) {
  const requests = [...pending.values()];
  pending.clear();
  worker?.terminate();
  worker = undefined;
  for (const request of requests) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
}

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
    throw new Error('This browser needs Web Workers and WebAssembly to run the local AI model. Try a current Chrome, Firefox, Edge, or Safari.');
  }
  worker = new Worker(new URL('./embedding.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    if (data.type === 'progress') {
      report(request.onProgress, data.event);
    } else if (data.type === 'result') {
      pending.delete(data.id);
      clearTimeout(request.timeout);
      request.resolve(data.embeddings);
    } else if (data.type === 'error') {
      failAll(new Error(data.message || 'The local embedding model could not run.'));
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    failAll(new Error(event.message || 'The local AI worker could not start. Check your network and browser, then retry.'));
  };
  worker.onmessageerror = () => failAll(new Error('The local AI worker returned an unreadable message. Please retry.'));
  return worker;
}

/**
 * Return L2-normalized, 384-dimensional semantic vectors from the real q8 model.
 * onProgress({ status, progress, message, file? }) uses percent values 0–100.
 * Inputs stay in this browser; only model/runtime assets are downloaded.
 * There is intentionally no mock or keyword-based fallback.
 */
export async function embedTexts(texts, onProgress) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) {
    throw new TypeError('embedTexts expects an array of strings.');
  }
  if (texts.length === 0) return [];
  if (texts.length > 1000) throw new RangeError('Embed at most 1,000 passages in one request.');
  if (texts.some((text) => text.length > MAX_TEXT_CHARACTERS)) {
    throw new RangeError('Each passage must be at most 20,000 characters. Split longer logs into smaller passages first.');
  }
  const target = getWorker();
  const id = ++nextId;
  report(onProgress, { status: 'loading', progress: 0, message: 'Preparing the local AI model…' });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      failAll(new Error('The local AI model timed out after three minutes. Check your connection, retry with fewer passages, or reload the page. No fallback results were substituted.'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, onProgress, timeout });
    try { target.postMessage({ id, texts }); }
    catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
  });
}

/** Release model memory; pending requests reject instead of hanging. */
export function releaseModel() {
  failAll(new Error('Local model was released. Run the search again to reload it.'));
}
