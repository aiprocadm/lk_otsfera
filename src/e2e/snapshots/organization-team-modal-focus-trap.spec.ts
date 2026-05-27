import { test, expect } from '@playwright/test';

const TRIGGER = 'button:has-text("Пригласить участника")';
const EMAIL_INPUT = 'input[name="email"]';
const SUBMIT = 'button[type="submit"]';
const CLOSE_X = 'button[aria-label="Закрыть"]';

test.describe('invite-org-user-form: focus management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/organization/team');
    await page.waitForLoadState('networkidle');
  });

  test('initial focus moves into modal on open', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await expect(page.locator(EMAIL_INPUT)).toBeFocused();
  });

  test('Tab from last focusable wraps to first', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await page.locator(SUBMIT).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator(CLOSE_X)).toBeFocused();
  });

  test('Shift+Tab from first focusable (close ×) wraps to last (submit)', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await page.locator(CLOSE_X).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator(SUBMIT)).toBeFocused();
  });

  test('focus restores to trigger after Escape', async ({ page }) => {
    await page.locator(TRIGGER).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(EMAIL_INPUT)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator(TRIGGER)).toBeFocused();
  });
});
