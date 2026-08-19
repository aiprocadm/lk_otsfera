/**
 * Guardrail: сделка видна только контуру сотрудников.
 *
 * **Зачем.** Панель «Сделка» на карточке заказа (19.08.2026, спека
 * `2026-08-19-order-deal-link-design.md`) показывает внутреннюю кухню продаж:
 * сумму переговоров, стадию, ответственного менеджера. Клиенту (заказчику и
 * партнёру) этого видеть нельзя. Компонент презентационный и ролей внутри не
 * знает — значит единственная защита от «смонтируем и сюда, он же красивый»
 * это явный список мест монтирования.
 *
 * **Что он делает.** Обходит `src/app/**` и `src/components/**`, собирает все
 * файлы, которые тянут панель или её сервис, и сверяет со списком разрешённых.
 * Появился новый потребитель — тест падает и требует решить, сотруднику это
 * или клиенту.
 *
 * Проверен мутацией (§16 CLAUDE.md): монтирование панели в
 * `src/app/organization/orders/[id]/page.tsx` роняет тест.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');

/** Кто имеет право знать о сделке. Список пополняется осознанно, не «заодно». */
const ALLOWED = new Set([
  'app/manager/orders/[id]/page.tsx',
  'app/leader/orders/[id]/page.tsx',
  'app/admin/orders/[id]/page.tsx',
]);

/** Клиентские кабинеты — им сделка не положена ни при каких условиях. */
const CLIENT_PREFIXES = ['app/organization/', 'app/partner/', 'app/student/', 'components/organization/', 'components/partner/'];

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function consumers(): string[] {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))];
  return files
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes('order-deal-panel') || src.includes('loadOrderDeal');
    })
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();
}

describe('панель «Сделка» монтируется только в кабинетах сотрудников', () => {
  it('нет ни одного потребителя вне явного списка', () => {
    expect(consumers()).toEqual([...ALLOWED].sort());
  });

  it('ни один клиентский кабинет не тянет сделку', () => {
    const leaked = consumers().filter((f) => CLIENT_PREFIXES.some((p) => f.startsWith(p)));

    expect(leaked).toEqual([]);
  });

  it('«видеть все компании» нельзя получить случайно — только явным словом', () => {
    const src = readFileSync(path.join(ROOT, 'lib/services/manager/orderDetail.ts'), 'utf8');

    // Union вместо `string | null`: пропуск границы = ошибка компиляции, а
    // сотрудник без компании не проваливается в админский режим молча.
    expect(src).toMatch(
      /export type OrderDealScope = \{ allCompanies: true \} \| \{ companyId: string \}/
    );
    expect(src).toMatch(
      /export async function loadOrderDeal\(\s*prisma: PrismaClient,\s*orderId: string,\s*scope: OrderDealScope\s*\)/
    );
    // Значения по умолчанию у scope быть не должно — иначе забывчивость снова
    // становится молчаливой (урок `teamMode`, §4 CLAUDE.md).
    expect(src).not.toMatch(/scope: OrderDealScope\s*=/);
  });

  it('кабинеты сотрудников с пустой компанией деградируют в «ничего», а не в «всё»', () => {
    for (const page of ['app/manager/orders/[id]/page.tsx', 'app/leader/orders/[id]/page.tsx']) {
      const src = readFileSync(path.join(ROOT, page), 'utf8');

      // Условие «есть компания» обязано стоять перед чтением сделки.
      expect(src).toMatch(/session\.companyId\s*$/m);
      expect(src).toContain('{ companyId: session.companyId }');
      expect(src).not.toContain('allCompanies');
    }
  });
});
