import { test, expect, type Page } from '@playwright/test';
import { navByRole } from '@/lib/navigation/cabinet';
import { sectionsForCabinet, settingsHref, type SettingsCabinet } from '@/lib/navigation/settings';

/**
 * `У-13`: экран кабинета обязан помещаться в ширину телефона.
 *
 * Это **правило, а не список**. Адреса берутся из того же реестра меню, по
 * которому рисуется навигация (`navByRole`) и из реестра разделов настроек —
 * значит, новый раздел попадает под проверку сам, без правки этого файла.
 * Урок `У-72` (крошки): «✅ по перечислению» не доказывает требование со
 * словом «все» — такое требование закрывается только правилом.
 *
 * Почему именно ширина: когда содержимое шире экрана, Chrome на мобильном
 * вьюпорте уменьшает страницу целиком (visual viewport становится шире
 * layout-вьюпорта). Буквы мельчают, а координаты нажатий уезжают — так
 * «Ещё» в нижней панели переставала нажиматься (найдено 20.08.2026).
 */
export type CabinetRole = keyof typeof navByRole;

/** Адреса всех статических экранов кабинета — из реестров, а не из списка. */
export function screenUrlsFor(role: CabinetRole, settingsCabinet?: SettingsCabinet): string[] {
  const fromMenu = navByRole[role]
    .filter((i) => !i.disabled)
    .map((i) => i.href)
    // Динамические маршруты (деталки) в меню не живут, но фильтр оставлен
    // намеренно: он защищает от «а вдруг положат» — [id] не открыть без данных.
    .filter((href) => href.startsWith('/') && !href.includes('['));
  const fromSettings = settingsCabinet
    ? sectionsForCabinet(settingsCabinet).map((s) => settingsHref(s, settingsCabinet))
    : [];
  return [...new Set([...fromMenu, ...fromSettings])];
}

/**
 * Переход с двумя поправками на реальность:
 * — dev-сервер компилирует маршрут при первом заходе, поэтому 30 секунд по
 *   умолчанию не хватает (страница не «висит», она собирается);
 * — устаревшие адреса редиректят на хаб настроек, и `goto` может прилететь
 *   `ERR_ABORTED: frame was detached` — это успешный редирект, а не ошибка.
 */
async function gotoScreen(page: Page, url: string): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      return res?.status() ?? 0;
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (attempt < 3 && /ERR_ABORTED|frame was detached/.test(text)) {
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        continue;
      }
      throw e;
    }
  }
}

async function expectFitsPhone(page: Page, url: string): Promise<'проверено' | 'недоступно'> {
  const status = await gotoScreen(page, url);
  const landed = new URL(page.url()).pathname;
  // Раздел за выключенным флагом или закрытый правами — не наш случай.
  if (status >= 400 || landed === '/login' || landed === '/forbidden') return 'недоступно';
  // Сеть может не затихнуть из-за живых счётчиков — ждём, но не падаем на этом.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

  const { screenWidth, pageWidth, visualWidth } = await page.evaluate(() => ({
    screenWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    visualWidth: window.innerWidth,
  }));

  expect(
    pageWidth,
    `${url} шире экрана: ${pageWidth}px против ${screenWidth}px — браузер уменьшит страницу целиком`
  ).toBeLessThanOrEqual(screenWidth + 1);
  expect(
    visualWidth,
    `${url}: браузер уменьшил страницу, чтобы она поместилась`
  ).toBeLessThanOrEqual(screenWidth + 1);
  return 'проверено';
}

/**
 * `extraUrls` — экраны вне реестра меню (деталки с id из seed-данных и
 * страницы, на которые попадают по ссылке, а не через меню).
 */
export function mobileWidthChecks(
  cabinet: string,
  role: CabinetRole,
  options: { settingsCabinet?: SettingsCabinet; extraUrls?: string[] } = {}
): void {
  const urls = [...screenUrlsFor(role, options.settingsCabinet), ...(options.extraUrls ?? [])];

  test.describe(`Ширина экранов на телефоне: ${cabinet}`, () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 768, 'только мобильный вьюпорт');
    // Первый заход на маршрут в dev-режиме = его сборка; это не «зависание».
    test.describe.configure({ timeout: 120_000 });

    for (const url of urls) {
      test(`не шире экрана: ${url}`, async ({ page }) => {
        const verdict = await expectFitsPhone(page, url);
        // Пропуск не должен выглядеть как проверка: пишем его в отчёт.
        if (verdict === 'недоступно')
          test.info().annotations.push({ type: 'пропущен', description: url });
      });
    }
  });
}
