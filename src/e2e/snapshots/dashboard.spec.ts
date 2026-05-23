import { test, expect } from '@playwright/test';

test('partner dashboard renders consistently', async ({ page }, testInfo) => {
  await page.goto('/partner/dashboard');
  // Wait for KPI tiles to settle — they're rendered server-side but client
  // hydration can shift sub-pixel layout slightly.
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`partner-dashboard-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
