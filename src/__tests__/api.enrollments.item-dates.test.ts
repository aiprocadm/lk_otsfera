import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 2 ТЗ 13.10.2026 (`У-284`, `Р-2-3`): действие `setItemDates` в
 * PATCH /api/enrollments/[id] — сроки обучения по позиции. Роут только мапит:
 * гейт роли, форма тела, код сервиса → статус.
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { setEnrollmentItemDates } = vi.hoisted(() => ({ setEnrollmentItemDates: vi.fn() }));
vi.mock('@/lib/services/enrollments/lifecycle', () => ({
  advanceEnrollmentItems: vi.fn(),
  approveEnrollment: vi.fn(),
  rejectEnrollment: vi.fn(),
  markProvisioned: vi.fn(),
  setEnrollmentItemDates,
}));

import { PATCH } from '@/app/api/enrollments/[id]/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (b: unknown) =>
  new Request('http://x/', {
    method: 'PATCH',
    body: JSON.stringify(b),
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.resetAllMocks();
  getSession.mockResolvedValue({ sub: 'm', role: 'manager' });
});

describe('PATCH /api/enrollments/[id] — setItemDates', () => {
  it('403: сроки задаёт только сотрудник ЦО (заказчик — нет)', async () => {
    getSession.mockResolvedValue({ sub: 'o', role: 'organization' });
    const res = await PATCH(jsonReq({ action: 'setItemDates', itemId: 'I1' }), ctx('E1'));
    expect(res.status).toBe(403);
    expect(setEnrollmentItemDates).not.toHaveBeenCalled();
  });

  it('400 без itemId', async () => {
    const res = await PATCH(jsonReq({ action: 'setItemDates', itemId: '' }), ctx('E1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'validation' });
    expect(setEnrollmentItemDates).not.toHaveBeenCalled();
  });

  it('передаёт даты сервису; пустое и отсутствующее — null', async () => {
    setEnrollmentItemDates.mockResolvedValue({ ok: true });
    const res = await PATCH(
      jsonReq({ action: 'setItemDates', itemId: 'I1', startsOn: '2026-11-01', endsOn: '' }),
      ctx('E1')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(setEnrollmentItemDates).toHaveBeenCalledWith(
      {},
      { id: 'E1', itemId: 'I1', reviewerId: 'm', startsOn: '2026-11-01', endsOn: null }
    );
    await PATCH(jsonReq({ action: 'setItemDates', itemId: 'I1', endsOn: null }), ctx('E1'));
    expect(setEnrollmentItemDates).toHaveBeenLastCalledWith(
      {},
      { id: 'E1', itemId: 'I1', reviewerId: 'm', startsOn: null, endsOn: null }
    );
  });

  it.each([
    ['validation', 400],
    ['not_found', 404],
  ] as const)('код сервиса %s → %i', async (error, status) => {
    setEnrollmentItemDates.mockResolvedValue({ ok: false, error });
    const res = await PATCH(jsonReq({ action: 'setItemDates', itemId: 'I1' }), ctx('E1'));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });
});
