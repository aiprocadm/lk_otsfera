import { describe, it, expect, vi } from 'vitest';

// Флаги включаем все: страж смотрит на ВЕСЬ реестр, а не на тот срез, который
// случайно виден при текущих настройках.
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: () => true }));

import { navByRole } from '@/lib/navigation/cabinet';
import { groupNavItems, splitPinnedItems } from '@/lib/navigation/groupItems';
import { MENU_GROUP_ORDER } from '@/lib/navigation/menuGroups';

/**
 * Страж порядка групп меню (`У-113`) и закреплённых внизу «Настроек» (`У-114`).
 *
 * **Зачем.** Порядок групп был у каждого кабинета свой: у администратора меню
 * начиналось с «Платформы», у менеджера — с «Работы», у руководителя — с
 * «Настроек». Разделы те же, а искать их приходилось заново в каждом кабинете.
 *
 * Порядок теперь данные, а не следствие расстановки пунктов: сайдбар сортирует
 * группы реестром. Страж следит, чтобы реестр не обошли — и чтобы «Настройки»
 * со «Справкой» стояли внизу во **всех** шести кабинетах.
 */
const STAFF = ['admin', 'manager', 'leader'] as const;
const ALL_ROLES = ['admin', 'manager', 'leader', 'partner', 'organization', 'student'] as const;

describe('порядок групп меню общий для сотрудников ЦО (У-113)', () => {
  it('каждая группа объявлена в реестре порядка', () => {
    const known = new Set<string>(MENU_GROUP_ORDER);
    const unknown = new Set<string>();
    for (const role of STAFF) {
      for (const item of navByRole[role]) {
        if (item.group && !known.has(item.group)) unknown.add(`${role}: ${item.group}`);
      }
    }
    expect([...unknown], 'группа вне реестра `menuGroups.ts`').toEqual([]);
  });

  it.each(STAFF)('%s: группы идут в общем порядке', (role) => {
    const { items } = splitPinnedItems(navByRole[role]);
    const titles = groupNavItems(items)
      .map((g) => g.title)
      .filter(Boolean);
    const expected = (MENU_GROUP_ORDER as readonly string[]).filter((t) => titles.includes(t));
    expect(titles).toEqual(expected);
  });

  it('порядок групп совпадает у всех трёх кабинетов сотрудников', () => {
    // Кабинет может не иметь какой-то группы (у менеджера нет «Аналитики»), но
    // переставить общие группы местами он не может.
    const sequences = STAFF.map((role) =>
      groupNavItems(splitPinnedItems(navByRole[role]).items)
        .map((g) => g.title)
        .filter(Boolean)
    );
    for (let i = 1; i < sequences.length; i++) {
      const a = sequences[0] as string[];
      const b = sequences[i] as string[];
      const common = a.filter((t) => b.includes(t));
      expect(b.filter((t) => a.includes(t)), `${STAFF[i]} против ${STAFF[0]}`).toEqual(common);
    }
  });

  it('«Главная» и «Поиск» стоят выше групп, вне секций', () => {
    for (const role of STAFF) {
      const { items } = splitPinnedItems(navByRole[role]);
      const first = groupNavItems(items)[0];
      expect(first?.title, role).toBe('');
      expect(first?.items.map((i) => i.sectionKey), role).toContain('dashboard');
    }
  });
});

describe('«Настройки» и «Справка» закреплены внизу во всех кабинетах (У-114)', () => {
  it.each(ALL_ROLES)('%s: «Справка» внизу', (role) => {
    const pinned = splitPinnedItems(navByRole[role]).pinned.map((i) => i.sectionKey);
    expect(pinned).toContain('help');
  });

  it.each(['admin', 'manager', 'leader', 'partner', 'organization'] as const)(
    '%s: «Настройки» внизу, а не среди операционных разделов',
    (role) => {
      const { items, pinned } = splitPinnedItems(navByRole[role]);
      expect(pinned.map((i) => i.sectionKey)).toContain('settings');
      expect(items.map((i) => i.sectionKey)).not.toContain('settings');
    }
  );

  it('пункты-мосты в соседний кабинет тоже внизу, а не в операционных группах', () => {
    // «Кабинет руководителя» и «Мои заказы» — переключение кабинета, а не
    // раздел работы. В PR-3 они уступят место переключателю в шапке (`У-111`).
    for (const role of ['manager', 'leader'] as const) {
      const bridges = navByRole[role].filter((i) =>
        ['leaderCabinet', 'myOrders'].includes(i.sectionKey)
      );
      for (const b of bridges) {
        expect(b.pinnedBottom, `${role}: ${b.href}`).toBe(true);
        expect(b.group, `${role}: ${b.href}`).toBeUndefined();
      }
    }
  });
});
