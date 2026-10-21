import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Groundhog deliberately supports CPU/WASM only. The official CPU-only
  // entry avoids shipping the larger WebGPU/Asyncify runtime unnecessarily.
  resolve: {
    alias: [{ find: 'onnxruntime-web/webgpu', replacement: 'onnxruntime-web/wasm' }],
  },
  worker: { format: 'es' },
});
