import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression tests for the partner cabinet.
 *
 * Baselines are committed under src/e2e/snapshots/<spec>-snapshots/. The
 * first run on a new platform should be made with `--update-snapshots` to
 * generate them; subsequent runs compare.
 *
 * We split into two projects (mobile + desktop) rather than a parameterised
 * test, so each viewport has its own snapshot folder and parallel-safe ids.
 */
export default defineConfig({
  testDir: './src/e2e',
  outputDir: './playwright-report/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/html' }]],
  expect: {
    toHaveScreenshot: {
      // Allow tiny anti-aliasing differences without re-baselining.
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: 'playwright-report/.auth/partner.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/.*\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 375, height: 667 },
        storageState: 'playwright-report/.auth/partner.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/.*\.spec\.ts/,
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
