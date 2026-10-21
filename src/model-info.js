import { INPUT_PREPARATION_VERSION } from './semantic-input.js';

/** Pinned model provenance shared by the browser and reproducible evaluation. */
export const MODEL_INFO = Object.freeze({
  id: 'Xenova/all-MiniLM-L6-v2',
  name: 'all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  library: '@huggingface/transformers',
  libraryVersion: '4.3.1',
  dimensions: 384,
  dtype: 'q8',
  runtime: 'ONNX Runtime · WebAssembly · CPU',
  license: 'Apache-2.0',
  modelBytes: 22972370,
  modelSha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
  downloadMB: 23,
  maxTokens: 256,
  inputPreparationVersion: INPUT_PREPARATION_VERSION,
  url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
  sourceUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2',
});
