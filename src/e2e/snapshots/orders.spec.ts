import { test, expect } from '@playwright/test';

test('partner orders list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/partner/orders');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`partner-orders-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
