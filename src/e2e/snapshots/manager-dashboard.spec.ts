import { test, expect } from '@playwright/test';

test('manager dashboard renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/dashboard');
  // KPI tiles are server-rendered but the events feed hydrates on the
  // client; wait until network idles to avoid a flicker frame in the diff.
  await page.waitForLoadState('networkidle');

  // Время события приходит из базы, а сид проставляет его «от сегодня»:
  // без маски эталон стареет от каждого пересоздания базы, без единой
  // правки кода. Маска закрывает только эту область — размер блока и всё
  // остальное на странице по-прежнему сверяются (прогон сопровождения №30).
  await expect(page).toHaveScreenshot(`manager-dashboard-${testInfo.project.name}.png`, {
    fullPage: true,
    mask: [page.getByTestId('event-time')],
  });
});
