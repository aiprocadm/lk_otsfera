import { test, expect } from '@playwright/test';

// Этап 9 (У-175): эталон нового раздела — правила выгрузки документов в 1С (этап 8).
test('admin 1c documents export renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/integrations/1c/documents');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-1c-documents-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
