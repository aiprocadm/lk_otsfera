import { test, expect } from '@playwright/test';

test('manager documents list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/documents');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`manager-documents-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
