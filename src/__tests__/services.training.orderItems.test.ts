import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrder } = vi.hoisted(() => ({ getOrder: vi.fn() }));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { listOrderItems, addOrderItem, updateItemStatus } from '@/lib/services/training/orderItems';

function session(role: string) {
  return { sub: 'u1', role, managerRole: null, companyId: 'c1' } as any;
}

const prisma = {
  orderItem: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  trainingDirection: { findUnique: vi.fn() },
  student: { findUnique: vi.fn() },
} as any;

beforeEach(() => vi.clearAllMocks());

describe('orderItems service', () => {
  it('listOrderItems → forbidden, если заказ вне scope', async () => {
    getOrder.mockResolvedValue(null);
    const res = await listOrderItems(prisma, session('manager'), { orderId: 'o1' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('listOrderItems возвращает позиции для видимого заказа', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.orderItem.findMany.mockResolvedValue([{ id: 'it1' }]);
    const res = await listOrderItems(prisma, session('manager'), { orderId: 'o1' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.items).toHaveLength(1);
  });

  it('PII: listOrderItems журналирует studentId каждой позиции', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'it1', studentId: 's1' },
      { id: 'it2', studentId: 's2' },
    ]);
    const res = await listOrderItems(prisma, session('manager'), { orderId: 'o1' });
    expect(res.ok).toBe(true);
    expect(recordPiiAccess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        context: 'order_items_list',
        subjectIds: ['s1', 's2'],
      })
    );
  });

  it('PII: listOrderItems не журналирует на ветке forbidden', async () => {
    getOrder.mockResolvedValue(null);
    await listOrderItems(prisma, session('manager'), { orderId: 'o1' });
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('addOrderItem запрещён партнёру', async () => {
    const res = await addOrderItem(prisma, session('partner'), {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'd1',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('addOrderItem отклоняет неактивное направление', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: false });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'd1',
    });
    expect(res).toEqual({ ok: false, error: 'direction_inactive' });
  });

  it('addOrderItem отклоняет сотрудника не из организации заказа', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'OTHER' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: true });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'd1',
    });
    expect(res).toEqual({ ok: false, error: 'student_mismatch' });
  });

  it('addOrderItem создаёт позицию + пишет audit', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: true });
    prisma.orderItem.create.mockResolvedValue({ id: 'it1' });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'd1',
    });
    expect(res.ok).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'order_item_added' })
    );
  });

  it('addOrderItem ловит дубль (P2002) → duplicate_position', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: true });
    prisma.orderItem.create.mockRejectedValue({ code: 'P2002' });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'd1',
    });
    expect(res).toEqual({ ok: false, error: 'duplicate_position' });
  });

  it('updateItemStatus меняет статус видимой позиции', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({ id: 'it1', orderId: 'o1' });
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.orderItem.update.mockResolvedValue({ id: 'it1', trainingStatus: 'in_progress' });
    const res = await updateItemStatus(prisma, session('manager'), {
      itemId: 'it1',
      trainingStatus: 'in_progress',
    });
    expect(res.ok).toBe(true);
  });
});
