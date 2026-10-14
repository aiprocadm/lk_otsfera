/**
 * Unit tests for src/lib/services/manager/orderDetail.ts
 * Covers both branches of loadManagerOrderDetail:
 *   - getOrder returns null  → returns null, skips audit/comment loads
 *   - getOrder returns order → parallel audit+comment load, documentRows mapped
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrder } = vi.hoisted(() => ({ getOrder: vi.fn() }));
const { listOrderItems } = vi.hoisted(() => ({
  listOrderItems: vi.fn().mockResolvedValue({ ok: true, items: [] }),
}));

vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/services/training', () => ({ listOrderItems }));

import {
  loadManagerOrderDetail,
  listOrderStudentOptions,
  loadOrderDeal,
} from '@/lib/services/manager/orderDetail';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1',
};

function fakePrisma(auditEntries: unknown[] = [], comments: unknown[] = []) {
  return {
    auditLog: { findMany: vi.fn().mockResolvedValue(auditEntries) },
    comment: { findMany: vi.fn().mockResolvedValue(comments) },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default: empty items list (most tests don't care about items)
  listOrderItems.mockResolvedValue({ ok: true, items: [] });
});

describe('loadManagerOrderDetail', () => {
  it('returns null and skips audit/comment loads when the order is not visible', async () => {
    getOrder.mockResolvedValue(null);
    const prisma = fakePrisma();

    const result = await loadManagerOrderDetail(prisma, SESSION, 'order-404');

    expect(result).toBeNull();
    expect(getOrder).toHaveBeenCalledWith(prisma, SESSION, 'order-404');
    // early return — no follow-up queries
    expect(
      (prisma as never as { auditLog: { findMany: ReturnType<typeof vi.fn> } }).auditLog.findMany
    ).not.toHaveBeenCalled();
    expect(
      (prisma as never as { comment: { findMany: ReturnType<typeof vi.fn> } }).comment.findMany
    ).not.toHaveBeenCalled();
  });

  it('loads audit + comments and folds per-order context into documentRows', async () => {
    const signedAt = new Date('2026-01-02T00:00:00Z');
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const order = {
      id: 'order-1',
      orderNumber: 'A-1',
      title: 'Заказ X',
      documents: [
        {
          id: 'doc-1',
          name: 'Акт.pdf',
          type: 'act',
          direction: 'incoming',
          signedAt,
          createdAt,
          size: 1024,
        },
      ],
    };
    getOrder.mockResolvedValue(order as never);

    const auditEntries = [{ id: 'a-1', action: 'order_status_changed' }];
    const comments = [
      { id: 'c-1', author: { id: 'u-1', name: 'Иван', email: 'i@x', role: 'manager' } },
    ];
    const prisma = fakePrisma(auditEntries, comments);

    const result = await loadManagerOrderDetail(prisma, SESSION, 'order-1');

    expect(result).not.toBeNull();
    expect(result!.order).toBe(order);
    expect(result!.auditEntries).toEqual(auditEntries);
    expect(result!.comments).toEqual(comments);
    expect(result!.documentRows).toEqual([
      {
        id: 'doc-1',
        name: 'Акт.pdf',
        type: 'act',
        direction: 'incoming',
        signedAt,
        createdAt,
        size: 1024,
        orderId: 'order-1',
        orderNumber: 'A-1',
        orderTitle: 'Заказ X',
      },
    ]);

    // audit query is scoped to the order + the timeline actions (`У-283`: + смена ответственного)
    const auditCall = (prisma as never as { auditLog: { findMany: ReturnType<typeof vi.fn> } })
      .auditLog.findMany.mock.calls[0][0];
    expect(auditCall.where.entityId).toBe('order-1');
    expect(auditCall.where.entity).toBe('order');
    expect(auditCall.where.action.in).toEqual([
      'order_status_changed',
      'document_uploaded',
      'comment_posted',
      'order_manager_changed',
      'order_self_assigned',
    ]);
  });

  it('У-283: имена сотрудников — только для строк смены ответственного, без лишних запросов', async () => {
    getOrder.mockResolvedValue({ id: 'order-3', orderNumber: null, title: 'Т', documents: [] });
    const userFindMany = vi.fn().mockResolvedValue([
      { id: 'u1', name: 'Иванов', email: 'i@x' },
      { id: 'u2', name: '', email: 'p@x' },
    ]);
    const prisma = {
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'a1',
            action: 'order_manager_changed',
            meta: { before: { managerId: 'u1' }, after: { managerId: 'u2' } },
          },
          { id: 'a2', action: 'order_self_assigned', meta: { after: { managerId: 'u1' } } },
          {
            id: 'a3',
            action: 'order_status_changed',
            meta: { after: { managerId: 'не-сотрудник' } },
          },
        ]),
      },
      comment: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: userFindMany },
    } as never;
    const result = await loadManagerOrderDetail(prisma, SESSION, 'order-3');
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2'] } },
      select: { id: true, name: true, email: true },
    });
    // Пустое имя — почта, а не пустота.
    expect(result!.userNames).toEqual({ u1: 'Иванов', u2: 'p@x' });
  });

  it('строк смены ответственного нет — имена не запрашиваются', async () => {
    getOrder.mockResolvedValue({ id: 'order-4', orderNumber: null, title: 'Т', documents: [] });
    const prisma = fakePrisma([{ id: 'a1', action: 'comment_posted', meta: null }]);
    const result = await loadManagerOrderDetail(prisma, SESSION, 'order-4');
    expect(result!.userNames).toEqual({});
  });

  it('returns an empty documentRows array when the order has no documents', async () => {
    getOrder.mockResolvedValue({
      id: 'order-2',
      orderNumber: 'A-2',
      title: 'Пусто',
      documents: [],
    } as never);
    const prisma = fakePrisma();

    const result = await loadManagerOrderDetail(prisma, SESSION, 'order-2');

    expect(result!.documentRows).toEqual([]);
  });
});

// A1: два запроса карточки заказа переехали со страниц (manager/leader
// orders/[id]) в сервис — здесь пиннится форма каждого.
describe('listOrderStudentOptions', () => {
  it('фильтрует по организации заказа, узкий select, сортировка по имени', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 's1', name: 'Иван', email: 'i@x' }]);
    const prisma = { student: { findMany } } as never;

    const rows = await listOrderStudentOptions(prisma, 'org-1');

    expect(rows).toEqual([{ id: 's1', name: 'Иван', email: 'i@x' }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  });

  // Прогон сопровождения №37: заказ без организации на практике не
  // встречается, но защитная ветка раньше уходила в базу с пустым where —
  // селект получал слушателей ВСЕЙ платформы. Страховка обязана отказывать:
  // пустой список и ни одного запроса.
  it('заказ без организации: пустой список, в базу не ходим', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 's-foreign', name: 'Чужой', email: 'x@y' }]);
    const prisma = { student: { findMany } } as never;

    expect(await listOrderStudentOptions(prisma, null)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('loadOrderDeal', () => {
  const raw = {
    id: 'd1',
    title: 'Сделка на обучение',
    amount: { toFixed: (n: number) => (120000).toFixed(n) },
    status: 'won',
    wonAt: new Date('2026-08-01T10:00:00Z'),
    stage: { name: 'Выиграна' },
    manager: { name: 'Иванова А.' },
    lead: { id: 'l1', clientCompanyName: 'ООО', sourceRequest: { id: 'r1', subject: 'Тема' } },
  };

  it('сотруднику отдаёт сделку только своей компании (C8) и раскладывает поля', async () => {
    const findFirst = vi.fn().mockResolvedValue(raw);
    const prisma = { deal: { findFirst } } as never;

    expect(await loadOrderDeal(prisma, 'order-1', { companyId: 'c1' })).toEqual({
      id: 'd1',
      title: 'Сделка на обучение',
      amount: '120000.00',
      status: 'won',
      wonAt: raw.wonAt,
      stageName: 'Выиграна',
      managerName: 'Иванова А.',
      lead: raw.lead,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { orderId: 'order-1', companyId: 'c1' },
      select: {
        id: true,
        title: true,
        amount: true,
        status: true,
        wonAt: true,
        stage: { select: { name: true } },
        manager: { select: { name: true } },
        lead: {
          select: {
            id: true,
            clientCompanyName: true,
            sourceRequest: { select: { id: true, subject: true } },
          },
        },
      },
    });
  });

  it('админ просит `allCompanies` — читает без границы компании (Model A)', async () => {
    const findFirst = vi.fn().mockResolvedValue(raw);
    const prisma = { deal: { findFirst } } as never;

    await loadOrderDeal(prisma, 'order-1', { allCompanies: true });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'order-1' } })
    );
  });

  it('пустые сумма, стадия и ответственный отдаются как null', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValue({ ...raw, amount: null, stage: null, manager: null, lead: null });
    const prisma = { deal: { findFirst } } as never;

    expect(await loadOrderDeal(prisma, 'order-1', { companyId: 'c1' })).toMatchObject({
      amount: null,
      stageName: null,
      managerName: null,
      lead: null,
    });
  });

  it('заказ не из сделки → null', async () => {
    const prisma = { deal: { findFirst: vi.fn().mockResolvedValue(null) } } as never;

    expect(await loadOrderDeal(prisma, 'order-1', { companyId: 'c1' })).toBeNull();
  });
});
