import { test, expect } from '@playwright/test';

test('manager dashboard renders consistently', async ({ page }, testInfo) => {
  await page.goto('/manager/dashboard');
  // KPI tiles are server-rendered but the events feed hydrates on the
  // client; wait until network idles to avoid a flicker frame in the diff.
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`manager-dashboard-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
