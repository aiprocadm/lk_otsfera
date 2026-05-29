import { test, expect } from '@playwright/test';

test('admin audit log renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/audit');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-audit-list-${testInfo.project.name}.png`, {
    fullPage: true
  });
});

test('admin audit filtered by partner entity renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/audit?entity=partner');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-audit-partner-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
