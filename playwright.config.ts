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
    // Partner cabinet snapshots — anything in snapshots/ that isn't prefixed
    // with `organization-` or `manager-`. Uses the partner storageState.
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: 'playwright-report/.auth/partner.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/(?!organization-|manager-|admin-).*\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 375, height: 667 },
        storageState: 'playwright-report/.auth/partner.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/(?!organization-|manager-|admin-).*\.spec\.ts/,
    },
    // Organization cabinet snapshots — only files prefixed with `organization-`.
    // Uses the organization storageState.
    {
      name: 'org-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: 'playwright-report/.auth/organization.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/organization-.*\.spec\.ts/,
    },
    {
      name: 'org-mobile',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 375, height: 667 },
        storageState: 'playwright-report/.auth/organization.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/organization-.*\.spec\.ts/,
    },
    // Manager cabinet snapshots — only files prefixed with `manager-`. Uses
    // the manager storageState seeded by `manager@demo.local` in prisma/seed.ts.
    {
      name: 'mgr-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: 'playwright-report/.auth/manager.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/manager-.*\.spec\.ts/,
    },
    {
      name: 'mgr-mobile',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 375, height: 667 },
        storageState: 'playwright-report/.auth/manager.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/manager-.*\.spec\.ts/,
    },
    // Admin cabinet snapshots — only files prefixed with `admin-`. Uses the
    // admin storageState seeded by `admin@demo.local` in prisma/seed.ts.
    {
      name: 'admin-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: 'playwright-report/.auth/admin.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/admin-.*\.spec\.ts/,
    },
    {
      name: 'admin-mobile',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 375, height: 667 },
        storageState: 'playwright-report/.auth/admin.json',
      },
      dependencies: ['setup'],
      testMatch: /snapshots\/admin-.*\.spec\.ts/,
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // organization_cabinet / manager_cabinet are opt-in flags (off by
        // default for staged rollout, see src/lib/featureFlags.ts). Their e2e
        // specs need the cabinets live, so enable both for the test dev-server.
        // Playwright merges this onto process.env, so .env (DATABASE_URL, …)
        // is preserved.
        env: {
          FEATURE_ORGANIZATION_CABINET: '1',
          FEATURE_MANAGER_CABINET: '1',
        },
      },
});
