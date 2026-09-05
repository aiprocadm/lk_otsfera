import { test, expect } from '@playwright/test';

// Этап 9 (У-175): эталон нового раздела — шаблоны документов (этап 4).
test('admin document templates renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/catalogs/document-templates');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-document-templates-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
