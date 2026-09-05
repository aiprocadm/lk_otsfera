import { test, expect } from '@playwright/test';

// Этап 9 (У-175): эталон нового раздела — «Обмен с 1С» менеджера (корень раздела открывает первую вкладку).
test('manager exchange excel tab renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/exchange/excel');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`manager-exchange-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
