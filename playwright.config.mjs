import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  use: { baseURL: 'http://127.0.0.1:4173', channel: process.env.BROWSER_CHANNEL || undefined, viewport: { width: 1440, height: 960 } },
  webServer: {
    command: 'node scripts/serve.mjs 4173',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: false,
  },
});
