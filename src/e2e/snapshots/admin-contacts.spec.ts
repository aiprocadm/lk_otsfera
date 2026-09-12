import { test, expect } from '@playwright/test';

/**
 * Эталон раздела «Контакты» (этап 1 ТЗ 12.09.2026, `У-178`). Требует
 * `FEATURE_CONTACTS=1` на тестовом dev-сервере — флаг opt-in; без него страница
 * отвечает 404 и обход правил экранов считает её «недоступной».
 */
test('admin contacts list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/contacts');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-contacts-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
