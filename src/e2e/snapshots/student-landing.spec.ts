import { test, expect } from '@playwright/test';

test('student landing renders consistently', async ({ page }, testInfo) => {
  await page.goto('/student');
  // Static bridge landing ("Кабинет слушателя" + CTA to /student/redirect). No
  // client-fetched data, but wait for network idle for parity with the other
  // specs so fonts/icons settle before the shot.
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot(`student-landing-${testInfo.project.name}.png`, {
    fullPage: true
  });
});
