import { test, expect, type Page } from '@playwright/test';

/**
 * Общая проверка мобильного каркаса (`У-19`, этап 3 ТЗ понятности).
 *
 * Это **функциональный** тест, а не снимок: он не зависит от эталонных
 * картинок, поэтому не краснеет от каждой правки вёрстки. Проверяем ровно то,
 * что требует `У-19`: сайдбар скрыт, нижняя панель видна, бургер открывает меню.
 *
 * Один и тот же набор для всех шести кабинетов — отличается только адрес
 * главной страницы. Файлы-обёртки нужны из-за префиксов `testMatch` в
 * `playwright.config.ts` (кабинет выбирается именем файла, а не параметром).
 */
export function mobileShellChecks(cabinet: string, homeUrl: string, alsoWide: string[] = []) {
  test.describe(`Мобильный каркас: ${cabinet}`, () => {
    // На десктопных проектах этот файл тоже подхватывается — там проверять нечего.
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 768, 'только мобильный вьюпорт');

    test('сайдбар скрыт, нижняя панель видна, бургер открывает меню', async ({ page }) => {
      await page.goto(homeUrl);

      // У-13: колонка-сайдбар на телефоне не занимает половину экрана.
      const sidebar = page.locator('nav[data-variant="desktop"]');
      await expect(sidebar).toBeHidden();

      // У-15: нижняя панель есть в каждом кабинете.
      const bottomBar = page.getByTestId('mobile-bottom-bar');
      await expect(bottomBar).toBeVisible();
      await expect(bottomBar.getByTestId('mobile-tab-more')).toBeVisible();

      // У-14: бургер открывает панель с полным меню и закрывается по Escape.
      await page.getByTestId('mobile-burger').click();
      const panel = page.getByTestId('mobile-menu-panel');
      await expect(panel).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    });

    // `У-13`/`У-17`: экран кабинета обязан помещаться в ширину телефона.
    // Страж именно на расхождение: когда содержимое шире экрана, Chrome на
    // мобильном вьюпорте уменьшает всю страницу (visual viewport становится
    // шире layout-вьюпорта), текст мельчает, а координаты нажатий уезжают —
    // из-за этого «Ещё» в нижней панели переставала нажиматься.
    for (const url of [homeUrl, ...alsoWide]) {
      test(`страница не шире экрана телефона: ${url}`, async ({ page }: { page: Page }) => {
        await page.goto(url);
        await page.waitForLoadState('networkidle');

        const { screenWidth, pageWidth, visualWidth } = await page.evaluate(() => ({
          screenWidth: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          visualWidth: window.innerWidth,
        }));

        expect(
          pageWidth,
          `${url} шире экрана: ${pageWidth}px против ${screenWidth}px — браузер уменьшит страницу целиком`
        ).toBeLessThanOrEqual(screenWidth + 1);
        expect(visualWidth, 'браузер уменьшил страницу, чтобы она поместилась').toBeLessThanOrEqual(
          screenWidth + 1
        );
      });
    }

    test('«Ещё» в нижней панели открывает то же меню', async ({ page }: { page: Page }) => {
      await page.goto(homeUrl);

      await page.getByTestId('mobile-tab-more').click();
      await expect(page.getByTestId('mobile-menu-panel')).toBeVisible();
    });
  });
}
