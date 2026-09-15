import { defineConfig } from 'vitest/config';

// Vitest 4 runs on its own (newer) Vite, so this config does not reuse vite.config.ts and its
// Vite 5 plugins. JSX is transformed from tsconfig's "react-jsx".
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/unit/**/*.test.{ts,tsx}', 'test/components/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 60_000,
  },
});
