import { test as setup, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PARTNER_AUTH_FILE = 'playwright-report/.auth/partner.json';
const ORG_AUTH_FILE = 'playwright-report/.auth/organization.json';
const MANAGER_AUTH_FILE = 'playwright-report/.auth/manager.json';
const ADMIN_AUTH_FILE = 'playwright-report/.auth/admin.json';

const PARTNER_EMAIL = process.env.E2E_PARTNER_EMAIL ?? 'partner@demo.local';
const PARTNER_PASSWORD = process.env.E2E_PARTNER_PASSWORD ?? 'Password123!';

const ORG_EMAIL = process.env.E2E_ORG_EMAIL ?? 'org@demo.local';
const ORG_PASSWORD = process.env.E2E_ORG_PASSWORD ?? 'Password123!';

const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL ?? 'manager@demo.local';
const MANAGER_PASSWORD = process.env.E2E_MANAGER_PASSWORD ?? 'Password123!';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Password123!';

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
// Selectors note: the login page's <label> elements are not associated to
// their inputs via htmlFor/id, so `getByLabel` doesn't match. We anchor on
// input[type="..."] which is the actual DOM contract.

setup('authenticate as partner admin', async ({ page, context }) => {
  ensureDir(PARTNER_AUTH_FILE);

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(PARTNER_EMAIL);
  await page.locator('input[type="password"]').fill(PARTNER_PASSWORD);
  await page.getByRole('button', { name: /войти|sign in|log in/i }).click();

  // Successful login redirects to /partner/dashboard (or /dashboard which then
  // redirects role-aware). Wait for the partner-side url.
  await page.waitForURL(/\/partner\/dashboard/);
  await expect(page).toHaveURL(/\/partner\/dashboard/);

  await context.storageState({ path: PARTNER_AUTH_FILE });
});

setup('authenticate as organization admin', async ({ page, context }) => {
  ensureDir(ORG_AUTH_FILE);

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(ORG_EMAIL);
  await page.locator('input[type="password"]').fill(ORG_PASSWORD);
  await page.getByRole('button', { name: /войти|sign in|log in/i }).click();

  // Successful login redirects to /organization/dashboard for org users.
  await page.waitForURL(/\/organization\/dashboard/);
  await expect(page).toHaveURL(/\/organization\/dashboard/);

  await context.storageState({ path: ORG_AUTH_FILE });
});

setup('authenticate as manager', async ({ page, context }) => {
  ensureDir(MANAGER_AUTH_FILE);

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(MANAGER_EMAIL);
  await page.locator('input[type="password"]').fill(MANAGER_PASSWORD);
  await page.getByRole('button', { name: /войти|sign in|log in/i }).click();

  // Successful login redirects role-aware via /dashboard → /manager/dashboard.
  // We only assert the manager-side url so the redirect chain is implicitly
  // covered.
  await page.waitForURL(/\/manager\/dashboard/);
  await expect(page).toHaveURL(/\/manager\/dashboard/);

  await context.storageState({ path: MANAGER_AUTH_FILE });
});

setup('authenticate as admin', async ({ page, context }) => {
  ensureDir(ADMIN_AUTH_FILE);

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /войти|sign in|log in/i }).click();

  // Successful login redirects role-aware via /dashboard → /admin/dashboard.
  await page.waitForURL(/\/admin\/dashboard/);
  await expect(page).toHaveURL(/\/admin\/dashboard/);

  await context.storageState({ path: ADMIN_AUTH_FILE });
});
