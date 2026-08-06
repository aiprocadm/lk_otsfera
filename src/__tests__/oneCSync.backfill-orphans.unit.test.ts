/**
 * Этап 6 (Т-42): бэкфилл осиротевших Company — юнит-слой на мокнутой призме.
 * Сигнатура сироты, фильтр companyIds, отказы применения и обе ветки исхода
 * (deleted / kept_not_empty). Живой Postgres — в import.stage6-company-binding.
 */
import { describe, it, expect, vi } from 'vitest';
import { findOrphanCompanies, applyOrphanBackfill } from '@/lib/services/oneCSync/backfill-orphans';

const org = (id: string, name: string, orders = 0) => ({
  id,
  name,
  inn: null,
  _count: { orders },
});

function companyRow(id: string, name: string, organizations: unknown[]) {
  return { id, name, organizations };
}

const EMPTY_COUNT = {
  users: 0,
  orders: 0,
  organizations: 0,
  documents: 0,
  accessProfiles: 0,
  funnelStages: 0,
  deals: 0,
  dealStages: 0,
  taskColumns: 0,
  tasks: 0,
  inboundMessages: 0,
  calls: 0,
  contacts: 0,
  salesTargets: 0,
  staffConversations: 0,
  calendarEvents: 0,
};

describe('findOrphanCompanies — сигнатура сироты', () => {
  it('кандидат = без пользователей, ровно одна организация, имя совпадает', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        companyRow('c-two-orgs', 'Двое', [org('o1', 'Двое'), org('o2', 'Двое-2')]),
        companyRow('c-name-diff', 'Компания', [org('o3', 'Другое имя')]),
        companyRow('c-orphan', 'ООО Сирота', [org('o4', 'ООО Сирота', 3)]),
        companyRow('c-no-orgs', 'Пустая', []),
      ]);
    const db = { company: { findMany } } as never;

    const candidates = await findOrphanCompanies(db);
    expect(candidates).toEqual([
      {
        companyId: 'c-orphan',
        companyName: 'ООО Сирота',
        organizationId: 'o4',
        organizationInn: null,
        ordersCount: 3,
      },
    ]);
    // Пользователи отфильтрованы на уровне запроса — не в JS.
    expect(findMany.mock.calls[0][0].where).toEqual({ users: { none: {} } });
  });

  it('companyIds сужает запрос (страховка точечного прогона и тестов)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { company: { findMany } } as never;
    await findOrphanCompanies(db, { companyIds: ['c-1', 'c-2'] });
    expect(findMany.mock.calls[0][0].where).toEqual({
      users: { none: {} },
      id: { in: ['c-1', 'c-2'] },
    });
  });
});

describe('applyOrphanBackfill — отказы и исходы', () => {
  function makeDb(over: Record<string, unknown> = {}) {
    const tx = {
      organization: { update: vi.fn() },
      order: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      company: {
        findUnique: vi.fn().mockResolvedValue({ _count: { ...EMPTY_COUNT } }),
        delete: vi.fn(),
      },
    };
    const db = {
      company: {
        findUnique: vi.fn().mockResolvedValue({ id: 'target' }),
        findMany: vi
          .fn()
          .mockResolvedValue([companyRow('c-orphan', 'Сирота', [org('o1', 'Сирота')])]),
      },
      $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
      ...over,
    } as never;
    return { db, tx };
  }

  it('целевая компания не найдена → target_not_found, ничего не трогаем', async () => {
    const { db } = makeDb({
      company: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn() },
    });
    const res = await applyOrphanBackfill(db, { targetCompanyId: 'ghost' });
    expect(res).toEqual({ ok: false, error: 'target_not_found' });
  });

  it('целевая компания сама кандидат → target_is_orphan', async () => {
    const { db } = makeDb({
      company: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c-orphan' }),
        findMany: vi
          .fn()
          .mockResolvedValue([companyRow('c-orphan', 'Сирота', [org('o1', 'Сирота')])]),
      },
    });
    const res = await applyOrphanBackfill(db, { targetCompanyId: 'c-orphan' });
    expect(res).toEqual({ ok: false, error: 'target_is_orphan' });
  });

  it('пустая сирота: организация и заказы перевешаны, компания удалена', async () => {
    const { db, tx } = makeDb();
    const res = await applyOrphanBackfill(db, {
      targetCompanyId: 'target',
      companyIds: ['c-orphan'],
    });
    expect(res).toEqual({
      ok: true,
      outcomes: [
        { companyId: 'c-orphan', companyName: 'Сирота', ordersMoved: 2, action: 'deleted' },
      ],
    });
    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { companyId: 'target' },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'c-orphan' },
      data: { companyId: 'target' },
    });
    expect(tx.company.delete).toHaveBeenCalledWith({ where: { id: 'c-orphan' } });
  });

  it('непустая сирота (осталась другая связь) → kept_not_empty, компания НЕ удалена', async () => {
    const { db, tx } = makeDb();
    tx.company.findUnique.mockResolvedValue({ _count: { ...EMPTY_COUNT, tasks: 1 } });
    const res = await applyOrphanBackfill(db, { targetCompanyId: 'target' });
    expect(res).toEqual({
      ok: true,
      outcomes: [
        { companyId: 'c-orphan', companyName: 'Сирота', ordersMoved: 2, action: 'kept_not_empty' },
      ],
    });
    expect(tx.company.delete).not.toHaveBeenCalled();
  });

  it('пересчёт компании исчез из-под транзакции (гонка) → компания не удаляется', async () => {
    const { db, tx } = makeDb();
    tx.company.findUnique.mockResolvedValue(null);
    const res = await applyOrphanBackfill(db, { targetCompanyId: 'target' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.outcomes[0].action).toBe('kept_not_empty');
    expect(tx.company.delete).not.toHaveBeenCalled();
  });
});
