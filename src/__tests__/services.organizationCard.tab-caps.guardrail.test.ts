import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORG_CARD_TAB_CAP } from '@/lib/services/manager/organizationCard';

/**
 * Страж `С-6` (сопровождение, прогон №4): вкладки карточки организации режутся
 * по одному пределу, и у каждой выборки есть `count` по ТОМУ ЖЕ условию.
 *
 * Регресс, который ловим: кто-то добавил вкладку с голым `take: 20` без
 * счётчика — или переписал `where` в выборке, забыв про счётчик, — и экран
 * снова врёт «показаны 20 из 7» или молчит про усечение.
 */
const SRC = readFileSync(
  join(__dirname, '..', 'lib', 'services', 'manager', 'organizationCard.ts'),
  'utf8'
);

describe('карточка организации: предел вкладок и честные счётчики (С-6)', () => {
  it('предел один, числом в сервисе не встречается', () => {
    expect(ORG_CARD_TAB_CAP).toBe(20);
    expect(SRC, 'голое take: <число> вместо константы').not.toMatch(/take:\s*\d+/);
  });

  it('каждое условие выборки используется и списком, и счётчиком', () => {
    const wheres = [...SRC.matchAll(/const (\w+Where): Prisma\.\w+WhereInput/g)].map((m) => m[1]);
    // Одиннадцать списков (заказы считает `_count` организации по тому же
    // условию — без своего `count`).
    expect(wheres.length).toBeGreaterThanOrEqual(11);
    for (const w of wheres) {
      expect(SRC, `${w}: нет выборки списка`).toMatch(new RegExp(`findMany\\(\\{\\s*where: ${w},`));
      if (w === 'ordersWhere') continue;
      expect(SRC, `${w}: нет count по тому же условию`).toContain(`count({ where: ${w} })`);
    }
  });

  it('у каждой вкладки-списка есть свой счётчик в tabTotals', () => {
    const block = SRC.match(/tabTotals: \{([\s\S]*?)\n {4}\},/)?.[1] ?? '';
    for (const key of [
      'orders',
      'documents',
      'payments',
      'activity',
      'inboundMessages',
      'calls',
      'clientRequests',
      'leads',
      'deals',
      'certificates',
      'enrollments',
      'auditTrail',
    ]) {
      expect(block, `tabTotals без ${key}`).toMatch(new RegExp(`\\b${key}:`));
    }
    // Заказы — из `_count` организации; удостоверения — `total` реестра.
    expect(block).toContain('orders: org._count.orders');
    expect(SRC).toContain('certificatesRes.ok ? certificatesRes.total : 0');
  });

  it('задолженность считается агрегатом по всем заказам, а не по показанным', () => {
    expect(SRC).toMatch(
      /order\.aggregate\(\{\s*where: ordersWhere,\s*_sum: \{ totalAmount: true, paidAmount: true \}/
    );
    expect(SRC, 'сумма по показанным строкам вернулась').not.toMatch(/orders\s*\.reduce\(/);
  });
});
