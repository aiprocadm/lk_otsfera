import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { navByRole } from '@/lib/navigation/cabinet';
import { MOBILE_TABS } from '@/lib/navigation/mobileTabs';

/**
 * Страж переименования «Сделки» → «Заказы» у партнёра (`У-109`).
 *
 * Раздел показывал заказы, а назывался «Сделки». При этом `Deal` — настоящая
 * сущность системы (воронка продаж), так что это была не синонимия, а прямая
 * ошибка: человек читал «Сделки» и думал про воронку.
 *
 * Разъезжается это тихо — достаточно скопировать старый адрес из письма или
 * назвать новый компонент по образцу соседнего. Поэтому проверяем не текст на
 * экране, а источники: меню, панель телефона и имена модулей кабинета.
 */
const SRC = join(__dirname, '..');

/**
 * Домен настоящих сделок: воронка продаж. Здесь слово «сделка» — правда, и
 * трогать его нельзя. Список держим явным, чтобы страж не начал «чинить» его.
 */
const REAL_DEAL_DOMAIN = [
  'app/manager/deals',
  'app/leader/deals',
  'components/deals',
  'lib/services/deals',
  'server-actions/deals',
  'server-actions/deal-activity.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/');

describe('«Заказы» партнёра, а не «Сделки» (У-109)', () => {
  it('пункт меню партнёра ведёт на /partner/orders', () => {
    const item = navByRole.partner.find((i) => i.sectionKey === 'orders');
    expect(item, 'у партнёра пропал раздел заказов').toBeDefined();
    expect(item?.href).toBe('/partner/orders');
    expect(item?.label).toBe('Заказы');
  });

  it('старый адрес остался живым — но редиректом, а не экраном', () => {
    // Закладки и ссылки в письмах обязаны довести человека до раздела.
    for (const p of ['app/partner/deals/page.tsx', 'app/partner/deals/[id]/page.tsx']) {
      const file = join(SRC, p);
      expect(existsSync(file), `${p}: старый адрес просто удалён`).toBe(true);
      const src = readFileSync(file, 'utf8');
      // Именно ПОСТОЯННЫЙ: адрес не вернётся, и поисковики это учитывают.
      // Проверяем сам импорт, а не слово: `redirect as permanentRedirect`
      // выглядит правильно и оставляет временный 307 — проверено мутацией.
      expect(src, `${p}: редирект не постоянный`).toMatch(
        /import \{ permanentRedirect \} from 'next\/navigation';/
      );
    }
  });

  it('нижняя панель партнёра знает раздел по ключу и переезд её не задел', () => {
    expect(MOBILE_TABS.partner).toContain('orders');
  });

  it('в кабинете партнёра не осталось модулей с «deal» в имени', () => {
    const rogue = walk(join(SRC, 'components', 'partner'))
      .concat(walk(join(SRC, 'lib', 'services', 'partner')))
      .map(rel)
      .filter((f) => /deal/i.test(f));
    expect(rogue, 'модуль кабинета партнёра всё ещё зовётся «сделкой»').toEqual([]);
  });

  it('домен настоящих сделок на месте — «Сделка» означает `Deal`', () => {
    // Обратная половина требования: страж не должен провоцировать переименование
    // воронки продаж «заодно».
    const missing = REAL_DEAL_DOMAIN.filter((p) => !existsSync(join(SRC, p)));
    expect(missing, 'домен воронки продаж переименован по ошибке').toEqual([]);
  });

  it('ни один экран не ссылается на старый адрес напрямую', () => {
    const rogue: string[] = [];
    for (const file of walk(join(SRC, 'app')).concat(walk(join(SRC, 'components')))) {
      const r = rel(file);
      if (r.startsWith('app/partner/deals')) continue; // сам редирект
      const src = readFileSync(file, 'utf8');
      if (src.includes('/partner/deals')) rogue.push(r);
    }
    expect(rogue, 'ссылка ведёт на старый адрес вместо нового').toEqual([]);
  });
});
