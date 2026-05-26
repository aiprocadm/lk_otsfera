import { test, expect } from '@playwright/test';

test('organization documents list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/organization/documents');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`organization-documents-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
