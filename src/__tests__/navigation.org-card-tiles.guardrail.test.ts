import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ORG_CARD_TILES, orgCardTiles } from '@/lib/navigation/orgCardTiles';

/**
 * `У-102` (дефект `Д-29`): плитки карточки считают одно и то же во всех
 * кабинетах. До этапа 2 «Пользователи» у менеджера считались по связи
 * `Organization.users` (`User.organizationId`), а «в кабинете» у админа — по
 * `OrganizationUser`: два разных числа под похожими подписями на одном и том
 * же объекте.
 */
describe('реестр плиток карточки организации (У-102)', () => {
  it('подписи — из глоссария, ключ уникален', () => {
    const keys = ORG_CARD_TILES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ORG_CARD_TILES.map((t) => t.label)).toEqual([
      'Заказы',
      'Сотрудники',
      'Доступ в кабинет',
      'Задолженность',
    ]);
  });

  it('одна подпись — один источник числа во всех кабинетах', () => {
    const counts = { orders: 3, students: 7, cabinetUsers: 2 };
    const tiles = orgCardTiles({ ...counts, debt: '100.00' });
    expect(tiles.map((t) => t.value)).toEqual([3, 7, 2, '100.00 ₽']);
  });

  it('пустые значения показываются нулём, а не пустотой (У-74)', () => {
    const tiles = orgCardTiles({ orders: 0, students: 0, cabinetUsers: 0, debt: '0.00' });
    expect(tiles.map((t) => t.value)).toEqual([0, 0, 0, '0.00 ₽']);
  });
});

/**
 * Страж на источник данных: `Organization.users` — это связь `User.organizationId`
 * (люди, привязанные к организации напрямую), она НЕ равна «доступу в кабинет»
 * (`OrganizationUser`). В плитках её быть не должно вовсе.
 */
describe('источник числа «Доступ в кабинет» (Д-29)', () => {
  function collect(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) out.push(...collect(p));
      else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
    }
    return out;
  }

  it('сервисы карточки не берут число пользователей из Organization.users', () => {
    const roots = ['src/lib/services/manager', 'src/lib/services/admin', 'src/lib/services/partner'];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of collect(join(process.cwd(), root))) {
        const src = readFileSync(file, 'utf8');
        // `_count: { select: { ... users: true ... } }` на организации — ровно
        // тот источник, из-за которого числа расходились.
        if (/_count:\s*{\s*select:\s*{[^}]*\busers:\s*true/s.test(src)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
