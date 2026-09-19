import { test, expect } from '@playwright/test';

/**
 * Эталон «Уведомлений» менеджера (этап 5, `У-228`). Требует
 * `FEATURE_NOTIFICATION_CENTER=1`.
 */
test('manager notification center renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/notifications');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`manager-notifications-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
