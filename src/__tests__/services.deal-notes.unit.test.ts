import { it, expect, vi, beforeEach } from 'vitest';

const { getOrder, recordAudit } = vi.hoisted(() => ({ getOrder: vi.fn(), recordAudit: vi.fn() }));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { addDealNote } from '@/lib/services/manager/dealNotes';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as never;
beforeEach(() => vi.clearAllMocks());

it('rejects empty body as invalid', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = { dealNote: { create: vi.fn() } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: '  ' });
  expect(res).toEqual({ ok: false, error: 'invalid' });
});

it('treats a missing body as invalid (no throw at the boundary)', async () => {
  const prisma = { dealNote: { create: vi.fn() } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: undefined as never });
  expect(res).toEqual({ ok: false, error: 'invalid' });
});

it('returns not_found when order not visible', async () => {
  getOrder.mockResolvedValue(null);
  const prisma = { dealNote: { create: vi.fn() } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: 'hi' });
  expect(res).toEqual({ ok: false, error: 'not_found' });
});

it('creates note + audit on success', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const create = vi.fn().mockResolvedValue({ id: 'n1' });
  const prisma = { dealNote: { create } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: 'скидка 5%' });
  expect(res).toEqual({ ok: true, id: 'n1' });
  expect(create).toHaveBeenCalledWith({ data: { orderId: 'o1', authorId: 'u1', body: 'скидка 5%' }, select: { id: true } });
  expect(recordAudit).toHaveBeenCalledOnce();
});
