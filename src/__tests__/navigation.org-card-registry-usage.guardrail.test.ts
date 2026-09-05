import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ORG_CARD_TABS, type OrgCardCabinet } from '@/lib/navigation/orgCardTabs';

/**
 * `У-95`/`У-96` (этап 9, PR-1): реестр вкладок — один на все кабинеты, но
 * реестр ничего не гарантирует, пока страница кабинета его не зовёт. Так и
 * случилось с администратором: в реестре кабинет `admin` был с этапа 2, а
 * его страница оставалась плоским набором секций (`⚠` AUDIT от 30.08.2026)
 * — страж реестра молчал, потому что проверял реестр, а не его применение.
 *
 * Этот страж держит другую половину: у каждого кабинета из реестра есть
 * страница карточки организации, и она строит экран через `orgCardTabsFor`
 * своего кабинета и общий `OrgCardTabs`. Текстовый (grep по исходнику) —
 * проверен мутацией: подменить кабинет в вызове у админа → падает;
 * упоминание в комментарии за вызов не считается.
 */
const ROOT = process.cwd();

/** Страница карточки организации в каждом кабинете реестра. */
const ORG_CARD_PAGES: Record<OrgCardCabinet, string> = {
  admin: 'src/app/admin/organizations/[id]/page.tsx',
  leader: 'src/app/leader/organizations/[id]/page.tsx',
  manager: 'src/app/manager/organizations/[id]/page.tsx',
  partner: 'src/app/partner/portfolio/[orgId]/page.tsx',
  organization: 'src/app/organization/company/page.tsx',
};

/** Исходник без комментариев: упоминание в docstring — не вызов. */
const read = (rel: string) =>
  readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Вызов с аргументами, а не любое упоминание имени. */
const callOf = (cabinet: string) => `orgCardTabsFor('${cabinet}', {`;

describe('реестр вкладок применяется каждым кабинетом (У-95, У-96)', () => {
  const cabinets = [...new Set(ORG_CARD_TABS.flatMap((t) => t.cabinets))];

  it('у каждого кабинета из реестра есть страница карточки в карте стража', () => {
    for (const cabinet of cabinets) {
      expect(ORG_CARD_PAGES[cabinet], `кабинет ${cabinet} без страницы карточки`).toBeTruthy();
    }
    expect(cabinets.length).toBeGreaterThanOrEqual(5);
  });

  it.each(cabinets)(
    '%s: страница зовёт orgCardTabsFor своего кабинета и OrgCardTabs',
    (cabinet) => {
      const src = read(ORG_CARD_PAGES[cabinet]);
      expect(src, `${cabinet}: нет orgCardTabsFor('${cabinet}'`).toContain(
        `orgCardTabsFor('${cabinet}'`
      );
      expect(src, `${cabinet}: нет <OrgCardTabs`).toContain('<OrgCardTabs');
    }
  );

  it('ни одна страница не строит карточку под чужой кабинет', () => {
    for (const cabinet of cabinets) {
      const src = read(ORG_CARD_PAGES[cabinet]);
      for (const other of cabinets) {
        if (other === cabinet) continue;
        expect(src, `${cabinet}: зовёт orgCardTabsFor('${other}', …)`).not.toContain(callOf(other));
      }
    }
  });
});
