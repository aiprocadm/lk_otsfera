import { test, expect } from '@playwright/test';

test('organization dashboard renders consistently', async ({ page }, testInfo) => {
  await page.goto('/organization/dashboard');
  // Wait for KPI tiles to settle — server-rendered but client hydration can
  // shift sub-pixel layout slightly.
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`organization-dashboard-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
