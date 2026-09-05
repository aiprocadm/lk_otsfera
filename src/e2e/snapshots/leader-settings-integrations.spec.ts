import { test, expect } from '@playwright/test';

// Этап 9 (У-175): эталон нового раздела — светофор интеграций (У-174).
test('leader integrations traffic light renders consistently', async ({ page }, testInfo) => {
  await page.goto('/leader/settings/integrations');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`leader-settings-integrations-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});
