import { test, expect } from '@playwright/test';

/**
 * Колонки «Создан» и «Последний вход» маскируются: первая равна дате seed,
 * вторую обновляет сам логин Playwright в auth.setup — без маски эталон
 * расходился бы на каждом прогоне.
 */
const DATE_CELLS = ['user-created-at', 'user-last-login'];

test('admin users list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/users');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-users-list-${testInfo.project.name}.png`, {
    fullPage: true,
    mask: DATE_CELLS.map((id) => page.getByTestId(id)),
  });
});

test('admin users filtered by partner role renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/users?role=partner');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-users-partner-${testInfo.project.name}.png`, {
    fullPage: true,
    mask: DATE_CELLS.map((id) => page.getByTestId(id)),
  });
});
