import { defineConfig, devices } from '@playwright/test';
// E2E runs against the 'e2e' build (environment.backend = 'memory'): the full UI, services, guards
// and a fake backend that mirrors firestore.rules ownership checks. Real Firebase is verified separately.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4300',
    viewport: { width: 1280, height: 860 },
    launchOptions: { executablePath: process.env['PW_CHROMIUM'] || '/opt/pw-browsers/chromium' },
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'node scripts/serve.mjs dist/interview-os/browser 4300', port: 4300, reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 }, launchOptions: { executablePath: process.env['PW_CHROMIUM'] || '/opt/pw-browsers/chromium' } } }],
});
