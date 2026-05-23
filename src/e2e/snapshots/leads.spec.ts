import { test, expect } from '@playwright/test';

test('partner leads list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/partner/leads');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`partner-leads-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
