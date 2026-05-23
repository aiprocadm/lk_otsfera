import { test as setup, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PARTNER_AUTH_FILE = 'playwright-report/.auth/partner.json';

const PARTNER_EMAIL = process.env.E2E_PARTNER_EMAIL ?? 'partner@demo.local';
const PARTNER_PASSWORD = process.env.E2E_PARTNER_PASSWORD ?? 'Password123!';

/**
 * Logs in once and saves the session cookie to disk. All snapshot specs
 * reuse this state via the project's `storageState` so we don't pay the
 * login round-trip on every test.
 */
setup('authenticate as partner admin', async ({ page, context }) => {
  if (!existsSync(dirname(PARTNER_AUTH_FILE))) {
    mkdirSync(dirname(PARTNER_AUTH_FILE), { recursive: true });
  }

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(PARTNER_EMAIL);
  await page.getByLabel(/пароль|password/i).fill(PARTNER_PASSWORD);
  await page.getByRole('button', { name: /войти|sign in|log in/i }).click();

  // Successful login redirects to /partner/dashboard.
  await page.waitForURL(/\/partner\/dashboard/);
  await expect(page).toHaveURL(/\/partner\/dashboard/);

  await context.storageState({ path: PARTNER_AUTH_FILE });
});
