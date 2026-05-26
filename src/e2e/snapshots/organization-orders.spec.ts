import { test, expect } from '@playwright/test';

test('organization orders list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/organization/orders');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`organization-orders-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
