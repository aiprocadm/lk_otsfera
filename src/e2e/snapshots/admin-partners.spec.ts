import { test, expect } from '@playwright/test';

test('admin partners list renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/partners');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-partners-list-${testInfo.project.name}.png`, {
    fullPage: true
  });
});

// `demo-partner-norate` is seeded with a fixed id in prisma/seed.ts so the edit
// page is reachable deterministically without scraping an id from the list.
test('admin partner edit page renders consistently', async ({ page }, testInfo) => {
  await page.goto('/admin/partners/demo-partner-norate');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`admin-partner-edit-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
