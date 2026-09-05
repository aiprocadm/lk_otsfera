import { test, expect } from '@playwright/test';

// Этап 9 (У-175): карточка заказа партнёра после переименования раздела
// (У-109). Эталон списка уже есть в orders.spec.ts; здесь — первый заказ из
// него, чтобы не зависеть от id seed-данных.
test('partner order card renders consistently', async ({ page }, testInfo) => {
  await page.goto('/partner/orders');
  await page.waitForLoadState('networkidle');

  const detailHref = await page
    .locator('a[href^="/partner/orders/"]:not([href$="/new"])')
    .first()
    .getAttribute('href');
  expect(detailHref).toBeTruthy();

  await page.goto(detailHref!);
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`partner-order-card-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
