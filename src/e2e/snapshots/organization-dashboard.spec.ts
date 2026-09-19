import { test, expect } from '@playwright/test';

test('organization dashboard renders consistently', async ({ page }, testInfo) => {
  await page.goto('/organization/dashboard');
  // Wait for KPI tiles to settle — server-rendered but client hydration can
  // shift sub-pixel layout slightly.
  await page.waitForLoadState('networkidle');

  // Время события приходит из базы, а сид проставляет его «от сегодня»:
  // без маски эталон стареет от каждого пересоздания базы, без единой
  // правки кода. Маска закрывает только эту область — размер блока и всё
  // остальное на странице по-прежнему сверяются (прогон сопровождения №30).
  await expect(page).toHaveScreenshot(`organization-dashboard-${testInfo.project.name}.png`, {
    fullPage: true,
    mask: [page.getByTestId('event-time')],
  });
});
