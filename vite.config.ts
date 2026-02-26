import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import manifest from './src/manifest.json';

export default defineConfig({
  root: 'src',
  optimizeDeps: {
    // Force bundle ONNX runtime to avoid dynamic imports from CDN
    include: ['onnxruntime-web'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  resolve: {
    // CRITICAL: Deduplicate onnxruntime-web to ensure single instance
    // Without this, transformers.js bundles its own copy and our
    // wasmPaths config doesn't affect it
    dedupe: ['onnxruntime-web', 'onnxruntime-common'],
  },
  plugins: [
    crx({ manifest }),
    viteStaticCopy({
      targets: [
        {
          // Copy ONNX Runtime WASM files to assets/
          // Note: ../node_modules because vite root is 'src'
          src: '../node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'assets'
        },
        {
          // Copy ONNX Runtime JavaScript modules for WASM backend
          // transformers.js dynamically imports these, they must be available locally
          src: '../node_modules/onnxruntime-web/dist/ort-wasm*.mjs',
          dest: 'assets'
        },
        {
          // Copy PDF.js worker for external worker mode
          // Note: ../node_modules because vite root is 'src'
          src: '../node_modules/pdfjs-dist/build/pdf.worker.mjs',
          dest: 'assets',
          rename: 'pdf.worker.mjs'
        },
        {
          // Copy extension icons to dist/icons/
          src: 'icons/*',
          dest: 'icons'
        }
      ]
    })
  ],
  build: {
    target: 'esnext',
    minify: false,
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
      },
    },
  },
});
