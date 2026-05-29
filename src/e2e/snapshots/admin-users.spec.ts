import { test, expect } from '@playwright/test';

test('admin users list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/users');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-users-list-${testInfo.project.name}.png`, {
    fullPage: true
  });
});

test('admin users filtered by partner role renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/users?role=partner');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-users-partner-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
