import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import manifest from './src/manifest.json';

export default defineConfig({
  root: 'src',
  plugins: [
    crx({ manifest }),
    viteStaticCopy({
      targets: [
        {
          // Copy ONNX Runtime WASM files to assets/
          src: '../node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'assets'
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
      },
    },
  },
});
