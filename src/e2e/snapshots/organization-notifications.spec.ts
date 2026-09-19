import { test, expect } from '@playwright/test';

/**
 * Эталон «Уведомлений» заказчика (этап 5, `У-228`). Зеркало кабинета
 * сотрудника по правилу `У-121`.
 */
test('organization notification center renders consistently', async ({ page }, testInfo) => {
  await page.goto('/organization/notifications');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`organization-notifications-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
