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
  loadOrderDealChain,
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

    // audit query is scoped to the order + the three timeline actions
    const auditCall = (prisma as never as { auditLog: { findMany: ReturnType<typeof vi.fn> } })
      .auditLog.findMany.mock.calls[0][0];
    expect(auditCall.where.entityId).toBe('order-1');
    expect(auditCall.where.entity).toBe('order');
    expect(auditCall.where.action.in).toEqual([
      'order_status_changed',
      'document_uploaded',
      'comment_posted',
    ]);
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

  // Заказ без организации на практике не встречается (Order.organizationId
  // обязателен), но защитная ветка со страницы сохранена: фильтра нет — для
  // Prisma пустой where и `organizationId: undefined` эквивалентны.
  it('заказ без организации: запрос уходит без фильтра по организации', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { student: { findMany } } as never;

    await listOrderStudentOptions(prisma, null);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe('loadOrderDealChain', () => {
  it('читает сделку по заказу с лидом и обращением', async () => {
    const chain = {
      title: 'Сделка',
      lead: { id: 'l1', clientCompanyName: 'ООО', sourceRequest: { id: 'r1', subject: 'Тема' } },
    };
    const findUnique = vi.fn().mockResolvedValue(chain);
    const prisma = { deal: { findUnique } } as never;

    expect(await loadOrderDealChain(prisma, 'order-1')).toEqual(chain);
    expect(findUnique).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      select: {
        title: true,
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

  it('заказ не из сделки → null', async () => {
    const prisma = { deal: { findUnique: vi.fn().mockResolvedValue(null) } } as never;

    expect(await loadOrderDealChain(prisma, 'order-1')).toBeNull();
  });
});
