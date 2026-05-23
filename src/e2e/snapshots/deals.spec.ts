import { test, expect } from '@playwright/test';

test('partner deals list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/partner/deals');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`partner-deals-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
