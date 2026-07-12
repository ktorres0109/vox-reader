import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  fullyParallel: true,
  webServer: {
    command: 'node tools/e2e-server.mjs',
    url: 'http://127.0.0.1:4173/tests/fixtures/article.html',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  use: {
    trace: 'on-first-retry',
  },
});
