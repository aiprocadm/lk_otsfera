import { test, expect } from '@playwright/test';

/**
 * Эталон «Входящих в работу» (этап 3, `У-205`). Очередь разбора: заявки,
 * обращения и звонки, самое залежавшееся сверху.
 */
test('manager intake queue renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/intake');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`manager-intake-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
