import { defineConfig, devices } from '@playwright/test';
// Server-side test runner: load E2E_* credentials from the gitignored
// `.env.server.local` (then browser-safe `.env.local` / `.env`). This file is
// never bundled into the frontend.
import { loadServerEnv } from './scripts/lib/load-env.mjs';

loadServerEnv();

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5177';

// Auto-start the dev server whenever the target is local (the default, or an
// E2E_BASE_URL pointing at localhost/127.0.0.1) so `npm run test:e2e` works
// without a manual server. A non-local E2E_BASE_URL is treated as external.
const localPort = (() => {
  try {
    const u = new URL(baseURL);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.port || '80';
  } catch {
    /* ignore */
  }
  return null;
})();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: localPort
    ? {
        command: `npm run dev -- --port ${localPort} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
