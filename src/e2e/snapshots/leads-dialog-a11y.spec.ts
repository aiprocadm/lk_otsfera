import { test, expect } from '@playwright/test';

// Validates the native-<dialog>-migrated lead-withdraw modal (Task 4).
// No `manager-`/`organization-` filename prefix => runs in the partner project.
// Adjust the leads URL + "Отозвать" trigger if the seed differs.
test.describe('lead-withdraw dialog: a11y', () => {
  test('Escape closes and restores focus to the trigger', async ({ page }) => {
    await page.goto('/partner/leads');
    await page.waitForLoadState('networkidle');

    const trigger = page.locator('button:has-text("Отозвать")').first();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('background is inert while the modal is open', async ({ page }) => {
    await page.goto('/partner/leads');
    await page.waitForLoadState('networkidle');

    await page.locator('button:has-text("Отозвать")').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const movedToBackground = await page.evaluate(() => {
      const bg = document.querySelector('nav a[href], header a[href]') as HTMLElement | null;
      bg?.focus();
      return !!bg && document.activeElement === bg;
    });
    expect(movedToBackground).toBe(false);
  });
});
