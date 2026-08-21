import { test, expect, type Page } from '@playwright/test';
import { navByRole } from '@/lib/navigation/cabinet';
import { sectionsForCabinet, settingsHref, type SettingsCabinet } from '@/lib/navigation/settings';

/**
 * Правила, которым обязан отвечать КАЖДЫЙ экран кабинета:
 *
 * — `У-13`: помещаться в ширину телефона;
 * — `У-71`/`У-73` (§0 ТЗ, «правило трёх вопросов»): отвечать на «где я»
 *   заголовком и на «что здесь делают» — подзаголовком под ним.
 *
 * Это **правило, а не список**. Адреса берутся из того же реестра меню, по
 * которому рисуется навигация (`navByRole`) и из реестра разделов настроек —
 * значит, новый раздел попадает под проверку сам, без правки этого файла.
 * Урок `У-72` (крошки): «✅ по перечислению» не доказывает требование со
 * словом «все» — такое требование закрывается только правилом.
 *
 * Почему проверяем вживую, а не по исходникам: сторож подзаголовков
 * `pages.subtitles.guardrail` читает файлы и **пропускает страницу, в цепочке
 * которой не нашёл `<h1>`** («значит, шлюз-редирект»). Экран, у которого
 * заголовка нет вовсе, для него невидим — а для пользователя это ровно то
 * место, где непонятно, где он находится. Живой обход такие экраны видит.
 *
 * Почему проверяем ширину: когда содержимое шире экрана, Chrome на мобильном
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

/**
 * Клиентский редирект может случиться ПРЯМО во время замера — тогда Playwright
 * бросает «Execution context was destroyed». Это не сбой страницы, а гонка:
 * повторяем замер на новом адресе.
 */
async function measure<T>(page: Page, fn: () => T): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.evaluate(fn);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      // «Cannot read properties of null» = документ ещё не построен: та же гонка.
      if (
        attempt < 4 &&
        /Execution context was destroyed|Target closed|Cannot read properties of null/.test(text)
      ) {
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        continue;
      }
      throw e;
    }
  }
}

async function expectFitsPhone(page: Page, url: string): Promise<'проверено' | 'недоступно'> {
  const status = await gotoScreen(page, url);
  // Часть разделов — шлюзы: сервер отдаёт страницу, а React уже на клиенте
  // уводит на настоящий экран (`NEXT_REDIRECT` в разметке). Мерить надо ТО,
  // куда пользователь попал, иначе шлюз выглядит «экраном без заголовка».
  await page
    .waitForFunction(() => !document.querySelector('template[data-dgst*="NEXT_REDIRECT"]'), null, {
      timeout: 20_000,
    })
    .catch(() => undefined);
  // Документ после редиректа строится не мгновенно — ждём его, иначе замер
  // придётся на пустую страницу.
  await page
    .waitForFunction(() => !!document.documentElement && !!document.body, null, { timeout: 20_000 })
    .catch(() => undefined);
  const landed = () => new URL(page.url()).pathname;
  const closed = (p: string) => p === '/login' || p === '/forbidden';
  // Раздел за выключенным флагом или закрытый правами — не наш случай.
  if (status >= 400 || closed(landed())) return 'недоступно';
  // Сеть может не затихнуть из-за живых счётчиков — ждём, но не падаем на этом.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

  const { screenWidth, pageWidth, visualWidth } = await measure(page, () => ({
    screenWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    visualWidth: window.innerWidth,
  }));

  if (closed(landed())) return 'недоступно';

  expect
    .soft(
      pageWidth,
      `${url} шире экрана: ${pageWidth}px против ${screenWidth}px — браузер уменьшит страницу целиком`
    )
    .toBeLessThanOrEqual(screenWidth + 1);
  expect
    .soft(visualWidth, `${url}: браузер уменьшил страницу, чтобы она поместилась`)
    .toBeLessThanOrEqual(screenWidth + 1);

  const intro = await measure(page, () => {
    // Ищем по всей странице, а не внутри <main>: в кабинете заказчика экран
    // рисуется вне него. Каркас не мешает — в сайдбаре и панели только h2.
    const headings = Array.from(document.querySelectorAll('h1')).filter(
      (h) => (h.textContent ?? '').trim().length > 0
    );
    const h1 = headings[0];
    if (!h1) return { headings: 0, title: '', subtitle: null as string | null };
    // Подзаголовок по принятому в проекте виду: абзац мелким серым рядом с
    // заголовком — либо в том же блоке, либо следующим за ним.
    const scope = [h1.parentElement, h1.parentElement?.parentElement].filter(
      (el): el is HTMLElement => !!el
    );
    let subtitle: string | null = null;
    for (const box of scope) {
      const p = Array.from(box.querySelectorAll('p')).find(
        (el) =>
          (el.textContent ?? '').trim().length > 0 &&
          h1.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING &&
          parseFloat(getComputedStyle(el).fontSize) <= 16
      );
      if (p) {
        subtitle = (p.textContent ?? '').trim();
        break;
      }
    }
    return { headings: headings.length, title: (h1.textContent ?? '').trim(), subtitle };
  });

  // `У-72`/§0, вопрос «где я»: заголовок обязан быть, и ровно один.
  expect
    .soft(intro.headings, `${url}: нет заголовка экрана (<h1>) — непонятно, где пользователь`)
    .toBeGreaterThan(0);
  expect
    .soft(intro.headings, `${url}: заголовков экрана несколько (${intro.headings})`)
    .toBeLessThan(2);
  // Интерфейс русский (CLAUDE.md): заголовок из одних латинских букв — это
  // недоделанная заглушка, а не название раздела. Так на экране документов
  // админа полгода стояло «Admin · Documents».
  if (intro.headings > 0) {
    expect
      .soft(/[А-Яа-яЁё]/.test(intro.title), `${url}: заголовок «${intro.title}» не по-русски`)
      .toBe(true);
  }
  // §0, вопрос «что здесь делают»: строка-подзаголовок под заголовком.
  expect
    .soft(
      intro.subtitle,
      `${url} («${intro.title}»): нет подзаголовка «что здесь делают» (§0 ТЗ, CLAUDE.md §15)`
    )
    .not.toBeNull();
  return 'проверено';
}

/**
 * `extraUrls` — экраны вне реестра меню (деталки с id из seed-данных и
 * страницы, на которые попадают по ссылке, а не через меню).
 */
export function screenRuleChecks(
  cabinet: string,
  role: CabinetRole,
  options: { settingsCabinet?: SettingsCabinet; extraUrls?: string[] } = {}
): void {
  const urls = [...screenUrlsFor(role, options.settingsCabinet), ...(options.extraUrls ?? [])];

  test.describe(`Правила экранов (§0 и У-13): ${cabinet}`, () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 768, 'только мобильный вьюпорт');
    // Первый заход на маршрут в dev-режиме = его сборка; это не «зависание».
    test.describe.configure({ timeout: 120_000 });

    for (const url of urls) {
      test(`${url}`, async ({ page }) => {
        const verdict = await expectFitsPhone(page, url);
        // Пропуск не должен выглядеть как проверка: пишем его в отчёт.
        // Пропуск не должен выглядеть как пройденная проверка: помечаем тест
        // пропущенным — тогда он виден в итоге прогона отдельным счётчиком,
        // а причина стоит рядом.
        test.skip(verdict === 'недоступно', `${url}: раздел закрыт этой роли или выключен флагом`);
      });
    }
  });
}
