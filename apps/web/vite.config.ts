import fs from 'node:fs';
import path from 'node:path';
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
//
// The runtime packages are pinned to the SDK's own copies. `contracts/managed/.../index.js` lives
// outside every package, so it resolves `@midnight-ntwrk/compact-runtime` from the repo-root
// node_modules, whose onchain-runtime-v3 is 3.1.0 against the SDK's 3.1.1. Unpinned, the bundle
// carried two runtime WASM instances, and a ContractState built by one was read by the other.
const sdkModules = path.resolve(import.meta.dirname, '../../packages/sdk/node_modules');
const pinned = ['@midnight-ntwrk/compact-runtime', '@midnight-ntwrk/onchain-runtime-v3', '@midnight-ntwrk/ledger-v8'];

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: pinned.map((name) => ({ find: new RegExp(`^${name}$`), replacement: fs.realpathSync(path.join(sdkModules, name)) })),
  },
});
