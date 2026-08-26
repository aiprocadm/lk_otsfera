import { describe, it, expect } from 'vitest';
import { navByRole, type NavItem } from '@/lib/navigation/cabinet';
import { groupNavItems, splitPinnedItems } from '@/lib/navigation/groupItems';
import {
  MIRROR_EXCEPTIONS,
  MIRROR_PAIRS,
  type MirrorPair,
} from '@/lib/navigation/mirrorExceptions';
import { SECTIONS, type SectionKey } from '@/lib/navigation/sectionLabels';

/**
 * Страж правила зеркала (`У-121`, §0.2 действующего ТЗ).
 *
 * Правило: кабинеты сотрудников учебного центра зеркальны между собой,
 * кабинеты клиентов — между собой. Один объект называется одинаково, стоит на
 * одном месте, носит один значок, лежит в одной группе. Различаться могут
 * объём данных и права.
 *
 * Проверяем не картинку, а **источник** — реестр меню, из которого и картинка,
 * и крошки, и панель телефона. Незаписанное расхождение роняет сборку;
 * записанное живёт в `mirrorExceptions.ts` с причиной.
 */

/** Меню роли в том виде, в каком его РИСУЕТ сайдбар: группы по реестру, закреплённые внизу. */
function renderedOrder(role: string): SectionKey[] {
  const all = navByRole[role as keyof typeof navByRole] as NavItem[];
  const { items, pinned } = splitPinnedItems(all);
  return [
    ...groupNavItems(items).flatMap((g) => g.items.map((i) => i.sectionKey)),
    ...pinned.map((i) => i.sectionKey),
  ];
}

function itemOf(role: string, key: SectionKey): NavItem | undefined {
  return (navByRole[role as keyof typeof navByRole] as NavItem[]).find((i) => i.sectionKey === key);
}

/** Разрешено ли расхождение по наличию: раздел есть ровно у перечисленных кабинетов. */
function allowedPresence(pair: MirrorPair, key: SectionKey, present: string[]): boolean {
  const rule = MIRROR_EXCEPTIONS.find((e) => e.pair === pair && e.sectionKey === key);
  if (!rule) return false;
  return rule.cabinets.length === present.length && rule.cabinets.every((c) => present.includes(c));
}

describe('правило зеркала: кабинеты пары устроены одинаково (У-121)', () => {
  for (const [pair, roles] of Object.entries(MIRROR_PAIRS) as Array<[MirrorPair, string[]]>) {
    describe(pair, () => {
      it('раздел есть либо у всех кабинетов пары, либо записан в исключения с причиной', () => {
        const byRole = new Map(roles.map((r) => [r, renderedOrder(r)]));
        const allKeys = new Set(roles.flatMap((r) => byRole.get(r) ?? []));
        const unexplained: string[] = [];
        for (const key of allKeys) {
          const present = roles.filter((r) => byRole.get(r)?.includes(key));
          if (present.length === roles.length) continue;
          if (allowedPresence(pair, key, present)) continue;
          unexplained.push(`${key}: есть у ${present.join(', ')} — исключения нет`);
        }
        expect(
          unexplained,
          'Раздел есть в одном кабинете пары и отсутствует в другом. Либо выровняйте, ' +
            'либо запишите в mirrorExceptions.ts с причиной:\n' +
            unexplained.join('\n')
        ).toEqual([]);
      });

      it('общие разделы идут в одном порядке', () => {
        const byRole = new Map(roles.map((r) => [r, renderedOrder(r)]));
        const first = roles[0]!;
        const shared = (byRole.get(first) ?? []).filter((k) =>
          roles.every((r) => byRole.get(r)?.includes(k))
        );
        const sequences = roles.map((r) => ({
          role: r,
          seq: (byRole.get(r) ?? []).filter((k) => shared.includes(k)),
        }));
        for (const s of sequences) {
          expect(
            s.seq,
            `Порядок разделов в кабинете «${s.role}» отличается от «${first}». ` +
              'Один объект — одно место (§0.2).'
          ).toEqual(shared);
        }
      });

      it('общий раздел лежит в одной группе и закреплён одинаково', () => {
        const first = roles[0]!;
        const mismatched: string[] = [];
        for (const key of renderedOrder(first)) {
          const items = roles.map((r) => ({ role: r, item: itemOf(r, key) }));
          if (items.some((x) => !x.item)) continue;
          const groups = new Set(items.map((x) => x.item?.group ?? ''));
          const pinned = new Set(items.map((x) => Boolean(x.item?.pinnedBottom)));
          if (groups.size > 1) {
            mismatched.push(
              `${key}: группы — ${items.map((x) => `${x.role}=${x.item?.group ?? '—'}`).join(', ')}`
            );
          }
          if (pinned.size > 1) {
            mismatched.push(
              `${key}: закрепление внизу — ${items
                .map((x) => `${x.role}=${x.item?.pinnedBottom ? 'да' : 'нет'}`)
                .join(', ')}`
            );
          }
        }
        expect(mismatched, mismatched.join('\n')).toEqual([]);
      });

      it('общий раздел называется одинаково и носит один значок', () => {
        // Название и значок выводятся из ключа (`У-106`), поэтому разъехаться
        // они могут только вместе с самим словарём. Проверка держит `У-106` от
        // отката: вернут `label` в пункт меню — тест это увидит.
        const first = roles[0]!;
        const drift: string[] = [];
        for (const key of renderedOrder(first)) {
          for (const role of roles) {
            const item = itemOf(role, key);
            if (!item) continue;
            const canon = SECTIONS[key];
            if (item.label !== canon.label || item.iconKey !== canon.iconKey) {
              drift.push(`${role}/${key}: «${item.label}»/${item.iconKey}`);
            }
          }
        }
        expect(drift, drift.join('\n')).toEqual([]);
      });
    });
  }

  it('каждое исключение объявлено с причиной и указывает на живой раздел', () => {
    const broken: string[] = [];
    for (const e of MIRROR_EXCEPTIONS) {
      if (e.reason.trim() === '') broken.push(`${e.pair}/${e.sectionKey}: пустая причина`);
      if (!(e.sectionKey in SECTIONS)) broken.push(`${e.pair}/${e.sectionKey}: нет такого раздела`);
      const roles = MIRROR_PAIRS[e.pair];
      const alien = e.cabinets.filter((c) => !roles.includes(c));
      if (alien.length > 0) {
        broken.push(`${e.pair}/${e.sectionKey}: кабинет вне пары — ${alien.join(', ')}`);
      }
      if (e.cabinets.length === 0 || e.cabinets.length === roles.length) {
        broken.push(`${e.pair}/${e.sectionKey}: исключение ни от чего не освобождает`);
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('протухшее исключение не живёт вечно', () => {
    // Раздел выровняли, а строку забыли снять — список превращается в свалку.
    const stale: string[] = [];
    for (const e of MIRROR_EXCEPTIONS) {
      const roles = MIRROR_PAIRS[e.pair];
      const present = roles.filter((r) => renderedOrder(r).includes(e.sectionKey));
      if (present.length === roles.length) {
        stale.push(`${e.pair}/${e.sectionKey}: раздел уже есть во всех кабинетах пары`);
      }
      if (present.length === 0) {
        stale.push(`${e.pair}/${e.sectionKey}: раздела нет ни в одном кабинете пары`);
      }
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });
});
