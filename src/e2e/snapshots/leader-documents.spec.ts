import { test, expect } from '@playwright/test';

// Этап 9 (У-175): эталон нового раздела — «Документы» руководителя, зеркало менеджера.
test('leader documents list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/leader/documents');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`leader-documents-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
