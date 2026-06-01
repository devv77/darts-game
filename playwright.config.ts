import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const PORT = 4599;
const DATA_DIR = path.join(process.cwd(), 'e2e', '.tmp-data');

/**
 * E2E config. The prod server (apps/server/dist) serves the built web app
 * (apps/web/dist) on a single origin, so there's no Vite proxy to worry about.
 * With no GOOGLE_CLIENT_ID / TEST_GOOGLE_CLIENT_ID set, the server enables
 * passwordless local sign-in — the door the tests walk through. DATA_DIR points
 * at a throwaway DB that the `test:e2e` script wipes before each run.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node apps/server/dist/index.js',
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR,
      // Force local-auth mode (no Google) so the tests can sign in headlessly.
      GOOGLE_CLIENT_ID: '',
      TEST_GOOGLE_CLIENT_ID: '',
      ADMIN_EMAILS: '',
      NODE_ENV: 'test',
    },
  },
});
