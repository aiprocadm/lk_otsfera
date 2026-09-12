import { it, expect, vi, beforeEach } from 'vitest';

const { getOrder, recordAudit, listColleagues, notifyNoteMention, warn } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  recordAudit: vi.fn(),
  listColleagues: vi.fn(),
  notifyNoteMention: vi.fn().mockResolvedValue(1),
  warn: vi.fn(),
}));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications/noteMention', () => ({ notifyNoteMention }));
vi.mock('@/lib/logging', () => ({ log: { warn, info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/services/staffChat/mentions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/staffChat/mentions')>();
  return { ...actual, listColleagues };
});

import { addDealNote } from '@/lib/services/manager/dealNotes';

/**
 * Заметка по сделке: тело, аудит и упоминания. Доставка уведомления с этапа 1
 * ТЗ 12.09.2026 живёт в общем продьюсере `note_mention`
 * (`notifications.noteMention.unit.test.ts`); здесь проверяется, что сервис
 * извлекает упомянутых без автора и зовёт продьюсер с правильным объектом.
 */
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

it('mentions in note body go to the note_mention producer as a deal note (author excluded)', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  listColleagues.mockResolvedValue({
    ok: true,
    rows: [
      { id: 'u1', name: 'Я' },
      { id: 'u2', name: 'Пётр' },
    ],
  });
  const create = vi.fn().mockResolvedValue({ id: 'note1' });
  const prisma = { dealNote: { create } } as never;
  const res = await addDealNote(prisma, session, {
    orderId: 'o1',
    body: '@Я согласуй с @Пётр скидку',
  });
  expect(res).toEqual({ ok: true, id: 'note1' });
  expect(notifyNoteMention).toHaveBeenCalledWith(prisma, {
    mentionedUserIds: ['u2'],
    entity: 'deal',
    entityId: 'o1',
    noteId: 'note1',
    body: '@Я согласуй с @Пётр скидку',
    managerPath: '/manager/orders/o1',
  });
});

it('note without mentions sends no notifications and skips the colleagues query', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  const create = vi.fn().mockResolvedValue({ id: 'note1' });
  const prisma = { dealNote: { create } } as never;
  await addDealNote(prisma, session, { orderId: 'o1', body: 'обычная заметка' });
  expect(listColleagues).not.toHaveBeenCalled();
  expect(notifyNoteMention).not.toHaveBeenCalled();
});

it('colleagues lookup failure does not fail the note and is logged', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  listColleagues.mockRejectedValueOnce(new Error('db down'));
  const prisma = { dealNote: { create: vi.fn().mockResolvedValue({ id: 'note1' }) } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: '@Пётр' });
  expect(res).toEqual({ ok: true, id: 'note1' });
  expect(notifyNoteMention).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    '[dealNotes/addDealNote] mention notify failed',
    expect.objectContaining({ noteId: 'note1', error: 'db down' })
  );
});

it('non-Error rejection value falls back to String(err)', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  listColleagues.mockRejectedValueOnce('not-an-error');
  const prisma = { dealNote: { create: vi.fn().mockResolvedValue({ id: 'note1' }) } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: '@Пётр' });
  expect(res).toEqual({ ok: true, id: 'note1' });
  expect(warn).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ error: 'not-an-error' })
  );
});
