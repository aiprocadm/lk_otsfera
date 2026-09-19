import { test, expect } from '@playwright/test';

/**
 * Эталон «Материалов для партнёров» (этап 6, `У-237`). Файл без ролевого
 * префикса — значит проекты `desktop` и `mobile-partner`.
 */
test('partner materials renders consistently', async ({ page }, testInfo) => {
  await page.goto('/partner/materials');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`partner-materials-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
