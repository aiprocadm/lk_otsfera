import { test, expect } from '@playwright/test';

test('leader dashboard renders consistently', async ({ page }, testInfo) => {
  await page.goto('/leader/dashboard');
  // KPI tiles + per-manager table are server-rendered; the events feed hydrates
  // on the client. Wait for network idle so the diff isn't caught mid-hydration.
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`leader-dashboard-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
