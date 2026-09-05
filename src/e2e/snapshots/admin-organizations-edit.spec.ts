import { test, expect } from '@playwright/test';

// The override filter narrows the list to the org seeded with a
// partnerCommissionRate override, so the row link below deterministically
// leads to an edit page where the rate-override block is visible.
test('admin organizations override-filtered list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/organizations?withRateOverride=true');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-organizations-override-${testInfo.project.name}.png`, {
    fullPage: true
  });
});

test('admin organization edit page with rate override renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/organizations?withRateOverride=true');
  await page.waitForLoadState('networkidle');

  const detailHref = await page
    .locator('a[href^="/admin/organizations/"]')
    .first()
    .getAttribute('href');
  expect(detailHref).toBeTruthy();

  // Этап 9 (У-95): карточка стала вкладочной, форма и ставка — во вкладке «Настройки».
  await page.goto(detailHref! + '?tab=settings');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-organization-edit-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
