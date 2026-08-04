import { test, expect } from '@playwright/test';

/**
 * Журнал аудита переехал в хаб «Настройки» (ТЗ 2026-08-04) и стал русским —
 * эталонные снимки нужно перегенерировать: `npm run e2e:visual:update`.
 */

test('admin audit log renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/security/audit');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-audit-list-${testInfo.project.name}.png`, {
    fullPage: true
  });
});

test('admin audit filtered by partner entity renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/security/audit?entity=partner');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-audit-partner-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
