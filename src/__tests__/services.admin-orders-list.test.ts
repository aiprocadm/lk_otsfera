import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listOrdersForAdmin, listCompanyOptions } from '@/lib/services/admin/orders';

/**
 * Список заказов администратора: фильтры и постраничность.
 *
 * Постраничность сделана «взять на одну больше»: только так видно, есть ли
 * следующая страница, не делая второй запрос на счёт. Важная деталь — лишняя
 * строка **не показывается**: иначе на каждой странице был бы один чужой заказ.
 */
/** Аргументы выборки заказов — ровно то, что проверяют тесты ниже. */
type FindManyArgs = { where?: Record<string, unknown>; take?: number; cursor?: unknown };

function db(rows: Array<{ id: string }>) {
  // Параметр объявлен явно: у `vi.fn` без него кортеж аргументов пустой, и
  // обращение `calls[0][0]` не проходит проверку типов.
  const findMany = vi.fn<(args?: FindManyArgs) => Promise<Array<{ id: string }>>>(
    async () => rows
  );
  return {
    db: { order: { findMany }, company: { findMany: vi.fn(async () => []) } } as never,
    findMany,
    /** Аргументы первого похода в базу. Он в каждом тесте ровно один. */
    firstArgs: () => findMany.mock.calls[0]![0]!,
  };
}

const order = (id: string) => ({ id });

beforeEach(() => vi.clearAllMocks());

describe('listOrdersForAdmin — фильтры', () => {
  it('без фильтров условие не собирается вовсе', async () => {
    const { db: prisma, firstArgs } = db([]);

    await listOrdersForAdmin(prisma);

    expect(firstArgs()).not.toHaveProperty('where');
  });

  it('каждый фильтр добавляет своё условие', async () => {
    const { db: prisma, firstArgs } = db([]);

    await listOrdersForAdmin(prisma, {
      statusId: 'st1',
      financialStatus: 'paid',
      organizationId: 'o1',
      companyId: 'c1',
      unassigned: true,
    });

    const where = firstArgs().where as { AND: unknown[] };
    expect(where.AND).toEqual([
      { statusId: 'st1' },
      { financialStatus: 'paid' },
      { organizationId: 'o1' },
      { companyId: 'c1' },
      { managerId: null },
    ]);
  });

  it('поиск идёт и по названию, и по номеру — без учёта регистра', async () => {
    const { db: prisma, firstArgs } = db([]);

    await listOrdersForAdmin(prisma, { search: 'Ромашка' });

    const where = firstArgs().where as { AND: Array<{ OR: unknown[] }> };
    expect(where.AND[0]?.OR).toEqual([
      { title: { contains: 'Ромашка', mode: 'insensitive' } },
      { orderNumber: { contains: 'Ромашка', mode: 'insensitive' } },
    ]);
  });

  it('снятая галочка «без ответственного» условия не добавляет', async () => {
    const { db: prisma, firstArgs } = db([]);

    await listOrdersForAdmin(prisma, { unassigned: false });

    expect(firstArgs()).not.toHaveProperty('where');
  });
});

describe('listOrdersForAdmin — постраничность', () => {
  it('следующей страницы нет — курсор пустой, лишних строк не показываем', async () => {
    const { db: prisma } = db([order('a'), order('b')]);

    const res = await listOrdersForAdmin(prisma, { take: 2 });

    expect(res.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(res.nextCursor).toBeNull();
  });

  it('пришла лишняя строка — она не показывается, а становится курсором', async () => {
    const { db: prisma } = db([order('a'), order('b'), order('в запасе')]);

    const res = await listOrdersForAdmin(prisma, { take: 2 });

    expect(res.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(res.nextCursor).toBe('b');
  });

  it('берётся на одну больше, чем просили — иначе о следующей странице не узнать', async () => {
    const { db: prisma, firstArgs } = db([]);

    await listOrdersForAdmin(prisma, { take: 10 });

    expect(firstArgs().take).toBe(11);
  });

  it('с курсором предыдущая строка пропускается — иначе она задвоится', async () => {
    const { db: prisma, firstArgs } = db([]);

    await listOrdersForAdmin(prisma, { cursor: 'b' });

    expect(firstArgs()).toMatchObject({ cursor: { id: 'b' }, skip: 1 });
  });

  it('без курсора его в запросе нет', async () => {
    const { db: prisma, firstArgs } = db([]);

    await listOrdersForAdmin(prisma);

    expect(firstArgs()).not.toHaveProperty('cursor');
  });

  it('пустая страница курсора не даёт', async () => {
    const { db: prisma } = db([]);

    await expect(listOrdersForAdmin(prisma, { take: 5 })).resolves.toEqual({
      rows: [],
      nextCursor: null,
    });
  });
});

describe('listCompanyOptions — компании для фильтра', () => {
  it('сортируются по названию, как в справочниках', async () => {
    const findMany = vi.fn(async () => [{ id: 'c1', name: 'Альфа' }]);
    const prisma = { company: { findMany } } as never;

    await expect(listCompanyOptions(prisma)).resolves.toEqual([{ id: 'c1', name: 'Альфа' }]);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  });
});
