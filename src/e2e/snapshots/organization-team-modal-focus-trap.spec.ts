import { test, expect, type Page } from '@playwright/test';

const TRIGGER = 'button:has-text("Пригласить участника")';
// Scope in-dialog controls to the *open* native <dialog>: the org layout's
// header logout button is also type="submit", and since the mobile shell
// arrived the page carries three <dialog> elements at once (burger menu and
// friends), each with its own «Закрыть». An unscoped `dialog …` selector
// matches all of them and trips Playwright strict mode — the guard then stops
// guarding instead of failing loudly. `[open]` leaves exactly the modal under
// test.
const EMAIL_INPUT = 'dialog[open] input[name="email"]';
const SUBMIT = 'dialog[open] button[type="submit"]';
const CLOSE_X = 'dialog[open] button[aria-label="Закрыть"]';

// Native <dialog> traps focus via `inert`: at the Tab cycle boundary focus may
// rest on <body>/the dialog, but it must never reach a *background* control.
// (useDialogFocus used to wrap tightly to first/last child; the plan replaced
// it with native, so we assert containment — not the exact wrap target.)
function escapedToBackground(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return (
      !!a &&
      a.matches('a[href], button, input, select, textarea, [tabindex]') &&
      !a.closest('dialog')
    );
  });
}

test.describe('invite-org-user-form: focus management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/organization/team');
    await page.waitForLoadState('networkidle');
  });

  test('initial focus moves into modal on open', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await expect(page.locator(EMAIL_INPUT)).toBeFocused();
  });

  test('Tab from the last control never reaches a background control', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await page.locator(SUBMIT).focus();
    await page.keyboard.press('Tab');
    expect(await escapedToBackground(page)).toBe(false);
  });

  test('Shift+Tab from the first control never reaches a background control', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await page.locator(CLOSE_X).focus();
    await page.keyboard.press('Shift+Tab');
    expect(await escapedToBackground(page)).toBe(false);
  });

  test('focus restores to trigger after Escape', async ({ page }) => {
    await page.locator(TRIGGER).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(EMAIL_INPUT)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator(TRIGGER)).toBeFocused();
  });

  test('background is inert while the modal is open', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await expect(page.locator(EMAIL_INPUT)).toBeFocused();

    // showModal() makes the rest of the document inert: a programmatic focus on
    // a background link must NOT move focus out of the dialog (regression guard
    // for the gap the 2026-05-27 custom-<div> modals left open).
    const movedToBackground = await page.evaluate(() => {
      const bg = document.querySelector('nav a[href], header a[href]') as HTMLElement | null;
      bg?.focus();
      return !!bg && document.activeElement === bg;
    });
    expect(movedToBackground).toBe(false);
  });
});
