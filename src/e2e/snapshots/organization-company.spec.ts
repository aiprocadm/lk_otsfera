import { test, expect } from '@playwright/test';

// Этап 9 (У-175): эталон нового раздела — «Моя организация» заказчика (этап 2).
test('organization company card renders consistently', async ({ page }, testInfo) => {
  await page.goto('/organization/company');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`organization-company-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
