import { defineConfig, devices } from '@playwright/test';

// Route smoke tests against a real dev server. The app reads the live indexer; with no relays or
// wallet running, pages show their honest empty and error states, which is what these tests check.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5176', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm exec vite --port 5176 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
