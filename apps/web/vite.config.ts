import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Phase 0 task 0.1/0.2 (docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md §3). No polyfills for
// node:crypto/node:util/Buffer are configured here on purpose: the browser-safe SDK entry
// (@otc/sdk/browser) must build without any of them. If a future import of that entry ever pulls
// one in, this build should fail loudly rather than silently polyfilling it — see
// docs/ROADMAP.md's Phase 0 gate report for how this was verified.
//
// wasm()/topLevelAwait() ARE required, and are not a Node-vs-browser compromise: ledger-v8 and
// compact-runtime are genuinely WASM (the ZK proving/verification runtime itself), and Vite has no
// built-in support for the WASM ESM-integration proposal these packages use (confirmed by a real
// `vite build` failing with exactly that error before these plugins were added — see
// docs/ROADMAP.md's Phase 0 gate report).
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
});
