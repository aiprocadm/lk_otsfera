import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { navByRole } from '@/lib/navigation/cabinet';

/**
 * Сторож единого названия раздела (§15, `У-76`).
 *
 * «Один и тот же объект называется одинаково во всех шести кабинетах.»
 *
 * Правило держалось на внимательности и разъехалось: экран загрузки банковской
 * выписки назывался «Импорт выписки (сч. 51)» у админа, «Импорт оплат» у
 * менеджера, а **заголовок самой страницы** не совпадал ни с тем ни с другим.
 * Плюс два разных значка на один экран. Человек кликал одно название, попадал
 * на другое — и не мог сослаться на экран в разговоре с коллегой из соседнего
 * кабинета.
 *
 * Проверка идёт по последнему сегменту адреса: `/admin/payments-import` и
 * `/manager/payments-import` — это один экран, показанный двум ролям.
 */
const SRC = join(__dirname, '..');

/**
 * Сегменты, у которых разные названия ОСОЗНАННЫ — за каждым стоит другой
 * объект, а не оплошность. Список короткий намеренно.
 */
const DIFFERENT_BY_DESIGN = new Map<string, string>([
  ['dashboard', 'у каждой роли своя главная; в чужих меню это ссылка-вход с названием кабинета'],
  ['deals', 'у партнёра по этому адресу его портфель заказов, а не канбан сделок (см. §5)'],
  ['student', 'у заказчика это вход в кабинет слушателя, у слушателя — его собственный раздел'],
]);

function labelsBySegment(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [role, items] of Object.entries(navByRole)) {
    for (const item of items) {
      const parts = item.href.split('/').filter(Boolean);
      const segment = parts[parts.length - 1];
      if (!segment) continue;
      const byRole = out.get(segment) ?? new Map<string, string>();
      byRole.set(role, item.label);
      out.set(segment, byRole);
    }
  }
  return out;
}

describe('один раздел — одно название во всех кабинетах (У-76)', () => {
  const segments = labelsBySegment();

  it('реестр разобран — есть что проверять', () => {
    expect(segments.size).toBeGreaterThan(15);
  });

  it('названия одного раздела совпадают у всех ролей', () => {
    const drift: string[] = [];

    for (const [segment, byRole] of segments) {
      if (DIFFERENT_BY_DESIGN.has(segment)) continue;
      const labels = new Set(byRole.values());
      if (labels.size > 1) {
        const shown = [...byRole].map(([r, l]) => `${r}: «${l}»`).join(', ');
        drift.push(`/${segment} — ${shown}`);
      }
    }

    expect(drift, 'один экран называется по-разному в разных кабинетах').toEqual([]);
  });

  it('исключения объяснены, а список не разрастается', () => {
    for (const [, reason] of DIFFERENT_BY_DESIGN) {
      expect(reason.length, 'у исключения должна быть причина словами').toBeGreaterThan(20);
    }
    expect(DIFFERENT_BY_DESIGN.size).toBeLessThanOrEqual(4);
  });

  it('заголовок экрана импорта оплат совпадает с пунктом меню', () => {
    // Именно это расхождение и было: клик по «Импорт оплат» приводил на экран
    // с заголовком «Импорт выписки (Карточка счёта 51)».
    const menuLabel = navByRole.manager.find((i) => i.href.endsWith('/payments-import'))?.label;
    expect(menuLabel).toBe('Импорт оплат');

    for (const page of [
      join(SRC, 'app', 'manager', 'payments-import', 'page.tsx'),
      join(SRC, 'app', 'admin', 'settings', 'integrations', '1c', 'payments', 'page.tsx'),
      join(SRC, 'app', 'leader', 'settings', 'integrations', '1c', 'payments', 'page.tsx'),
    ]) {
      const src = readFileSync(page, 'utf8');
      expect(src, `${page}: заголовок должен совпадать с пунктом меню`).toContain(
        `>${menuLabel}</h1>`
      );
      // Бухгалтерская подробность остаётся — но в подзаголовке, где объясняет.
      expect(src, `${page}: подзаголовок должен подсказывать, какой файл взять`).toContain(
        'Карточка счёта 51'
      );
    }
  });
});
