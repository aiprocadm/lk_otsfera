import { test, expect } from '@playwright/test';

test('leader dashboard renders consistently', async ({ page }, testInfo) => {
  await page.goto('/leader/dashboard');
  // KPI tiles + per-manager table are server-rendered; the events feed hydrates
  // on the client. Wait for network idle so the diff isn't caught mid-hydration.
  await page.waitForLoadState('networkidle');

  // Время события приходит из базы, а сид проставляет его «от сегодня»:
  // без маски эталон стареет от каждого пересоздания базы, без единой
  // правки кода. Маска закрывает только эту область — размер блока и всё
  // остальное на странице по-прежнему сверяются (прогон сопровождения №30).
  await expect(page).toHaveScreenshot(`leader-dashboard-${testInfo.project.name}.png`, {
    fullPage: true,
    mask: [page.getByTestId('event-time')],
  });
});
