import { test, expect } from '@playwright/test';

/**
 * Эталон «Мессенджеров» (этап 3, `У-206`). Требует `FEATURE_INBOUND_MESSAGING=1`.
 */
test('manager messengers list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/messengers');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`manager-messengers-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
