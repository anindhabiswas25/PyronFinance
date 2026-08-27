import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['contracts/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // Circuit execution is CPU-heavy (submitFraudProofMismatch does in-circuit Schnorr
    // verification plus a two-limb range-checked reduction). Default 5s is not enough.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
