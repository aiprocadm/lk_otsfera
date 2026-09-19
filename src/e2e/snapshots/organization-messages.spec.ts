import { test, expect } from '@playwright/test';

/**
 * Эталон «Переписки с менеджером» (этап 6, `У-234`). Требует
 * `FEATURE_CABINET_QUESTIONS=1`.
 *
 * **Зачем именно этот эталон.** Сухой прогон приёмки (этап 10) нашёл здесь
 * экран БЕЗ оболочки кабинета: ни меню, ни шапки, ни кнопки «Выйти». Картинка
 * во всю страницу ловит ровно это — пропавшую оболочку видно сразу.
 */
test('organization messages with manager renders consistently', async ({ page }, testInfo) => {
  await page.goto('/organization/messages?tab=manager');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`organization-messages-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
