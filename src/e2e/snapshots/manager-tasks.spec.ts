import { test, expect } from '@playwright/test';

/**
 * Эталон «Задач» менеджера (этап 4, `У-218`). Требует `FEATURE_INTERNAL_TASKS=1`.
 */
test('manager tasks board renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/tasks');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`manager-tasks-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
