import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { navByRole } from '@/lib/navigation/cabinet';

/**
 * Страж «пункт меню = заголовок страницы» (`У-106`).
 *
 * Человек кликает «Комиссионные отчёты», попадает на экран с заголовком
 * «Комиссии» — и не уверен, туда ли он пришёл. Ссылаться на такой экран в
 * разговоре с коллегой тоже нельзя: у вас он называется иначе.
 *
 * Проверяются только **буквальные** заголовки: `<h1 …>Текст</h1>`. Заголовок,
 * собранный из данных (имя клиента, номер заказа), проверять нечем — это
 * карточка сущности, а не раздел, и у неё своё правило (`У-73`).
 */
const SRC = join(__dirname, '..');
const APP = join(SRC, 'app');

/**
 * Разделы, у которых заголовок осознанно не равен пункту меню, — с причиной.
 * Пусто: сегодня таких нет. Добавлять сюда можно только осознанно.
 */
const EXEMPT: Array<{ href: string; why: string }> = [];

function pageFile(href: string): string | null {
  const direct = join(APP, href.replace(/^\//, ''), 'page.tsx');
  return existsSync(direct) ? direct : null;
}

/** Страница + её компоненты на один уровень вглубь: H1 часто живёт в шелле. */
function chain(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out = [src];
  for (const m of src.matchAll(/from '(@\/components\/[^']+)'/g)) {
    const base = join(SRC, (m[1] as string).slice('@/'.length));
    for (const cand of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx')]) {
      if (existsSync(cand)) {
        out.push(readFileSync(cand, 'utf8'));
        break;
      }
    }
  }
  return out;
}

/** Буквальные заголовки страницы: `<h1 ...>Текст</h1>` без выражений внутри. */
function literalTitles(sources: string[]): string[] {
  const titles: string[] = [];
  for (const src of sources) {
    for (const m of src.matchAll(/<h1[^>]*>([^<{}]+)<\/h1>/g)) {
      const text = (m[1] as string).replace(/\s+/g, ' ').trim();
      if (text) titles.push(text);
    }
  }
  return titles;
}

describe('заголовок страницы равен пункту меню (У-106)', () => {
  // У одного адреса может быть НЕСКОЛЬКО названий, и это законно: пункт-мост
  // из соседнего кабинета называется по кабинету («Кабинет руководителя»), а
  // свой раздел — по себе («Главная»). Поэтому собираем все названия адреса и
  // принимаем любое из них.
  const labelsByHref = new Map<string, Set<string>>();
  for (const item of Object.values(navByRole).flat()) {
    labelsByHref.set(item.href, new Set([...(labelsByHref.get(item.href) ?? []), item.label]));
  }
  const items = [...labelsByHref.entries()].map(([href, labels]) => ({ href, labels }));

  it('страницы разделов найдены — тест не проходит вхолостую', () => {
    const withPage = items.filter((i) => pageFile(i.href));
    expect(withPage.length).toBeGreaterThan(30);
  });

  it('ни один раздел не назван на экране иначе, чем в меню', () => {
    const exempt = new Set(EXEMPT.map((e) => e.href));
    const broken: string[] = [];

    for (const item of items) {
      if (exempt.has(item.href)) continue;
      const file = pageFile(item.href);
      if (!file) continue; // раздел-мост в чужой кабинет: своей страницы нет

      const titles = literalTitles(chain(file));
      if (titles.length === 0) continue; // заголовок собирается из данных
      if (titles.some((t) => item.labels.has(t))) continue;

      broken.push(
        `${item.href}: меню «${[...item.labels].join('» / «')}», экран «${titles.join('» / «')}»`
      );
    }

    expect(
      broken,
      'пункт меню и заголовок экрана называют раздел по-разному (У-106)'
    ).toEqual([]);
  });

  it('исключения объявлены с причиной, а не пустой строкой', () => {
    for (const e of EXEMPT) expect(e.why.trim().length).toBeGreaterThan(10);
  });
});

/** Служебное: путь до `src` в тесте собран правильно (иначе он проверял бы пустоту). */
it('корень исходников найден', () => {
  expect(existsSync(join(APP, 'admin'))).toBe(true);
  expect(APP.endsWith(`${sep}app`)).toBe(true);
});
