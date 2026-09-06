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

/**
 * Открыть модалку и дождаться, что фокус уехал внутрь.
 *
 * Почему с повтором. Кнопка приходит с сервера уже в разметке, но обработчик
 * на ней появляется только после гидратации: до неё и клик, и Enter уходят в
 * никуда — Playwright считает элемент «готовым» (виден, стабилен, принимает
 * события), а React ещё не подписался. Диалог не открывается, повторить
 * нажатие некому, и тест падает на `toBeFocused` — «element(s) not found».
 *
 * Так этот файл дважды подряд ронял полный прогон сопровождения (06.09.2026:
 * прогон №4 — `org-desktop`, прогон №5 — `mobile-organization`), каждый раз
 * зеленея на `--last-failed`. Дефекта в модалке не было ни разу: гонка старта.
 *
 * `expect(...).toPass()` повторяет всю связку «нажать → проверить фокус», пока
 * страница не оживёт. Настоящую поломку это не прячет: если фокус не уходит в
 * поле или не возвращается на кнопку, повторы просто исчерпают таймаут и тест
 * останется красным (проверено мутацией, хотфикс №13).
 */
async function openModal(page: Page, how: 'click' | 'keyboard') {
  await expect(async () => {
    if (how === 'click') {
      await page.locator(TRIGGER).click();
    } else {
      await page.locator(TRIGGER).focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.locator(EMAIL_INPUT)).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test.describe('invite-org-user-form: focus management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/organization/team');
    await page.waitForLoadState('networkidle');
    // Кнопка на месте — дальше её оживление ждёт openModal.
    await expect(page.locator(TRIGGER)).toBeVisible();
  });

  test('initial focus moves into modal on open', async ({ page }) => {
    await openModal(page, 'click');
  });

  test('Tab from the last control never reaches a background control', async ({ page }) => {
    await openModal(page, 'click');
    await page.locator(SUBMIT).focus();
    await page.keyboard.press('Tab');
    expect(await escapedToBackground(page)).toBe(false);
  });

  test('Shift+Tab from the first control never reaches a background control', async ({ page }) => {
    await openModal(page, 'click');
    await page.locator(CLOSE_X).focus();
    await page.keyboard.press('Shift+Tab');
    expect(await escapedToBackground(page)).toBe(false);
  });

  test('focus restores to trigger after Escape', async ({ page }) => {
    await openModal(page, 'keyboard');
    await page.keyboard.press('Escape');
    await expect(page.locator(TRIGGER)).toBeFocused();
  });

  test('background is inert while the modal is open', async ({ page }) => {
    await openModal(page, 'click');

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
