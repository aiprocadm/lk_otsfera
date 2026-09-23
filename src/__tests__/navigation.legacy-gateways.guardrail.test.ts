import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import NotFound from '@/app/not-found';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { isRemovedPath } from '@/lib/navigation/removedPaths';
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
 *    решение, а не «вернули шлюз»). Адрес считается по файлу страницы, а не
 *    по папке: группа `(x)` в адрес не входит и шлюз в ней не спрячешь.
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

/** Страница экрана. */
const PAGE_FILE = /^page\.[jt]sx?$/;
/** Всё, что отвечает на адрес: страница или обработчик маршрута. */
const ENDPOINT_FILE = /^(?:page|route)\.[jt]sx?$/;

function files(dir: string, name: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, name, out);
    else if (name.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Начало разметки JSX: `<` с буквой или `<>` там, где начинается выражение, —
 * после `return`, `=>`, `=`, `(`, `,`, `?`, `:`, `&&`, `||`, `{`, `[`.
 *
 * Прежний признак «любое `<Буква`» считал разметкой и типы: страница-шлюз с
 * `{ params: Promise<Record<string, string>> }` выглядела «рисующей экран» и
 * проходила мимо стража (замечание проверки, прогон сопровождения №37). Перед
 * угловой скобкой типа всегда стоит имя (`Promise<`, `Record<`, `useState<`),
 * а перед разметкой — знак или `return`.
 */
const JSX_START = /(?:\breturn|=>|[=(,?:&|{[])\s*<(?:[A-Za-z]|>)/;

/** Страница ничего не рисует и только уводит — признак шлюза. */
function isRedirectOnly(source: string): boolean {
  const code = stripComments(source);
  const redirects = /\b(?:permanentRedirect|redirect|redirectToSettingsHub)\(/.test(code);
  return redirects && !JSX_START.test(code);
}

const rel = (p: string) => relative(APP, p).split(sep).join('/');

/**
 * Адрес, на который отвечает файл: путь от `src/app` без имени файла, без
 * групп `(x)` и слотов `@x` — они в адрес не входят. Прежняя проверка искала
 * папку `src/app/<адрес>` и не видела шлюз, спрятанный в группу:
 * `partner/(old)/team/page.tsx` отвечает на удалённый `/partner/team`
 * (замечание проверки, прогон сопровождения №37).
 */
function routeOf(relFile: string): string {
  const segments = relFile
    .split('/')
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return `/${segments.join('/')}`;
}

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

  it('адрес файла строится без групп и слотов', () => {
    // Проверка самого построения адреса: без групп страж снова ослепнет.
    expect(routeOf('page.tsx')).toBe('/');
    expect(routeOf('partner/(old)/team/page.tsx')).toBe('/partner/team');
    expect(routeOf('(auth)/login/page.tsx')).toBe('/login');
    expect(routeOf('admin/@modal/(group)/audit/route.ts')).toBe('/admin/audit');
    expect(routeOf('partner/deals/[id]/page.tsx')).toBe('/partner/deals/[id]');
    expect(isRemovedPath(routeOf('partner/(old)/team/page.tsx'))).toBe(true);
    expect(isRemovedPath(routeOf('partner/deals/[id]/page.tsx'))).toBe(true);
  });

  it('ни один удалённый адрес снова не стал страницей', () => {
    const back = files(APP, ENDPOINT_FILE)
      .map(rel)
      .filter((f) => isRemovedPath(routeOf(f)))
      .sort();
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
    // Типы с угловыми скобками — не разметка: так объявлены параметры в
    // десятках страниц, и шлюз с ними обязан узнаваться.
    expect(
      isRedirectOnly(
        `export default async function P({ params }: { params: Promise<Record<string, string>> }) {
          await params;
          permanentRedirect('/partner/settings?tab=team');
        }`
      )
    ).toBe(true);
    expect(
      isRedirectOnly(
        `type SP = Promise<{ tab?: string }>;
        export default async function P(props: { searchParams: SP }) {
          const q = new Map<string, Array<number>>();
          redirect(\`/x?n=\${q.size}\`);
        }`
      )
    ).toBe(true);
    expect(
      isRedirectOnly(`export default function P() { if (!ok) redirect('/x'); return <Screen />; }`)
    ).toBe(false);
    expect(isRedirectOnly(`export default function P() { return <Screen />; }`)).toBe(false);
    expect(
      isRedirectOnly(
        `export default function P() {\n  redirect('/x');\n  return (\n    <Screen />\n  );\n}`
      )
    ).toBe(false);
    expect(
      isRedirectOnly(`export default function P() { redirect('/x'); return ok ? <A /> : null; }`)
    ).toBe(false);
    expect(isRedirectOnly(`export const P = () => { redirect('/x'); return <></>; };`)).toBe(false);
    expect(isRedirectOnly(`export const P = () => <Screen />; redirect('/x');`)).toBe(false);
  });

  it('новых шлюзов нет: страница «только увести» — лишь из явного списка', () => {
    const found = files(APP, PAGE_FILE)
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
