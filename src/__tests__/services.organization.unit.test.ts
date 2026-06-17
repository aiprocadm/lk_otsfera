/**
 * Unit tests for organization service files (mock prisma, no live DB).
 * Covers branches not reached by the existing integration-only tests.
 *
 * Files covered:
 *  - src/lib/services/organization/dashboard.ts
 *  - src/lib/services/organization/finance.ts
 *  - src/lib/services/organization/students.ts
 *  - src/lib/services/organization/documents.ts
 *  - src/lib/services/organization/orders.ts
 *  - src/lib/services/organization/team.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Module mocks — must be at top before any import of the tested modules
// ---------------------------------------------------------------------------

/** team.ts → @/lib/auth/passwordReset */
const { createInviteTokenMock } = vi.hoisted(() => ({
  createInviteTokenMock: vi.fn(),
}));
vi.mock('@/lib/auth/passwordReset', () => ({
  createInviteToken: createInviteTokenMock,
}));

/** team.ts (and others) → @/lib/auth/audit */
const { recordAuditMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({
  recordAudit: recordAuditMock,
}));

/** finance.ts → @/lib/services/commission/calculator */
const { calculateCommissionMock } = vi.hoisted(() => ({
  calculateCommissionMock: vi.fn(),
}));
vi.mock('@/lib/services/commission/calculator', () => ({
  calculateCommission: calculateCommissionMock,
}));

// ===========================================================================
// src/lib/services/organization/dashboard.ts
// ===========================================================================
import { kpis, attention, recentEvents } from '@/lib/services/organization/dashboard';

describe('organization/dashboard — kpis (unit)', () => {
  it('returns zeros when all queries return empty', async () => {
    const prisma = {
      order: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      student: { count: vi.fn().mockResolvedValue(0) },
      document: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;

    const result = await kpis(prisma, 'org-1');
    expect(result.activeOrders).toBe(0);
    expect(result.outstandingAmount).toBe('0.00');
    expect(result.studentsCount).toBe(0);
    expect(result.recentDocumentsCount).toBe(0);
  });

  it('sums outstanding from billed orders', async () => {
    const prisma = {
      order: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          { totalAmount: new Prisma.Decimal('100000'), paidAmount: new Prisma.Decimal('30000') },
          { totalAmount: new Prisma.Decimal('50000'), paidAmount: new Prisma.Decimal('50000') },
        ]),
      },
      student: { count: vi.fn().mockResolvedValue(5) },
      document: { count: vi.fn().mockResolvedValue(3) },
    } as unknown as PrismaClient;

    const result = await kpis(prisma, 'org-1');
    expect(result.activeOrders).toBe(2);
    expect(result.outstandingAmount).toBe('70000.00');
    expect(result.studentsCount).toBe(5);
    expect(result.recentDocumentsCount).toBe(3);
  });
});

describe('organization/dashboard — attention (unit)', () => {
  it('returns empty items when all queries return empty', async () => {
    const prisma = {
      order: { findMany: vi.fn().mockResolvedValue([]) },
      document: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await attention(prisma, 'org-1');
    expect(result.items).toEqual([]);
  });

  it('maps billedUnpaid orders with orderNumber', async () => {
    const prisma = {
      order: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            { id: 'o1', orderNumber: 'ЗАК-001', title: 'Заказ A', totalAmount: new Prisma.Decimal('100000'), paidAmount: new Prisma.Decimal('0') },
          ])
          .mockResolvedValueOnce([]),
      },
      document: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await attention(prisma, 'org-1');
    const billed = result.items.filter((i) => i.kind === 'billed_unpaid');
    expect(billed).toHaveLength(1);
    expect(billed[0].title).toContain('ЗАК-001');
    expect(billed[0].orderId).toBe('o1');
    expect(billed[0].severity).toBe('urgent');
    expect(billed[0].meta).toContain('₽');
  });

  it('maps billedUnpaid orders without orderNumber → uses title', async () => {
    const prisma = {
      order: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            { id: 'o2', orderNumber: null, title: 'Безномерной заказ', totalAmount: new Prisma.Decimal('50000'), paidAmount: new Prisma.Decimal('0') },
          ])
          .mockResolvedValueOnce([]),
      },
      document: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await attention(prisma, 'org-1');
    const billed = result.items.filter((i) => i.kind === 'billed_unpaid');
    expect(billed[0].title).toContain('Безномерной заказ');
  });

  it('maps unsignedActs with order.orderNumber as meta', async () => {
    const prisma = {
      order: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
      },
      document: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'd1', name: 'Акт-1.pdf', orderId: 'o3', order: { orderNumber: 'ЗАК-003' } },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await attention(prisma, 'org-1');
    const acts = result.items.filter((i) => i.kind === 'unsigned_act');
    expect(acts).toHaveLength(1);
    expect(acts[0].title).toContain('Акт-1.pdf');
    expect(acts[0].meta).toBe('ЗАК-003');
    expect(acts[0].severity).toBe('warn');
  });

  it('maps unsignedActs with null order.orderNumber → meta is undefined', async () => {
    const prisma = {
      order: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
      },
      document: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'd2', name: 'Акт-2.pdf', orderId: 'o4', order: { orderNumber: null } },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await attention(prisma, 'org-1');
    const acts = result.items.filter((i) => i.kind === 'unsigned_act');
    expect(acts[0].meta).toBeUndefined();
  });

  it('maps completedOpen orders with orderNumber', async () => {
    const prisma = {
      order: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { id: 'o5', orderNumber: 'ЗАК-005', title: 'Готов' },
          ]),
      },
      document: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await attention(prisma, 'org-1');
    const closed = result.items.filter((i) => i.kind === 'completed_open');
    expect(closed).toHaveLength(1);
    expect(closed[0].title).toContain('ЗАК-005');
    expect(closed[0].severity).toBe('warn');
  });

  it('maps completedOpen orders without orderNumber → uses title', async () => {
    const prisma = {
      order: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { id: 'o6', orderNumber: null, title: 'Безномерной завершённый' },
          ]),
      },
      document: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await attention(prisma, 'org-1');
    const closed = result.items.filter((i) => i.kind === 'completed_open');
    expect(closed[0].title).toContain('Безномерной завершённый');
  });
});

describe('organization/dashboard — recentEvents (unit)', () => {
  it('returns sorted events with correct kinds', async () => {
    const t1 = new Date('2026-06-10T10:00:00Z');
    const t2 = new Date('2026-06-09T10:00:00Z');
    const t3 = new Date('2026-06-08T10:00:00Z');
    const t4 = new Date('2026-06-07T10:00:00Z');

    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'doc1', name: 'Договор.pdf', createdAt: t1, orderId: 'o1' },
        ]),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'pay1', amount: new Prisma.Decimal('5000'), paidAt: t2, orderId: 'o1' },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'aud1', entityId: 'o1', createdAt: t3, meta: {} },
        ]),
      },
      comment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cmt1', createdAt: t4, orderId: 'o1', body: 'Комментарий к заказу' },
        ]),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'o1' },
        ]),
      },
    } as unknown as PrismaClient;

    const events = await recentEvents(prisma, 'org-1', 20);
    expect(events[0].kind).toBe('document_published');
    expect(events[0].id).toBe('doc-doc1');
    expect(events[1].kind).toBe('payment_received');
    expect(events[2].kind).toBe('order_status_changed');
    expect(events[3].kind).toBe('comment_posted');
    expect(events[3].title).toContain('Комментарий к заказу');
  });

  it('skips audit entries for orders not in org', async () => {
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'aud2', entityId: 'foreign-order', createdAt: new Date(), meta: {} },
        ]),
      },
      comment: { findMany: vi.fn().mockResolvedValue([]) },
      order: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const events = await recentEvents(prisma, 'org-1', 20);
    expect(events.filter((e) => e.kind === 'order_status_changed')).toHaveLength(0);
  });

  it('skips order.findMany call when auditOrderIds is empty', async () => {
    const orderFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { findMany: vi.fn().mockResolvedValue([]) },
      comment: { findMany: vi.fn().mockResolvedValue([]) },
      order: { findMany: orderFindMany },
    } as unknown as PrismaClient;

    await recentEvents(prisma, 'org-1', 20);
    expect(orderFindMany).not.toHaveBeenCalled();
  });

  it('truncates long comment body with ellipsis', async () => {
    const longBody = 'А'.repeat(100);
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { findMany: vi.fn().mockResolvedValue([]) },
      comment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cmt2', createdAt: new Date(), orderId: 'o1', body: longBody },
        ]),
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const events = await recentEvents(prisma, 'org-1', 20);
    const commentEvent = events.find((e) => e.kind === 'comment_posted');
    expect(commentEvent?.title.endsWith('…')).toBe(true);
  });

  it('short comment body does not get ellipsis', async () => {
    const shortBody = 'Краткий комментарий';
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { findMany: vi.fn().mockResolvedValue([]) },
      comment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cmt3', createdAt: new Date(), orderId: 'o1', body: shortBody },
        ]),
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const events = await recentEvents(prisma, 'org-1', 20);
    const commentEvent = events.find((e) => e.kind === 'comment_posted');
    expect(commentEvent?.title).not.toContain('…');
    expect(commentEvent?.title).toContain(shortBody);
  });

  it('respects take parameter (default 15)', async () => {
    const manyDocs = Array.from({ length: 25 }, (_, i) => ({
      id: `doc${i}`, name: `doc${i}.pdf`, createdAt: new Date(Date.now() - i * 1000), orderId: 'o1',
    }));
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue(manyDocs) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { findMany: vi.fn().mockResolvedValue([]) },
      comment: { findMany: vi.fn().mockResolvedValue([]) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const events = await recentEvents(prisma, 'org-1');
    expect(events).toHaveLength(15);
  });
});

// ===========================================================================
// src/lib/services/organization/finance.ts
// ===========================================================================
import { getOrgFinanceKpis, listOrgPayments, getOrgIntermediaryCommission } from '@/lib/services/organization/finance';

describe('organization/finance (unit)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getOrgFinanceKpis: empty orders → all zeros', async () => {
    const prisma = {
      order: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await getOrgFinanceKpis(prisma, 'org-1');
    expect(result.billed).toBe('0.00');
    expect(result.paid).toBe('0.00');
    expect(result.outstanding).toBe('0.00');
  });

  it('getOrgFinanceKpis: sums billed and paid correctly', async () => {
    const prisma = {
      order: {
        findMany: vi.fn().mockResolvedValue([
          { totalAmount: new Prisma.Decimal('100000'), paidAmount: new Prisma.Decimal('40000') },
          { totalAmount: new Prisma.Decimal('50000'), paidAmount: new Prisma.Decimal('50000') },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await getOrgFinanceKpis(prisma, 'org-1');
    expect(result.billed).toBe('150000.00');
    expect(result.paid).toBe('90000.00');
    expect(result.outstanding).toBe('60000.00');
  });

  it('listOrgPayments: maps rows with order data', async () => {
    const prisma = {
      payment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pay1', amount: new Prisma.Decimal('5000'), paidAt: new Date('2026-06-01'),
            method: 'bank', isRefund: false, note: null,
            order: { id: 'o1', orderNumber: 'ЗАК-001' },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const rows = await listOrgPayments(prisma, { organizationId: 'org-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe('5000.00');
    expect(rows[0].orderId).toBe('o1');
    expect(rows[0].orderNumber).toBe('ЗАК-001');
    expect(rows[0].isRefund).toBe(false);
  });

  it('listOrgPayments: order-less payment → orderId/orderNumber null', async () => {
    const prisma = {
      payment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pay2', amount: new Prisma.Decimal('12345'), paidAt: new Date('2026-06-01'),
            method: null, isRefund: false, note: null,
            order: null,
          },
        ]),
      },
    } as unknown as PrismaClient;

    const rows = await listOrgPayments(prisma, { organizationId: 'org-1' });
    expect(rows[0].orderId).toBeNull();
    expect(rows[0].orderNumber).toBeNull();
  });

  it('listOrgPayments: custom take is passed through', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { payment: { findMany } } as unknown as PrismaClient;

    await listOrgPayments(prisma, { organizationId: 'org-1', take: 10 });
    expect(findMany.mock.calls[0][0].take).toBe(10);
  });

  it('getOrgIntermediaryCommission: org not found → zero result', async () => {
    const prisma = {
      organization: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    const result = await getOrgIntermediaryCommission(prisma, 'org-1');
    expect(result).toEqual({ effectiveRate: '0', totalCommission: '0.00', perOrder: [] });
  });

  it('getOrgIntermediaryCommission: no rate (no override, no partner) → zero result', async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          name: 'ОргБезПартнёра',
          partnerCommissionRate: null,
          partner: null,
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgIntermediaryCommission(prisma, 'org-1');
    expect(result).toEqual({ effectiveRate: '0', totalCommission: '0.00', perOrder: [] });
  });

  it('getOrgIntermediaryCommission: org override rate → uses override, not partner rate', async () => {
    calculateCommissionMock.mockReturnValue({
      totals: { totalCommissionAmount: new Prisma.Decimal('15000') },
      items: [
        { orderId: 'o1', orderNumber: 'ЗАК-001', baseAmount: new Prisma.Decimal('100000'), commissionAmount: new Prisma.Decimal('15000') },
      ],
    });
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          name: 'ОргСПереопределением',
          partnerCommissionRate: new Prisma.Decimal('0.15'),
          partner: { commissionRate: new Prisma.Decimal('0.1') },
        }),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'o1', orderNumber: 'ЗАК-001', totalAmount: new Prisma.Decimal('100000'), vatIncluded: true, vatRate: null },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await getOrgIntermediaryCommission(prisma, 'org-1');
    expect(result.effectiveRate).toBe('0.15');
    expect(result.totalCommission).toBe('15000.00');
    expect(result.perOrder).toHaveLength(1);
  });

  it('getOrgIntermediaryCommission: no org override → falls back to partner rate', async () => {
    calculateCommissionMock.mockReturnValue({
      totals: { totalCommissionAmount: new Prisma.Decimal('1000') },
      items: [
        { orderId: 'o1', orderNumber: null, baseAmount: new Prisma.Decimal('10000'), commissionAmount: new Prisma.Decimal('1000') },
      ],
    });
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          name: 'ОргСПартнёром',
          partnerCommissionRate: null,
          partner: { commissionRate: new Prisma.Decimal('0.1') },
        }),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'o1', orderNumber: null, totalAmount: new Prisma.Decimal('10000'), vatIncluded: true, vatRate: null },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await getOrgIntermediaryCommission(prisma, 'org-1');
    expect(result.effectiveRate).toBe('0.1');
  });
});

// ===========================================================================
// src/lib/services/organization/students.ts
// ===========================================================================
import { listOrgStudents } from '@/lib/services/organization/students';

describe('organization/students (unit)', () => {
  it('returns empty result', async () => {
    const prisma = {
      student: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgStudents(prisma, { organizationId: 'org-1' });
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('returns students with correct shape', async () => {
    const student = {
      id: 's1', name: 'Иван Петров', email: 'ivan@demo.local',
      externalStudentId: 'EXT-001', createdAt: new Date('2026-01-01'),
    };
    const prisma = {
      student: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([student]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgStudents(prisma, { organizationId: 'org-1' });
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject(student);
  });

  it('applies search filter via OR clause', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { student: { count, findMany } } as unknown as PrismaClient;

    await listOrgStudents(prisma, { organizationId: 'org-1', search: 'ivan' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
    expect(whereArg.OR[0]).toEqual({ name: { contains: 'ivan', mode: 'insensitive' } });
    expect(whereArg.OR[1]).toEqual({ email: { contains: 'ivan', mode: 'insensitive' } });
  });

  it('no search → no OR clause', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { student: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgStudents(prisma, { organizationId: 'org-1' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeUndefined();
  });

  it('normalizeTake: undefined → 50', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { student: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgStudents(prisma, { organizationId: 'org-1' });
    expect(findMany.mock.calls[0][0].take).toBe(50);
  });

  it('normalizeTake: 0 (invalid) → 50', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { student: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgStudents(prisma, { organizationId: 'org-1', take: 0 });
    expect(findMany.mock.calls[0][0].take).toBe(50);
  });

  it('normalizeTake: 999 → clamped to 200', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { student: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgStudents(prisma, { organizationId: 'org-1', take: 999 });
    expect(findMany.mock.calls[0][0].take).toBe(200);
  });

  it('normalizeSkip: negative → 0', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { student: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgStudents(prisma, { organizationId: 'org-1', skip: -5 });
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it('normalizeSkip: 10 → 10', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { student: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgStudents(prisma, { organizationId: 'org-1', skip: 10 });
    expect(findMany.mock.calls[0][0].skip).toBe(10);
  });

  it('externalStudentId can be null', async () => {
    const prisma = {
      student: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          { id: 's2', name: 'Мария', email: 'm@demo.local', externalStudentId: null, createdAt: new Date() },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgStudents(prisma, { organizationId: 'org-1' });
    expect(result.rows[0].externalStudentId).toBeNull();
  });
});

// ===========================================================================
// src/lib/services/organization/documents.ts
// ===========================================================================
import { listOrgDocuments, getOrgDocumentForDownload } from '@/lib/services/organization/documents';

describe('organization/documents (unit)', () => {
  it('listOrgDocuments: returns empty result', async () => {
    const prisma = {
      document: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgDocuments(prisma, { organizationId: 'org-1' });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.countsByType).toEqual({});
  });

  it('listOrgDocuments: maps rows with order fields', async () => {
    const now = new Date('2026-06-10');
    const prisma = {
      document: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'd1', name: 'doc.pdf', type: 'contract', direction: 'inbound',
            signedAt: null, createdAt: now, size: 1024, orderId: 'o1',
            order: { orderNumber: 'ЗАК-001', title: 'Заказ 1' },
          },
        ]),
        groupBy: vi.fn().mockResolvedValue([
          { type: 'contract', _count: { _all: 1 } },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgDocuments(prisma, { organizationId: 'org-1' });
    expect(result.rows[0]).toMatchObject({
      id: 'd1', name: 'doc.pdf', type: 'contract',
      orderNumber: 'ЗАК-001', orderTitle: 'Заказ 1',
    });
    expect(result.countsByType.contract).toBe(1);
  });

  it('listOrgDocuments: null order → orderNumber/orderTitle null', async () => {
    const prisma = {
      document: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'd2', name: 'orderless.pdf', type: 'other', direction: 'outbound',
            signedAt: null, createdAt: new Date(), size: null, orderId: null,
            order: null,
          },
        ]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgDocuments(prisma, { organizationId: 'org-1', orderLess: true });
    expect(result.rows[0].orderNumber).toBeNull();
    expect(result.rows[0].orderTitle).toBeNull();
  });

  it('listOrgDocuments: date filter from only → gte set, lte undefined', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: {
        count: vi.fn().mockResolvedValue(0),
        findMany,
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const from = new Date('2026-05-01');
    await listOrgDocuments(prisma, { organizationId: 'org-1', from });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.createdAt?.gte).toEqual(from);
    expect(whereArg.createdAt?.lte).toBeUndefined();
  });

  it('listOrgDocuments: date filter to only → lte set, gte undefined', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: {
        count: vi.fn().mockResolvedValue(0),
        findMany,
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const to = new Date('2026-06-01');
    await listOrgDocuments(prisma, { organizationId: 'org-1', to });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.createdAt?.lte).toEqual(to);
    expect(whereArg.createdAt?.gte).toBeUndefined();
  });

  it('listOrgDocuments: no date filter → no createdAt key in where', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: {
        count: vi.fn().mockResolvedValue(0),
        findMany,
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.createdAt).toBeUndefined();
  });

  it('listOrgDocuments: type filter applied', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: {
        count: vi.fn().mockResolvedValue(0),
        findMany,
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', type: 'act' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.type).toBe('act');
  });

  it('listOrgDocuments: normalizeTake invalid (-5) → 50', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { count: vi.fn().mockResolvedValue(0), findMany, groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', take: -5 });
    expect(findMany.mock.calls[0][0].take).toBe(50);
  });

  it('listOrgDocuments: normalizeSkip negative (-10) → 0', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { count: vi.fn().mockResolvedValue(0), findMany, groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', skip: -10 });
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it('getOrgDocumentForDownload: not found → {ok:false, error:"not_found"}', async () => {
    const prisma = {
      document: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    const result = await getOrgDocumentForDownload(prisma, 'org-1', 'missing');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('getOrgDocumentForDownload: doc in partner channel → silent not_found', async () => {
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'd1', name: 'partner-doc.pdf', path: 'fake://1', mimeType: 'application/pdf',
          scanStatus: 'clean', scanReason: null,
          counterpartyType: 'partner', counterpartyId: 'partner-1',
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgDocumentForDownload(prisma, 'org-1', 'd1');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('getOrgDocumentForDownload: doc for different org → silent not_found', async () => {
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'd2', name: 'other-org.pdf', path: 'fake://2', mimeType: 'application/pdf',
          scanStatus: 'clean', scanReason: null,
          counterpartyType: 'organization', counterpartyId: 'other-org', // wrong org
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgDocumentForDownload(prisma, 'org-1', 'd2');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('getOrgDocumentForDownload: infected doc → {ok:false, error:"infected"}', async () => {
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'd3', name: 'bad.pdf', path: 'fake://3', mimeType: 'application/pdf',
          scanStatus: 'infected', scanReason: 'Malware.Gen',
          counterpartyType: 'organization', counterpartyId: 'org-1',
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgDocumentForDownload(prisma, 'org-1', 'd3');
    expect(result).toMatchObject({ ok: false, error: 'infected', scanReason: 'Malware.Gen' });
  });

  it('getOrgDocumentForDownload: infected with null scanReason → scanReason: null', async () => {
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'd4', name: 'bad2.pdf', path: 'fake://4', mimeType: 'application/pdf',
          scanStatus: 'infected', scanReason: null,
          counterpartyType: 'organization', counterpartyId: 'org-1',
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgDocumentForDownload(prisma, 'org-1', 'd4');
    expect(result).toMatchObject({ ok: false, error: 'infected', scanReason: null });
  });

  it('getOrgDocumentForDownload: clean doc in org channel → ok:true with path', async () => {
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'd5', name: 'clean.pdf', path: 'fake://5', mimeType: 'application/pdf',
          scanStatus: 'clean', scanReason: null,
          counterpartyType: 'organization', counterpartyId: 'org-1',
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgDocumentForDownload(prisma, 'org-1', 'd5');
    expect(result).toEqual({ ok: true, path: 'fake://5', mimeType: 'application/pdf', name: 'clean.pdf' });
  });

  it('listOrgDocuments: normalizeTake Infinity → 50', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { count: vi.fn().mockResolvedValue(0), findMany, groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', take: Infinity });
    expect(findMany.mock.calls[0][0].take).toBe(50);
  });

  it('listOrgDocuments: normalizeSkip Infinity → 0', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { count: vi.fn().mockResolvedValue(0), findMany, groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', skip: Infinity });
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it('listOrgDocuments: valid take (10) passes through normalizeTake', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { count: vi.fn().mockResolvedValue(0), findMany, groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', take: 10 });
    expect(findMany.mock.calls[0][0].take).toBe(10);
  });

  it('listOrgDocuments: valid skip (5) passes through normalizeSkip', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { count: vi.fn().mockResolvedValue(0), findMany, groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', skip: 5 });
    expect(findMany.mock.calls[0][0].skip).toBe(5);
  });

  it('listOrgDocuments: orderId filter applied', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { count: vi.fn().mockResolvedValue(0), findMany, groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', orderId: 'o1' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.orderId).toBe('o1');
  });

  it('listOrgDocuments: search filter applied', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: { count: vi.fn().mockResolvedValue(0), findMany, groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await listOrgDocuments(prisma, { organizationId: 'org-1', search: 'договор' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.name).toEqual({ contains: 'договор', mode: 'insensitive' });
  });
});

// ===========================================================================
// src/lib/services/organization/orders.ts
// ===========================================================================
import { listOrgOrders, getOrgOrder } from '@/lib/services/organization/orders';

describe('organization/orders (unit)', () => {
  it('listOrgOrders: returns empty result', async () => {
    const prisma = {
      order: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgOrders(prisma, { organizationId: 'org-1' });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('listOrgOrders: maps row with manager name', async () => {
    const prisma = {
      order: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'o1', orderNumber: 'ЗАК-001', title: 'Тест',
            totalAmount: new Prisma.Decimal('100000'), paidAmount: new Prisma.Decimal('0'),
            executionStatus: 'in_progress', financialStatus: 'billed',
            createdAt: new Date('2026-01-01'), deadline: null,
            manager: { name: 'Иван Менеджер' },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgOrders(prisma, { organizationId: 'org-1' });
    expect(result.rows[0].managerName).toBe('Иван Менеджер');
    expect(result.rows[0].orderNumber).toBe('ЗАК-001');
    expect(result.rows[0].totalAmount).toBe('100000.00');
    expect(result.rows[0].debt).toBe('100000.00');
  });

  it('listOrgOrders: null manager → managerName null', async () => {
    const prisma = {
      order: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'o2', orderNumber: null, title: 'БезМенеджера',
            totalAmount: new Prisma.Decimal('5000'), paidAmount: new Prisma.Decimal('5000'),
            executionStatus: 'completed', financialStatus: 'paid',
            createdAt: new Date(), deadline: null,
            manager: null,
          },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await listOrgOrders(prisma, { organizationId: 'org-1' });
    expect(result.rows[0].managerName).toBeNull();
    expect(result.rows[0].orderNumber).toBeNull();
  });

  it('listOrgOrders: executionStatus filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgOrders(prisma, { organizationId: 'org-1', executionStatus: 'completed' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.executionStatus).toBe('completed');
  });

  it('listOrgOrders: financialStatus filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgOrders(prisma, { organizationId: 'org-1', financialStatus: 'paid' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.financialStatus).toBe('paid');
  });

  it('listOrgOrders: search filter builds OR clause', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgOrders(prisma, { organizationId: 'org-1', search: 'тест' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
  });

  it('listOrgOrders: no status filter → no executionStatus/financialStatus in where', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgOrders(prisma, { organizationId: 'org-1' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.executionStatus).toBeUndefined();
    expect(whereArg.financialStatus).toBeUndefined();
  });

  it('listOrgOrders: take 200 clamped to MAX_TAKE=100, skip -3 → 0', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgOrders(prisma, { organizationId: 'org-1', take: 200, skip: -3 });
    expect(findMany.mock.calls[0][0].take).toBe(100);
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it('getOrgOrder: returns null when order not found', async () => {
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    const result = await getOrgOrder(prisma, 'org-1', 'missing');
    expect(result).toBeNull();
  });

  it('getOrgOrder: returns null when order belongs to different org (IDOR guard)', async () => {
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'o1', organizationId: 'other-org',
          orderNumber: null, title: 'Чужой', totalAmount: new Prisma.Decimal('0'),
          paidAmount: new Prisma.Decimal('0'), vatIncluded: true, vatRate: null, productMix: [],
          executionStatus: 'pending', financialStatus: 'not_billed',
          createdAt: new Date(), deadline: null, contractSignedAt: null,
          completedAt: null, closedAt: null, paidAt: null, lastSyncedAt: null,
          manager: null, documents: [], payments: [], _count: { comments: 0 },
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgOrder(prisma, 'org-1', 'o1');
    expect(result).toBeNull();
  });

  it('getOrgOrder: returns full detail for org-owned order', async () => {
    const now = new Date('2026-06-01');
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'o1', organizationId: 'org-1',
          orderNumber: 'ЗАК-001', title: 'Тестовый заказ',
          totalAmount: new Prisma.Decimal('50000'), paidAmount: new Prisma.Decimal('25000'),
          vatIncluded: true, vatRate: new Prisma.Decimal('20'), productMix: ['IT'],
          executionStatus: 'in_progress', financialStatus: 'partially_paid',
          createdAt: now, deadline: null, contractSignedAt: null,
          completedAt: null, closedAt: null, paidAt: null, lastSyncedAt: null,
          manager: { name: 'Менеджер Иван' },
          documents: [
            { id: 'd1', name: 'doc.pdf', type: 'contract', direction: 'inbound', signedAt: null, createdAt: now, size: 512 },
          ],
          payments: [
            { id: 'p1', amount: new Prisma.Decimal('25000'), paidAt: now, method: 'bank', isRefund: false, note: null },
          ],
          _count: { comments: 3 },
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgOrder(prisma, 'org-1', 'o1');
    expect(result).not.toBeNull();
    expect(result!.orderNumber).toBe('ЗАК-001');
    expect(result!.managerName).toBe('Менеджер Иван');
    expect(result!.vatRate).toBe('20');
    expect(result!.documents).toHaveLength(1);
    expect(result!.payments).toHaveLength(1);
    expect(result!.commentsCount).toBe(3);
    expect(result!.totalAmount).toBe('50000.00');
    expect(result!.debt).toBe('25000.00');
  });

  it('getOrgOrder: null vatRate → null in result', async () => {
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'o2', organizationId: 'org-1',
          orderNumber: null, title: 'БезНДС',
          totalAmount: new Prisma.Decimal('10000'), paidAmount: new Prisma.Decimal('0'),
          vatIncluded: false, vatRate: null,
          productMix: [],
          executionStatus: 'pending', financialStatus: 'not_billed',
          createdAt: new Date(), deadline: null, contractSignedAt: null,
          completedAt: null, closedAt: null, paidAt: null, lastSyncedAt: null,
          manager: null, documents: [], payments: [], _count: { comments: 0 },
        }),
      },
    } as unknown as PrismaClient;

    const result = await getOrgOrder(prisma, 'org-1', 'o2');
    expect(result!.vatRate).toBeNull();
    expect(result!.managerName).toBeNull();
  });

  it('listOrgOrders: normalizeTake Infinity → 25 (DEFAULT_TAKE)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgOrders(prisma, { organizationId: 'org-1', take: Infinity });
    expect(findMany.mock.calls[0][0].take).toBe(25);
  });

  it('listOrgOrders: normalizeSkip Infinity → 0', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgOrders(prisma, { organizationId: 'org-1', skip: Infinity });
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it('listOrgOrders: valid skip (10) passes through normalizeSkip', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { count: vi.fn().mockResolvedValue(0), findMany } } as unknown as PrismaClient;

    await listOrgOrders(prisma, { organizationId: 'org-1', skip: 10 });
    expect(findMany.mock.calls[0][0].skip).toBe(10);
  });
});

// ===========================================================================
// src/lib/services/organization/team.ts
// ===========================================================================
import {
  listMembers,
  inviteMember,
  updateMemberRole,
  deactivateMember,
  reactivateMember,
  OrgMemberError,
} from '@/lib/services/organization/team';

/** Helper: create a minimal transaction mock for team tests */
function makeTx() {
  return {
    organizationUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'ou-new' }),
      update: vi.fn().mockResolvedValue({ id: 'ou-upd' }),
      count: vi.fn().mockResolvedValue(1), // default: there's at least 1 other admin
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'u-new', email: 'new@x.com', passwordHash: null }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe('organization/team — listMembers (unit)', () => {
  it('normalizes null roleInOrg to "member"', async () => {
    const prisma = {
      organizationUser: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'ou1', userId: 'u1', isActive: true, roleInOrg: 'admin', createdAt: new Date(),
            organizationId: 'org-1', user: { id: 'u1', email: 'admin@x', name: 'Admin' },
          },
          {
            id: 'ou2', userId: 'u2', isActive: true, roleInOrg: null,
            createdAt: new Date(), organizationId: 'org-1',
            user: { id: 'u2', email: 'mem@x', name: 'Member' },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const rows = await listMembers(prisma, 'org-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].roleInOrg).toBe('admin');
    expect(rows[1].roleInOrg).toBe('member');
    expect(rows[0].lastLoginAt).toBeNull();
  });

  it('returns empty array for empty org', async () => {
    const prisma = {
      organizationUser: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const rows = await listMembers(prisma, 'org-1');
    expect(rows).toEqual([]);
  });

  it('normaliseRole: "leader" value → "leader"', async () => {
    const prisma = {
      organizationUser: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'ou-l', userId: 'u-l', isActive: true, roleInOrg: 'leader',
            createdAt: new Date(), organizationId: 'org-1',
            user: { id: 'u-l', email: 'leader@x', name: 'Leader' },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const rows = await listMembers(prisma, 'org-1');
    expect(rows[0].roleInOrg).toBe('leader');
  });
});

describe('organization/team — inviteMember (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInviteTokenMock.mockResolvedValue({ token: 'invite-token-123' });
    recordAuditMock.mockResolvedValue(undefined);
  });

  it('creates new user + org membership + invite URL when no password', async () => {
    const tx = makeTx();
    tx.user.create = vi.fn().mockResolvedValue({ id: 'u-new', email: 'new@x.com', passwordHash: null });
    tx.organizationUser.create = vi.fn().mockResolvedValue({ id: 'ou-new' });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    const result = await inviteMember(
      prisma,
      { organizationId: 'org-1', email: 'new@x.com', name: 'Новый', roleInOrg: 'member' },
      'actor-1',
    );

    expect(result.user.email).toBe('new@x.com');
    expect(result.inviteUrl).toContain('/reset-password?token=invite-token-123');
    expect(result.alreadyHasPassword).toBe(false);
    expect(tx.organizationUser.create).toHaveBeenCalled();
  });

  it('existing user with password → alreadyHasPassword=true, inviteUrl null', async () => {
    const tx = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue({ id: 'u2', email: 'old@x.com', passwordHash: 'hash123' });
    tx.organizationUser.create = vi.fn().mockResolvedValue({ id: 'ou2' });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    const result = await inviteMember(
      prisma,
      { organizationId: 'org-1', email: 'old@x.com', name: 'Старый', roleInOrg: 'member' },
      'actor-1',
    );

    expect(result.inviteUrl).toBeNull();
    expect(result.alreadyHasPassword).toBe(true);
  });

  it('existing ACTIVE membership → throws already_member', async () => {
    const tx = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue({ id: 'u3', email: 'dup@x.com', passwordHash: null });
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou3', isActive: true, roleInOrg: 'member', organizationId: 'org-1',
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      inviteMember(prisma, { organizationId: 'org-1', email: 'dup@x.com', name: 'Dup', roleInOrg: 'member' }, 'actor-1'),
    ).rejects.toMatchObject({ code: 'already_member' });
  });

  it('leader cannot invite new admin → throws requires_admin (pre-transaction)', async () => {
    const prisma = {
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    await expect(
      inviteMember(
        prisma,
        { organizationId: 'org-1', email: 'new@x.com', name: 'X', roleInOrg: 'admin' },
        'actor-1',
        {},
        'leader',
      ),
    ).rejects.toMatchObject({ code: 'requires_admin' });
    expect((prisma.$transaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('leader cannot re-invite deactivated admin → throws requires_admin', async () => {
    const tx = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue({ id: 'u4', email: 'admin@x.com', passwordHash: 'x' });
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou4', isActive: false, roleInOrg: 'admin', organizationId: 'org-1',
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      inviteMember(
        prisma,
        { organizationId: 'org-1', email: 'admin@x.com', name: 'Admin', roleInOrg: 'member' },
        'actor-1',
        {},
        'leader',
      ),
    ).rejects.toMatchObject({ code: 'requires_admin' });
  });

  it('reactivates deactivated membership with new role', async () => {
    const tx = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue({ id: 'u5', email: 'old@x.com', passwordHash: 'x' });
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou5', isActive: false, roleInOrg: 'member', organizationId: 'org-1',
    });
    tx.organizationUser.update = vi.fn().mockResolvedValue({ id: 'ou5' });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    const result = await inviteMember(
      prisma,
      { organizationId: 'org-1', email: 'old@x.com', name: 'Old', roleInOrg: 'leader' },
      'actor-1',
    );

    expect(result.user.email).toBe('old@x.com');
    expect(tx.organizationUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: true, roleInOrg: 'leader' } }),
    );
  });

  it('audit includes source when provided', async () => {
    const tx = makeTx();
    tx.user.create = vi.fn().mockResolvedValue({ id: 'u6', email: 'n@x.com', passwordHash: null });
    tx.organizationUser.create = vi.fn().mockResolvedValue({ id: 'ou6' });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await inviteMember(
      prisma,
      { organizationId: 'org-1', email: 'n@x.com', name: 'N', roleInOrg: 'member' },
      'actor-1',
      { source: 'partner' },
    );

    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({ source: 'partner' }),
      }),
    );
  });

  it('audit omits source when not provided', async () => {
    const tx = makeTx();
    tx.user.create = vi.fn().mockResolvedValue({ id: 'u7', email: 'n7@x.com', passwordHash: null });
    tx.organizationUser.create = vi.fn().mockResolvedValue({ id: 'ou7' });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await inviteMember(
      prisma,
      { organizationId: 'org-1', email: 'n7@x.com', name: 'N7', roleInOrg: 'member' },
      'actor-1',
    );

    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.not.objectContaining({ source: expect.anything() }),
      }),
    );
  });

  it('invite URL uses APP_URL env when set', async () => {
    const originalAppUrl = process.env.APP_URL;
    process.env.APP_URL = 'https://custom.example.com';
    try {
      createInviteTokenMock.mockResolvedValue({ token: 'tk-custom' });
      recordAuditMock.mockResolvedValue(undefined);
      const tx = makeTx();
      tx.user.create = vi.fn().mockResolvedValue({ id: 'u-c', email: 'custom@x.com', passwordHash: null });
      tx.organizationUser.create = vi.fn().mockResolvedValue({ id: 'ou-c' });

      const prisma = {
        $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
      } as unknown as PrismaClient;

      const result = await inviteMember(
        prisma,
        { organizationId: 'org-1', email: 'custom@x.com', name: 'Custom', roleInOrg: 'member' },
        'actor-1',
      );

      expect(result.inviteUrl).toContain('https://custom.example.com/reset-password?token=tk-custom');
    } finally {
      process.env.APP_URL = originalAppUrl;
    }
  });
});

describe('organization/team — updateMemberRole (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAuditMock.mockResolvedValue(undefined);
  });

  it('not_found when orgUser does not exist', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue(null);

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      updateMemberRole(prisma, 'org-1', 'ou-missing', 'admin', 'actor-1'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('not_found when orgUser belongs to different org (cross-tenant guard)', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou1', userId: 'u1', organizationId: 'other-org', roleInOrg: 'member', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      updateMemberRole(prisma, 'org-1', 'ou1', 'admin', 'actor-1'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('self_action_forbidden when actor targets themselves', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou1', userId: 'actor-1', organizationId: 'org-1', roleInOrg: 'admin', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      updateMemberRole(prisma, 'org-1', 'ou1', 'member', 'actor-1'),
    ).rejects.toMatchObject({ code: 'self_action_forbidden' });
  });

  it('leader cannot promote to admin', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou2', userId: 'u2', organizationId: 'org-1', roleInOrg: 'member', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      updateMemberRole(prisma, 'org-1', 'ou2', 'admin', 'actor-1', 'leader'),
    ).rejects.toMatchObject({ code: 'requires_admin' });
  });

  it('leader cannot change role of existing admin', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou3', userId: 'u3', organizationId: 'org-1', roleInOrg: 'admin', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      updateMemberRole(prisma, 'org-1', 'ou3', 'member', 'actor-1', 'leader'),
    ).rejects.toMatchObject({ code: 'requires_admin' });
  });

  it('no-op when newRole === currentRole (non-leader touching non-admin)', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou4', userId: 'u4', organizationId: 'org-1', roleInOrg: 'member', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await updateMemberRole(prisma, 'org-1', 'ou4', 'member', 'actor-1');
    expect(tx.organizationUser.update).not.toHaveBeenCalled();
  });

  it('demoting last admin → last_admin_protected', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou5', userId: 'u5', organizationId: 'org-1', roleInOrg: 'admin', isActive: true,
    });
    tx.organizationUser.count = vi.fn().mockResolvedValue(0); // last admin

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      updateMemberRole(prisma, 'org-1', 'ou5', 'member', 'actor-1'),
    ).rejects.toMatchObject({ code: 'last_admin_protected' });
  });

  it('promotes member to admin and writes audit', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou6', userId: 'u6', organizationId: 'org-1', roleInOrg: 'member', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await updateMemberRole(prisma, 'org-1', 'ou6', 'admin', 'actor-1');
    expect(tx.organizationUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { roleInOrg: 'admin' } }),
    );
    expect(recordAuditMock).toHaveBeenCalled();
  });

  it('demotes admin to member (with other admins remaining) and writes audit', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou7', userId: 'u7', organizationId: 'org-1', roleInOrg: 'admin', isActive: true,
    });
    tx.organizationUser.count = vi.fn().mockResolvedValue(2); // 2 other admins remain

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await updateMemberRole(prisma, 'org-1', 'ou7', 'member', 'actor-1');
    expect(tx.organizationUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { roleInOrg: 'member' } }),
    );
  });
});

describe('organization/team — deactivateMember (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAuditMock.mockResolvedValue(undefined);
  });

  it('self_action_forbidden when actor targets themselves', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou0', userId: 'actor-1', organizationId: 'org-1', roleInOrg: 'member', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      deactivateMember(prisma, 'org-1', 'ou0', 'actor-1'),
    ).rejects.toMatchObject({ code: 'self_action_forbidden' });
  });

  it('leader cannot deactivate admin', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou3', userId: 'u3', organizationId: 'org-1', roleInOrg: 'admin', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      deactivateMember(prisma, 'org-1', 'ou3', 'actor-1', 'leader'),
    ).rejects.toMatchObject({ code: 'requires_admin' });
  });

  it('no-op when member already inactive', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou1', userId: 'u1', organizationId: 'org-1', roleInOrg: 'member', isActive: false,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await deactivateMember(prisma, 'org-1', 'ou1', 'actor-1');
    expect(tx.organizationUser.update).not.toHaveBeenCalled();
  });

  it('deactivates non-admin member', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou2', userId: 'u2', organizationId: 'org-1', roleInOrg: 'member', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await deactivateMember(prisma, 'org-1', 'ou2', 'actor-1');
    expect(tx.organizationUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it('deactivating last admin → last_admin_protected', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou4', userId: 'u4', organizationId: 'org-1', roleInOrg: 'admin', isActive: true,
    });
    tx.organizationUser.count = vi.fn().mockResolvedValue(0); // last admin

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      deactivateMember(prisma, 'org-1', 'ou4', 'actor-1'),
    ).rejects.toMatchObject({ code: 'last_admin_protected' });
  });

  it('deactivates admin when other admins exist', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou5', userId: 'u5', organizationId: 'org-1', roleInOrg: 'admin', isActive: true,
    });
    tx.organizationUser.count = vi.fn().mockResolvedValue(1); // 1 other admin

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await deactivateMember(prisma, 'org-1', 'ou5', 'actor-1');
    expect(tx.organizationUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });
});

describe('organization/team — reactivateMember (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAuditMock.mockResolvedValue(undefined);
  });

  it('self_action_forbidden when actor reactivates themselves', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou0', userId: 'actor-1', organizationId: 'org-1', roleInOrg: 'member', isActive: false,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      reactivateMember(prisma, 'org-1', 'ou0', 'actor-1'),
    ).rejects.toMatchObject({ code: 'self_action_forbidden' });
  });

  it('leader cannot reactivate admin', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou4', userId: 'u4', organizationId: 'org-1', roleInOrg: 'admin', isActive: false,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      reactivateMember(prisma, 'org-1', 'ou4', 'actor-1', 'leader'),
    ).rejects.toMatchObject({ code: 'requires_admin' });
  });

  it('no-op when member already active', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou1', userId: 'u1', organizationId: 'org-1', roleInOrg: 'member', isActive: true,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await reactivateMember(prisma, 'org-1', 'ou1', 'actor-1');
    expect(tx.organizationUser.update).not.toHaveBeenCalled();
  });

  it('reactivates inactive member and writes audit', async () => {
    const tx = makeTx();
    tx.organizationUser.findUnique = vi.fn().mockResolvedValue({
      id: 'ou2', userId: 'u2', organizationId: 'org-1', roleInOrg: 'member', isActive: false,
    });

    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await reactivateMember(prisma, 'org-1', 'ou2', 'actor-1');
    expect(tx.organizationUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );
    expect(recordAuditMock).toHaveBeenCalled();
  });
});

describe('organization/team — OrgMemberError (unit)', () => {
  it('has correct code, name, and is an Error instance', () => {
    const err = new OrgMemberError('last_admin_protected');
    expect(err.code).toBe('last_admin_protected');
    expect(err.name).toBe('OrgMemberError');
    expect(err).toBeInstanceOf(Error);
  });

  it('message equals the code', () => {
    const err = new OrgMemberError('not_found');
    expect(err.message).toBe('not_found');
  });
});

// ===========================================================================
// src/lib/services/organization/invite.ts
// ===========================================================================
import { createOrgAdminInvite, OrgInviteError } from '@/lib/services/organization/invite';

describe('organization/invite — createOrgAdminInvite (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makePrisma(orgResult: unknown, txOverrides: Record<string, unknown> = {}) {
    const tx: Record<string, unknown> = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'u-new', email: 'inv@x.com', passwordHash: null }),
      },
      organizationUser: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      ...txOverrides,
    };
    return {
      organization: { findUnique: vi.fn().mockResolvedValue(orgResult) },
      $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;
  }

  it('throws OrgInviteError(not_found) when org does not exist', async () => {
    const prisma = makePrisma(null);
    await expect(
      createOrgAdminInvite(
        prisma,
        { organizationId: 'org-1', email: 'a@b.com', name: 'Alice' },
        { actorUserId: 'actor-1', source: 'platform_admin' },
      ),
    ).rejects.toMatchObject({ code: 'not_found', name: 'OrgInviteError' });
  });

  it('throws OrgInviteError(forbidden) when partner actorPartnerId does not match org.partnerId', async () => {
    const prisma = makePrisma({ id: 'org-1', partnerId: 'partner-A' });
    await expect(
      createOrgAdminInvite(
        prisma,
        { organizationId: 'org-1', email: 'b@c.com', name: 'Bob' },
        { actorUserId: 'actor-2', source: 'partner', actorPartnerId: 'partner-B' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden', name: 'OrgInviteError' });
  });

  it('throws OrgInviteError(forbidden) when source=partner but actorPartnerId is null', async () => {
    const prisma = makePrisma({ id: 'org-1', partnerId: 'partner-A' });
    await expect(
      createOrgAdminInvite(
        prisma,
        { organizationId: 'org-1', email: 'c@d.com', name: 'Carol' },
        { actorUserId: 'actor-3', source: 'partner', actorPartnerId: null },
      ),
    ).rejects.toMatchObject({ code: 'forbidden', name: 'OrgInviteError' });
  });

  it('succeeds as platform_admin for any org (calls inviteMember)', async () => {
    createInviteTokenMock.mockResolvedValue({ token: 'tok-xyz' });
    recordAuditMock.mockResolvedValue(undefined);
    const prisma = makePrisma({ id: 'org-1', partnerId: 'partner-A' });
    // inviteMember will be called; we just verify no exception is thrown
    await expect(
      createOrgAdminInvite(
        prisma,
        { organizationId: 'org-1', email: 'admin@x.com', name: 'Admin' },
        { actorUserId: 'actor-admin', source: 'platform_admin' },
      ),
    ).resolves.toBeDefined();
  });

  it('succeeds as partner when actorPartnerId matches org.partnerId', async () => {
    createInviteTokenMock.mockResolvedValue({ token: 'tok-abc' });
    recordAuditMock.mockResolvedValue(undefined);
    const prisma = makePrisma({ id: 'org-1', partnerId: 'partner-A' });
    await expect(
      createOrgAdminInvite(
        prisma,
        { organizationId: 'org-1', email: 'pmatch@x.com', name: 'Partner Admin' },
        { actorUserId: 'actor-partner', source: 'partner', actorPartnerId: 'partner-A' },
      ),
    ).resolves.toBeDefined();
  });

  it('OrgInviteError has correct code, name, and is an Error instance', () => {
    const err = new OrgInviteError('forbidden');
    expect(err.code).toBe('forbidden');
    expect(err.name).toBe('OrgInviteError');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('forbidden');
  });
});
