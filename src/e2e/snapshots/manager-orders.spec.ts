import { test, expect } from '@playwright/test';

test('manager orders list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/orders');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`manager-orders-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
