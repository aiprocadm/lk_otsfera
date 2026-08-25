import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Сторож шапки экрана (`У-73`, `У-120`, §15 CLAUDE.md — правило трёх вопросов).
 *
 * **Что было.** Сторож искал подзаголовок рядом с `<h1>` по исходнику — и
 * останавливался на первом попадании. Экран с двумя ветками (вкладка «Общие» и
 * вкладка «По заказам» у документов админа) проходил проверку, имея подзаголовок
 * только у одной: у второй заголовок стоял голым, а тест был зелёным.
 *
 * **Что стало (`У-120`).** Шапку рисует один компонент `PageHeader`, у которого
 * `subtitle` — обязательный проп. Значит, проверять надо не разметку, а
 * источник: экран обязан звать компонент и не имеет права рисовать `<h1>` мимо
 * него. «Каждый заголовок с подзаголовком» после этого держит уже компилятор, а
 * не текстовый поиск, — и не по первому вхождению, а по всем.
 */
const SRC = join(__dirname, '..');
const APP = join(SRC, 'app');
const CABINETS = ['admin', 'manager', 'leader', 'partner', 'organization', 'student'];

/**
 * Экраны вне кабинетов, у которых свой полноэкранный макет и своя типографика.
 * Шапка раздела им не подходит: это не разделы работы.
 */
const NO_SUBTITLE: Array<{ file: string; why: string }> = [
  {
    file: 'components/organization/org-order-header.tsx',
    why: 'Карточка заказа заказчика: под названием стоят номер, стадия и ответственный — выдуманная строка мешала бы',
  },
];

const OUTSIDE_CABINETS: Array<{ page: string; why: string }> = [
  { page: '/(auth)/login', why: 'Экран входа: свой макет на тёмном фоне, заголовок 4xl' },
  { page: '/forbidden', why: 'Заглушка «нет доступа»: центрированный блок с кодом 403' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'page.tsx') out.push(p);
  }
  return out;
}

/** '@/components/x' → путь к файлу, если он есть. */
function resolveAlias(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const base = join(SRC, spec.slice(2));
  for (const cand of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** Сам компонент шапки — не «экран, рисующий заголовок руками». */
const HEADER_COMPONENT = join(SRC, 'components', 'ui', 'page-header.tsx');

/** Страница + её компоненты на один уровень вглубь. */
function chainOf(page: string): string[] {
  const src = readFileSync(page, 'utf8');
  const files = [page];
  for (const m of src.matchAll(/from '(@\/[^']+)'/g)) {
    const f = resolveAlias(m[1] as string);
    if (f && f !== HEADER_COMPONENT && f.includes(`${sep}components${sep}`)) files.push(f);
  }
  return files;
}

/** Код без комментариев: в них `<h1>` упоминается как часть объяснения. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');
}

function routeOf(page: string): string {
  const parts = relative(APP, page)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !s.startsWith('('));
  return `/${parts.join('/')}`;
}

describe('шапку экрана рисует один компонент (У-120)', () => {
  const pages = walk(APP).filter((p) => {
    const parts = relative(APP, p)
      .split(sep)
      .slice(0, -1)
      .filter((s) => !s.startsWith('('));
    return parts.length > 0 && CABINETS.includes(parts[0] as string);
  });

  it('в кабинетах есть что проверять — путь до страниц не сломан', () => {
    expect(pages.length).toBeGreaterThan(100);
  });

  it('ни один экран кабинета не рисует заголовок мимо PageHeader', () => {
    const rogue: string[] = [];
    for (const page of pages) {
      for (const file of chainOf(page)) {
        if (/<h1[\s>]/.test(stripComments(readFileSync(file, 'utf8')))) {
          rogue.push(`${routeOf(page)} → ${relative(SRC, file).split(sep).join('/')}`);
        }
      }
    }
    expect([...new Set(rogue)], 'заголовок собран руками вместо <PageHeader>').toEqual([]);
  });

  it('экран с шапкой обязан объяснить себя: `subtitle` — обязательный проп', () => {
    // Компилятор не даст вызвать PageHeader без `subtitle`. Но `subtitle={null}`
    // остаётся законной дверью для карточки сущности — чтобы ею не пользовались
    // походя, каждая такая карточка записана здесь с причиной.
    const header = readFileSync(join(SRC, 'components/ui/page-header.tsx'), 'utf8');
    expect(header, 'проп subtitle перестал быть обязательным').toMatch(
      /subtitle: React\.ReactNode \| null;/
    );

    const used = new Set<string>();
    for (const page of pages) {
      for (const file of chainOf(page)) {
        if (/subtitle=\{null\}/.test(readFileSync(file, 'utf8'))) {
          used.add(relative(SRC, file).split(sep).join('/'));
        }
      }
    }
    const declared = new Set(NO_SUBTITLE.map((e) => e.file));
    expect(
      [...used].filter((f) => !declared.has(f)),
      'подзаголовок снят молча'
    ).toEqual([]);
    expect(
      [...declared].filter((f) => !used.has(f)),
      'запись устарела — подзаголовок есть'
    ).toEqual([]);
  });

  it('исключения — только экраны вне кабинетов, и у каждого записана причина', () => {
    for (const e of NO_SUBTITLE) {
      expect(e.why.length, `${e.file}: причина не записана`).toBeGreaterThan(20);
    }
    for (const e of OUTSIDE_CABINETS) {
      expect(e.why.length, `${e.page}: причина не записана`).toBeGreaterThan(20);
      // Исключение обязано быть настоящим: страница существует и лежит ВНЕ
      // кабинетов — иначе это лазейка «чтобы позеленело».
      expect(pages.map(routeOf)).not.toContain(e.page);
    }
  });
});
