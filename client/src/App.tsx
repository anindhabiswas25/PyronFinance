import { SettleProbe } from './dev/SettleProbe.js';

// Phase 0 (docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md §3): this app has no real routing yet —
// that's Phase 1's job (§6, 10 pages). Right now it exists only to prove the browser-safe SDK
// entry bundles and runs against a real wallet extension.
export function App() {
  return <SettleProbe />;
}
