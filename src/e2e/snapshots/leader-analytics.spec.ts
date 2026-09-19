import { test, expect } from '@playwright/test';

/**
 * Эталон «Аналитики» руководителя (этап 7, `У-243`). Требует
 * `FEATURE_LEADER_ANALYTICS=1`. Снимается вкладка по умолчанию «План и
 * факт» — остальные пять открываются с неё.
 */
test('leader analytics plan-fact renders consistently', async ({ page }, testInfo) => {
  await page.goto('/leader/analytics');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`leader-analytics-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
