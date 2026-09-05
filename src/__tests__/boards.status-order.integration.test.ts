/**
 * `Р-27` (вопрос `В-3`): доски берут `BOARD_CAP` карточек с
 * `orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]` и полагаются на то,
 * что Postgres сортирует enum по порядку значений в `pg_enum`. Миграция
 * `ALTER TYPE … ADD VALUE` без `BEFORE` дописывает значение в конец — база
 * может разойтись со `schema.prisma`, поэтому порядок проверяется в живой
 * базе, а не только по тексту схемы (`prisma.enum-terminal-last.guardrail`).
 *
 * Плюс живая проверка на сделках: старая открытая попадает в выборку
 * раньше новой проигранной.
 *
 * Запуск: npx vitest run --mode=integration src/__tests__/boards.status-order.integration.test.ts
 * Префикс данных: r27-int. Cleanup — beforeAll + afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getDealBoard } from '@/lib/services/deals/board';
import { TERMINAL, liveAfterTerminal } from './helpers/enumOrder';

const P = 'r27-int';
let prisma: PrismaClient;
let companyId: string;
let managerId: string;

async function cleanup() {
  const companies = await prisma.company.findMany({
    where: { name: { startsWith: P } },
    select: { id: true },
  });
  const ids = companies.map((c) => c.id);
  if (ids.length) {
    await prisma.deal.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.user.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await cleanup();
  companyId = (await prisma.company.create({ data: { name: `${P}-co` } })).id;
  managerId = (
    await prisma.user.create({
      data: { email: `${P}-mgr@t.local`, name: 'Менеджер', role: 'manager', companyId },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('порядок enum в живой базе (pg_enum)', () => {
  it.each(Object.entries(TERMINAL))(
    '%s: живые значения раньше терминальных',
    async (name, terminal) => {
      const rows = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${name}
      ORDER BY e.enumsortorder
    `;
      const values = rows.map((r) => r.enumlabel);
      expect(values.length, `тип ${name} не найден в базе`).toBeGreaterThan(0);
      const bad = liveAfterTerminal(values, terminal);
      expect(bad, `в базе ${name} = [${values.join(', ')}]`).toEqual([]);
    }
  );
});

describe('живая выборка: открытые первыми', () => {
  it('старая открытая сделка идёт раньше новой проигранной; total считает обе', async () => {
    await prisma.deal.create({
      data: {
        title: `${P}-old-open`,
        companyId,
        managerId,
        status: 'open',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
    });
    await prisma.deal.create({
      data: {
        title: `${P}-new-lost`,
        companyId,
        managerId,
        status: 'lost',
        lostReason: 'тест',
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    });

    const first = await prisma.deal.findMany({
      where: { companyId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 1,
      select: { title: true },
    });
    expect(first.map((d) => d.title)).toEqual([`${P}-old-open`]);

    const board = await getDealBoard(prisma, { sub: managerId, role: 'manager', companyId });
    expect(board.total).toBe(2);
    expect(board.shown).toBe(2);
  });
});
