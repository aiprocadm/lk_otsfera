import { test as setup, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PARTNER_AUTH_FILE = 'playwright-report/.auth/partner.json';
const ORG_AUTH_FILE = 'playwright-report/.auth/organization.json';

const PARTNER_EMAIL = process.env.E2E_PARTNER_EMAIL ?? 'partner@demo.local';
const PARTNER_PASSWORD = process.env.E2E_PARTNER_PASSWORD ?? 'Password123!';

const ORG_EMAIL = process.env.E2E_ORG_EMAIL ?? 'org@demo.local';
const ORG_PASSWORD = process.env.E2E_ORG_PASSWORD ?? 'Password123!';

function ensureDir(file: string) {
  if (!existsSync(dirname(file))) {
    mkdirSync(dirname(file), { recursive: true });
  }
}

/**
 * Logs in once per role and saves the session cookie to disk. Snapshot specs
 * reuse this state via the project's `storageState` so we don't pay the
 * login round-trip on every test.
 */
setup('authenticate as partner admin', async ({ page, context }) => {
  ensureDir(PARTNER_AUTH_FILE);

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(PARTNER_EMAIL);
  await page.getByLabel(/пароль|password/i).fill(PARTNER_PASSWORD);
  await page.getByRole('button', { name: /войти|sign in|log in/i }).click();

  // Successful login redirects to /partner/dashboard.
  await page.waitForURL(/\/partner\/dashboard/);
  await expect(page).toHaveURL(/\/partner\/dashboard/);

  await context.storageState({ path: PARTNER_AUTH_FILE });
});

setup('authenticate as organization admin', async ({ page, context }) => {
  ensureDir(ORG_AUTH_FILE);

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ORG_EMAIL);
  await page.getByLabel(/пароль|password/i).fill(ORG_PASSWORD);
  await page.getByRole('button', { name: /войти|sign in|log in/i }).click();

  // Successful login redirects to /organization/dashboard.
  await page.waitForURL(/\/organization\/dashboard/);
  await expect(page).toHaveURL(/\/organization\/dashboard/);

  await context.storageState({ path: ORG_AUTH_FILE });
});
