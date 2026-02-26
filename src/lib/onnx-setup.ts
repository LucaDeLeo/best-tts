/**
 * ONNX Runtime Setup for Chrome Extension
 *
 * CRITICAL: This module MUST be imported BEFORE any module that imports
 * @huggingface/transformers (including kokoro-js).
 *
 * When transformers.js is imported, it checks if ONNX_ENV.wasm.wasmPaths is set.
 * If not, it defaults to loading from jsdelivr CDN which violates extension CSP.
 *
 * By configuring onnxruntime-web FIRST in this separate module, we ensure
 * the wasmPaths is set before transformers.js checks it.
 */
import * as ort from 'onnxruntime-web';

// Get extension assets URL
const assetsUrl = chrome.runtime.getURL('assets/');

// Configure ONNX Runtime WASM backend to load from extension assets
// This MUST happen before transformers.js is imported
ort.env.wasm.wasmPaths = assetsUrl;
ort.env.wasm.numThreads = 1; // Single-threaded to avoid cross-origin isolation issues

console.log('[ONNX Setup] Configured wasmPaths:', assetsUrl);

// Export for potential reuse
export { ort, assetsUrl };
