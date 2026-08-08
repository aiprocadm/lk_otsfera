import { test, expect } from '@playwright/test';

/**
 * Журнал аудита живёт в хабе «Настройки» (ТЗ 2026-08-04) и русифицирован.
 *
 * Колонка «Когда» маскируется: на свежей seed-базе время события — всегда
 * «сейчас», без маски эталон протухал бы на следующий же день.
 */

test('admin audit log renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/security/audit');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-audit-list-${testInfo.project.name}.png`, {
    fullPage: true,
    mask: [page.getByTestId('audit-created-at')],
  });
});

test('admin audit filtered by partner entity renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/security/audit?entity=partner');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-audit-partner-${testInfo.project.name}.png`, {
    fullPage: true,
    mask: [page.getByTestId('audit-created-at')],
  });
});
