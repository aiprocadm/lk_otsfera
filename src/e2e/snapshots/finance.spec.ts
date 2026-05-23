import { test, expect } from '@playwright/test';

test('partner finance page renders consistently', async ({ page }, testInfo) => {
  await page.goto('/partner/finance');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`partner-finance-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
