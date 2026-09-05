import { test, expect } from '@playwright/test';

// Этап 9 (У-175): эталон нового раздела — каталог услуг и цены (этап 5).
test('leader price list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/leader/settings/catalogs/price-list');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`leader-settings-price-list-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
