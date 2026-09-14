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
//
// "The SDK's own copy" is resolved the way Node resolves it from packages/sdk: its nested
// node_modules first, then upwards. pnpm's hoisted linker only nests a copy there when versions
// conflict; a clean install from the committed lockfile (onchain-runtime-v3 3.1.0 only) nests
// nothing, and a hardcoded nested path then fails to load the config at all.
const sdkDir = path.resolve(import.meta.dirname, '../packages/sdk');
const pinned = ['@midnight-ntwrk/compact-runtime', '@midnight-ntwrk/onchain-runtime-v3', '@midnight-ntwrk/ledger-v8'];

function resolveFromSdk(name: string): string {
  for (let dir = sdkDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    if (path.dirname(dir) === dir) throw new Error(`${name} is not resolvable from ${sdkDir}`);
  }
}

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: pinned.map((name) => ({ find: new RegExp(`^${name}$`), replacement: resolveFromSdk(name) })),
  },
  // 5173 is left free for other dev servers on this machine; strictPort fails loudly instead of drifting.
  server: { port: 5174, strictPort: true },
});
