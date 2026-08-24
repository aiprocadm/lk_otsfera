/**
 * Страж `У-9` (этап 2 ТЗ понятности): значок раздела не может разъехаться с его
 * названием.
 *
 * Инвариант в обе стороны:
 *   одинаковое `label` в любых двух ролях ⟹ одинаковый `iconKey`
 *   одинаковый `iconKey` в любых двух ролях ⟹ одинаковое `label`
 *
 * Зачем страж: до этапа 2 значки подбирались на глаз, и `📥` успел означать
 * четыре разных раздела, `⚙` — три, а «Организации» рисовались `🏛` у админа и
 * `🏢` у менеджера. Без этого теста расхождение вернётся первым же PR, который
 * добавит пункт меню.
 *
 * Падение теста = красная сборка. Чинить нужно **реестр или название**, а не
 * ослаблять проверку.
 */
import { describe, it, expect } from 'vitest';
import { navByRole } from '@/lib/navigation/cabinet';
import { ORG_CARD_TABS } from '@/lib/navigation/orgCardTabs';
import { NAV_ICONS, navIcon, type IconKey } from '@/lib/navigation/icons';

type Row = { role: string; label: string; iconKey: IconKey; href: string };

const rows: Row[] = Object.entries(navByRole).flatMap(([role, items]) =>
  items.map((it) => ({ role, label: it.label, iconKey: it.iconKey, href: it.href }))
);

describe('У-9: значок ↔ название', () => {
  it('в меню есть пункты (тест не проходит вхолостую)', () => {
    expect(rows.length).toBeGreaterThan(50);
  });

  it('одинаковое название ⟹ одинаковый значок', () => {
    const byLabel = new Map<string, Set<IconKey>>();
    for (const r of rows) {
      if (!byLabel.has(r.label)) byLabel.set(r.label, new Set());
      byLabel.get(r.label)!.add(r.iconKey);
    }

    const broken = [...byLabel.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([label, keys]) => `«${label}» → ${[...keys].join(', ')}`);

    expect(
      broken,
      'Один и тот же раздел нарисован по-разному в разных ролях. ' +
        'Приведите пункты к одному iconKey из lib/navigation/icons.ts.'
    ).toEqual([]);
  });

  it('одинаковый значок ⟹ одинаковое название', () => {
    const byKey = new Map<IconKey, Set<string>>();
    for (const r of rows) {
      if (!byKey.has(r.iconKey)) byKey.set(r.iconKey, new Set());
      byKey.get(r.iconKey)!.add(r.label);
    }

    const broken = [...byKey.entries()]
      .filter(([, labels]) => labels.size > 1)
      .map(([key, labels]) => `${key} (${navIcon(key)}) → ${[...labels].join(' / ')}`);

    expect(
      broken,
      'Один значок означает несколько разных разделов. ' +
        'Заведите отдельный ключ в lib/navigation/icons.ts или переименуйте пункт.'
    ).toEqual([]);
  });

  it('У-7: у каждого пункта каждой роли есть значок', () => {
    const missing = rows.filter((r) => !r.iconKey).map((r) => `${r.role}: ${r.label}`);
    expect(missing, 'Пункт меню без значка').toEqual([]);
  });

  it('каждый iconKey пункта есть в реестре', () => {
    const unknown = rows
      .filter((r) => !(r.iconKey in NAV_ICONS))
      .map((r) => `${r.role}: ${r.label} → ${r.iconKey}`);
    expect(unknown, 'iconKey отсутствует в NAV_ICONS').toEqual([]);
  });

  it('в реестре нет ключей, которыми никто не пользуется (knip для значков)', () => {
    // Значки носят не только пункты меню, но и вкладки карточки организации
    // (`У-95`). Проверки «значок ↔ название» выше остаются про меню: свести
    // подписи вкладок и разделов в один словарь — работа `У-108`, отдельного
    // требования. Здесь важно другое: ключ, которым пользуется вкладка, не
    // должен считаться брошенным и быть удалён «как неиспользуемый».
    const used = new Set([...rows.map((r) => r.iconKey), ...ORG_CARD_TABS.map((t) => t.iconKey)]);
    const unused = (Object.keys(NAV_ICONS) as IconKey[]).filter((k) => !used.has(k));
    expect(
      unused,
      'Ключ в реестре есть, а пункта меню с ним нет. Удалите ключ или используйте его.'
    ).toEqual([]);
  });

  it('два ключа реестра не делят один эмодзи', () => {
    const byEmoji = new Map<string, IconKey[]>();
    for (const [key, emoji] of Object.entries(NAV_ICONS) as [IconKey, string][]) {
      byEmoji.set(emoji, [...(byEmoji.get(emoji) ?? []), key]);
    }
    const dup = [...byEmoji.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([emoji, keys]) => `${emoji} → ${keys.join(', ')}`);

    expect(dup, 'Разные разделы получили один и тот же эмодзи').toEqual([]);
  });

  it('все семантические ключи из У-5 заведены', () => {
    // Дословный список из требования У-5 — он же защита от «переименую ключ и
    // забуду»: ТЗ называет эти разделы поимённо.
    const required: IconKey[] = [
      'dashboard',
      'orders',
      'organizations',
      'partners',
      'employees',
      'team',
      'settings',
      'documents',
      'finance',
      'messages',
      'enrollments',
      'certificates',
      'requests',
      'intake',
      'import',
      'sync',
      'search',
      'tasks',
      'calendar',
      'analytics',
      'audit',
      'roles',
      'security',
    ];
    const missing = required.filter((k) => !(k in NAV_ICONS));
    expect(missing, 'Ключ из У-5 отсутствует в реестре').toEqual([]);
  });
});
