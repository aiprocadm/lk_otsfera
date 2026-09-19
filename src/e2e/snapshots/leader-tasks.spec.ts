import { test, expect } from '@playwright/test';

/**
 * Эталон «Задач» руководителя (этап 4, `У-218`). Зеркало менеджерского
 * раздела: одно название, одно место, один значок (`У-121`).
 */
test('leader tasks board renders consistently', async ({ page }, testInfo) => {
  await page.goto('/leader/tasks');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`leader-tasks-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
