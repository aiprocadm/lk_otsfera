import { it, expect, vi, beforeEach } from 'vitest';

const { getOrder, recordAudit, listColleagues, createNotification, deliverNotificationToUser } =
  vi.hoisted(() => ({
    getOrder: vi.fn(),
    recordAudit: vi.fn(),
    listColleagues: vi.fn(),
    createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
    deliverNotificationToUser: vi.fn(),
  }));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));
vi.mock('@/lib/services/staffChat/mentions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/staffChat/mentions')>();
  return { ...actual, listColleagues };
});

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
  expect(create).toHaveBeenCalledWith({
    data: { orderId: 'o1', authorId: 'u1', body: 'скидка 5%' },
    select: { id: true },
  });
  expect(recordAudit).toHaveBeenCalledOnce();
});

it('mentions in note body notify mentioned staff (not the author)', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  listColleagues.mockResolvedValue({ ok: true, rows: [{ id: 'u2', name: 'Пётр' }] });
  const create = vi.fn().mockResolvedValue({ id: 'note1' });
  const findMany = vi.fn().mockResolvedValue([{ id: 'u2', role: 'manager' }]);
  const prisma = { dealNote: { create }, user: { findMany } } as never;
  const res = await addDealNote(prisma, session, {
    orderId: 'o1',
    body: 'согласуй с @Пётр скидку',
  });
  expect(res).toEqual({ ok: true, id: 'note1' });
  expect(createNotification).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'u2', type: 'deal_note_mention' })
  );
  expect(deliverNotificationToUser).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'u2',
      type: 'deal_note_mention',
      url: '/manager/orders/o1',
      dedupKey: 'n1',
    })
  );
});

it('note without mentions sends no notifications and skips the colleagues query', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  const create = vi.fn().mockResolvedValue({ id: 'note1' });
  const prisma = { dealNote: { create }, user: { findMany: vi.fn() } } as never;
  await addDealNote(prisma, session, { orderId: 'o1', body: 'обычная заметка' });
  expect(listColleagues).not.toHaveBeenCalled();
  expect(deliverNotificationToUser).not.toHaveBeenCalled();
});

it('admin recipient gets the notification WITHOUT url (нет /manager-кабинета)', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  listColleagues.mockResolvedValue({ ok: true, rows: [{ id: 'a1', name: 'Админ' }] });
  const prisma = {
    dealNote: { create: vi.fn().mockResolvedValue({ id: 'note1' }) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', role: 'admin' }]) },
  } as never;
  await addDealNote(prisma, session, { orderId: 'o1', body: 'смотри @Админ' });
  const arg = deliverNotificationToUser.mock.calls[0][0];
  expect(arg.userId).toBe('a1');
  expect(arg.url).toBeUndefined();
});

it('self-mention is silent; notify failure does not fail the note', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  listColleagues.mockResolvedValue({
    ok: true,
    rows: [
      { id: 'u1', name: 'Я' },
      { id: 'u2', name: 'Пётр' },
    ],
  });
  createNotification.mockRejectedValueOnce(new Error('boom'));
  const prisma = {
    dealNote: { create: vi.fn().mockResolvedValue({ id: 'note1' }) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'u2', role: 'manager' }]) },
  } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: '@Я и @Пётр' });
  expect(res).toEqual({ ok: true, id: 'note1' }); // сбой уведомления не роняет заметку
});

it('notify failure with a non-Error rejection value falls back to String(err)', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  listColleagues.mockRejectedValueOnce('not-an-error');
  const prisma = {
    dealNote: { create: vi.fn().mockResolvedValue({ id: 'note1' }) },
    user: { findMany: vi.fn() },
  } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: '@Пётр' });
  expect(res).toEqual({ ok: true, id: 'note1' });
});
