import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Сторож подзаголовков (`У-73`, §15 CLAUDE.md — правило трёх вопросов).
 *
 * Первый проход этапа 9 добавил подзаголовок на 31 экран — но только там, где
 * заголовок лежал в самом `page.tsx`. Приёмка `У-77` нашла ещё четыре экрана,
 * где заголовок живёт в клиентском компоненте: сканирование «по страницам» их
 * не видело. Отсюда правило: проверять **цепочку** «страница + её компоненты».
 *
 * Экран без ответа на вопрос «что здесь делают» — дефект приёмки, а не
 * косметика. Тест держит границу автоматически.
 */
const SRC = join(__dirname, '..');
const APP = join(SRC, 'app');
const CABINETS = ['admin', 'manager', 'leader', 'partner', 'organization', 'student'];

/**
 * Карточки сущностей — подзаголовка не имеют **намеренно** (решение `У-73`):
 * под именем человека или номером заказа стоят его же реквизиты, и они
 * отвечают на «что здесь» лучше выдуманной строки. Все они — динамические
 * маршруты; список держим явным, чтобы новый статический раздел сюда не
 * просочился.
 */
const ENTITY_CARDS = [
  // `У-97`/`У-100`: `/manager/students/[id]` и `/organization/students/[id]`
  // стали шлюзами — своего экрана у них нет, и в списке им больше не место.
  '/organization/orders/[id]',
  '/organization/requests/[id]',
  '/partner/deals/[id]',
  '/partner/portfolio/[orgId]',
  '/partner/portfolio/[orgId]/documents',
  '/partner/portfolio/[orgId]/settings',
  '/partner/requests/[id]',
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

/** Страница + её компоненты на один уровень вглубь. */
function chainOf(page: string): string[] {
  const src = readFileSync(page, 'utf8');
  const files = [page];
  for (const m of src.matchAll(/from '(@\/[^']+)'/g)) {
    const f = resolveAlias(m[1] as string);
    if (f && f.includes(`${sep}components${sep}`)) files.push(f);
  }
  return files;
}

/** Абзац мелким серым сразу под заголовком (между ними бывает комментарий). */
function hasSubtitle(src: string): boolean {
  for (const m of src.matchAll(/<\/h1>/g)) {
    const window = src.slice((m.index ?? 0) + 5, (m.index ?? 0) + 405);
    if (/<p[^>]*className="[^"]*text-sm[^"]*text-gray-(400|500|600)/.test(window)) return true;
  }
  return false;
}

function routeOf(page: string): string {
  const parts = relative(APP, page)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !s.startsWith('('));
  return `/${parts.join('/')}`;
}

describe('у каждого раздела есть подзаголовок «что здесь делают» (У-73)', () => {
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

  it('ни один экран с заголовком не остался без подзаголовка', () => {
    const gaps: string[] = [];
    for (const page of pages) {
      const chain = chainOf(page).map((f) => readFileSync(f, 'utf8'));
      if (!chain.some((s) => s.includes('<h1'))) continue; // шлюз-редирект без своего экрана
      if (chain.some(hasSubtitle)) continue;
      const route = routeOf(page);
      if (ENTITY_CARDS.includes(route)) continue;
      gaps.push(route);
    }
    expect(gaps, 'экраны без ответа на вопрос «что здесь делают» (§15)').toEqual([]);
  });

  it('список исключений не разрастается статическими разделами', () => {
    // Исключение оправдано только для карточки сущности: её имя приходит из
    // базы. Статический раздел обязан объяснить себя словами.
    for (const route of ENTITY_CARDS) {
      expect(route, `${route}: не карточка сущности — подзаголовок обязателен`).toMatch(/\[\w+\]/);
    }
  });
});
