import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import NotFound from '@/app/not-found';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { REMOVED_PATHS } from '@/lib/navigation/removedPaths';
import { stripComments } from '@/lib/acceptance/screenRules';
import { readSource } from './helpers/source';

/**
 * `У-263` — шлюзов старых адресов больше нет, и новые не появляются.
 *
 * **Что было.** Раздел переезжал, а старый адрес оставался «шлюзом» — пустой
 * страницей, которая уводила на новое место. Этот страж считал возраст шлюзов
 * и краснел после 90 дней. 23.09.2026 заказчик решил срок не ждать: шлюзы
 * удалены (прогон сопровождения №37), старый адрес отвечает общей страницей
 * 404 «раздел переехал» с кнопкой в кабинет.
 *
 * **Что сторожим теперь.**
 * 1. Реестров шлюзов нет — ни кабинетного, ни поля `legacyHrefs` в хабе
 *    «Настройки», ни HTTP-редиректов в `next.config.mjs`.
 * 2. Удалённый адрес не стал страницей снова (переезд обратно — новое
 *    решение, а не «вернули шлюз»).
 * 3. Новых шлюзов нет. Удаление нашло пять шлюзов, которые не стояли ни в
 *    одном реестре, — страж срока их не видел, и они остались бы навсегда.
 *    Поэтому признак теперь не реестр, а сам файл: страница, которая ничего
 *    не рисует, а только уводит. Такие допустимы лишь из явного списка ниже.
 * 4. Страница 404 объясняет переезд и ведёт в кабинет.
 */
const SRC = join(process.cwd(), 'src');
const APP = join(SRC, 'app');

/**
 * Страницы, которые только уводят, — и почему это не шлюз. Ключ — путь от
 * `src/app` с `/`.
 */
const REDIRECT_ONLY_ALLOWED: Record<string, string> = {
  'page.tsx': 'корень сайта: своего экрана нет, человека встречает вход',
  'manager/exchange/page.tsx':
    'корень раздела «Обмен с 1С» открывает первую вкладку — адрес раздела живой и стоит в меню',
};

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (name === 'page.tsx') out.push(full);
  }
  return out;
}

/** Страница ничего не рисует и только уводит — признак шлюза. */
function isRedirectOnly(source: string): boolean {
  const code = stripComments(source);
  const rendersSomething = /<[A-Za-z]/.test(code);
  const redirects = /\b(?:permanentRedirect|redirect|redirectToSettingsHub)\(/.test(code);
  return redirects && !rendersSomething;
}

const rel = (p: string) => relative(APP, p).split(sep).join('/');

describe('шлюзов старых адресов нет (У-263)', () => {
  it('реестров шлюзов нет: ни файлов, ни поля в хабе «Настройки»', () => {
    for (const gone of ['legacyGateways.ts', 'settingsRedirect.ts']) {
      expect(existsSync(join(SRC, 'lib', 'navigation', gone)), gone).toBe(false);
    }
    const withLegacy = SETTINGS_SECTIONS.filter((s) => 'legacyHrefs' in s).map((s) => s.id);
    expect(withLegacy, 'раздел хаба снова объявляет старые адреса').toEqual([]);
  });

  it('в next.config.mjs нет HTTP-редиректов со старых адресов', () => {
    const config = stripComments(readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8'));
    expect(config).not.toMatch(/\bredirects\s*\(/);
  });

  it('ни один удалённый адрес снова не стал страницей', () => {
    const back = REMOVED_PATHS.map((r) => r.path).filter((path) =>
      existsSync(join(APP, ...path.split('/').filter(Boolean)))
    );
    expect(
      back,
      'Удалённый адрес снова существует. Если раздел действительно возвращается\n' +
        'сюда — уберите адрес из `lib/navigation/removedPaths.ts` и опишите решение;\n' +
        'если это новый шлюз — удалите его: ссылки ведите сразу на новое место.'
    ).toEqual([]);
  });

  it('признак шлюза узнаёт шлюз и не путает его с экраном', () => {
    // Проверка самого признака: без неё легко написать страж, который не
    // совпадёт ни с одним файлом и будет вечно зелёным.
    expect(isRedirectOnly(`export default function P() { redirect('/x'); }`)).toBe(true);
    expect(isRedirectOnly(`export default function P() { permanentRedirect('/x'); }`)).toBe(true);
    expect(
      isRedirectOnly(`export default function P() { if (!ok) redirect('/x'); return <Screen />; }`)
    ).toBe(false);
    expect(isRedirectOnly(`export default function P() { return <Screen />; }`)).toBe(false);
  });

  it('новых шлюзов нет: страница «только увести» — лишь из явного списка', () => {
    const found = pages(APP)
      .filter((p) => isRedirectOnly(readSource(p)))
      .map(rel)
      .sort();
    const unexpected = found.filter((p) => !(p in REDIRECT_ONLY_ALLOWED));
    const stale = Object.keys(REDIRECT_ONLY_ALLOWED).filter((p) => !found.includes(p));
    expect(
      unexpected,
      'Эти страницы ничего не рисуют и только уводят — это шлюз старого адреса.\n' +
        'Шлюзы удалены решением заказчика 23.09.2026 (`У-263`): ведите ссылки сразу\n' +
        'на новое место, а старый адрес пусть отвечает 404 «раздел переехал».'
    ).toEqual([]);
    expect(stale, 'в списке разрешённых есть страница, которой больше нет').toEqual([]);
  });

  it('страница 404 говорит, что раздел мог переехать, и ведёт в кабинет', () => {
    const html = renderToStaticMarkup(NotFound());
    expect(html).toContain('Страница не найдена');
    expect(html).toContain('раздел переехал');
    // `/dashboard` middleware отправляет каждую роль на её главную.
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('В кабинет');
  });
});
