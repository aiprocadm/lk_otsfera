import { test, expect } from '@playwright/test';

/**
 * Эталон раздела «Миграция из Битрикс24» (этап 2, `У-189`). Требует
 * `FEATURE_BITRIX_MIGRATION=1`: флаг opt-in, без него страница отвечает 404.
 * Снимается вкладка «Подключение» — на «Пакетах» живут даты прогонов, и
 * картинка расходилась бы каждый день.
 */
test('admin bitrix migration renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/integrations/bitrix');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-bitrix-migration-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
