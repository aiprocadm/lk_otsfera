import { test, expect } from '@playwright/test';

// Этап 9 (У-175): эталон нового раздела — «Сообщения» руководителя.
test('leader messages renders consistently', async ({ page }, testInfo) => {
  await page.goto('/leader/messages');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`leader-messages-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
