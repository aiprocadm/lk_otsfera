import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PR-2: bulk-переходы позиций markInTraining/markCertificatesReady в
 * PATCH /api/enrollments/[id] — маппинг action → advanceEnrollmentItems,
 * валидация itemIds на границе роута и гейты флаг/сессия/роль (по образцу
 * api.enrollments.test.ts).
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { advanceEnrollmentItems, approveEnrollment, rejectEnrollment, markProvisioned } = vi.hoisted(() => ({
  advanceEnrollmentItems: vi.fn(),
  approveEnrollment: vi.fn(),
  rejectEnrollment: vi.fn(),
  markProvisioned: vi.fn()
}));
vi.mock('@/lib/services/enrollments/lifecycle', () => ({
  advanceEnrollmentItems,
  approveEnrollment,
  rejectEnrollment,
  markProvisioned
}));

import { PATCH } from '@/app/api/enrollments/[id]/route';

const partner = { sub: 'p', role: 'partner', partnerId: 'p1' } as never;
const manager = { sub: 'm', role: 'manager' } as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (b: unknown) =>
  new Request('http://x/', { method: 'PATCH', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.resetAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
});

describe('PATCH /api/enrollments/[id] — markInTraining / markCertificatesReady', () => {
  it('404 when feature flag disabled', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await PATCH(jsonReq({ action: 'markInTraining' }), ctx('E1'));
    expect(res.status).toBe(404);
    expect(advanceEnrollmentItems).not.toHaveBeenCalled();
  });

  it('401 unauthenticated', async () => {
    getSession.mockResolvedValue(null);
    const res = await PATCH(jsonReq({ action: 'markInTraining' }), ctx('E1'));
    expect(res.status).toBe(401);
    expect(advanceEnrollmentItems).not.toHaveBeenCalled();
  });

  it('403 when a non-reviewer (partner) tries to advance', async () => {
    getSession.mockResolvedValue(partner);
    const res = await PATCH(jsonReq({ action: 'markCertificatesReady' }), ctx('E1'));
    expect(res.status).toBe(403);
    expect(advanceEnrollmentItems).not.toHaveBeenCalled();
  });

  it('markInTraining без itemIds → advanceEnrollmentItems с target in_training и itemIds undefined', async () => {
    getSession.mockResolvedValue(manager);
    advanceEnrollmentItems.mockResolvedValue({
      ok: true,
      request: { id: 'E1', status: 'in_training' },
      movedCount: 2,
      headerChanged: true
    });
    const res = await PATCH(jsonReq({ action: 'markInTraining' }), ctx('E1'));
    expect(res.status).toBe(200);
    expect(advanceEnrollmentItems).toHaveBeenCalledWith({}, {
      id: 'E1',
      reviewerId: 'm',
      target: 'in_training',
      itemIds: undefined
    });
  });

  it('markCertificatesReady с itemIds → строки приведены к String', async () => {
    getSession.mockResolvedValue(manager);
    advanceEnrollmentItems.mockResolvedValue({
      ok: true,
      request: { id: 'E1', status: 'certificates_ready' },
      movedCount: 3,
      headerChanged: true
    });
    // Число и строка в массиве — роут обязан отдать сервису только строки.
    const res = await PATCH(jsonReq({ action: 'markCertificatesReady', itemIds: ['i1', 42, 'i3'] }), ctx('E1'));
    expect(res.status).toBe(200);
    expect(advanceEnrollmentItems).toHaveBeenCalledWith({}, {
      id: 'E1',
      reviewerId: 'm',
      target: 'certificates_ready',
      itemIds: ['i1', '42', 'i3']
    });
  });

  it('itemIds строка (не массив) → 400 validation, сервис не вызван', async () => {
    getSession.mockResolvedValue(manager);
    const res = await PATCH(jsonReq({ action: 'markInTraining', itemIds: 'i1' }), ctx('E1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'validation' });
    expect(advanceEnrollmentItems).not.toHaveBeenCalled();
  });

  it('itemIds число (не массив) → 400 validation, сервис не вызван', async () => {
    getSession.mockResolvedValue(manager);
    const res = await PATCH(jsonReq({ action: 'markCertificatesReady', itemIds: 5 }), ctx('E1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'validation' });
    expect(advanceEnrollmentItems).not.toHaveBeenCalled();
  });

  it('maps not_found → 404', async () => {
    getSession.mockResolvedValue(manager);
    advanceEnrollmentItems.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await PATCH(jsonReq({ action: 'markInTraining' }), ctx('missing'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('maps lifecycle_violation → 409', async () => {
    getSession.mockResolvedValue(manager);
    advanceEnrollmentItems.mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    const res = await PATCH(jsonReq({ action: 'markCertificatesReady' }), ctx('E1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lifecycle_violation' });
  });

  it('maps validation (из сервиса) → 400', async () => {
    getSession.mockResolvedValue(manager);
    advanceEnrollmentItems.mockResolvedValue({ ok: false, error: 'validation' });
    const res = await PATCH(jsonReq({ action: 'markInTraining', itemIds: ['чужой'] }), ctx('E1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'validation' });
  });

  it('успех → json {request, movedCount}', async () => {
    getSession.mockResolvedValue(manager);
    advanceEnrollmentItems.mockResolvedValue({
      ok: true,
      request: { id: 'E1', status: 'in_training' },
      movedCount: 1,
      headerChanged: false
    });
    const res = await PATCH(jsonReq({ action: 'markInTraining', itemIds: ['i1'] }), ctx('E1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ request: { id: 'E1', status: 'in_training' }, movedCount: 1 });
  });

  it('неизвестный action → 400 с перечнем всех пяти actions', async () => {
    getSession.mockResolvedValue(manager);
    const res = await PATCH(jsonReq({ action: 'nope' }), ctx('E1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('approve');
    expect(body.error).toContain('reject');
    expect(body.error).toContain('markProvisioned');
    expect(body.error).toContain('markInTraining');
    expect(body.error).toContain('markCertificatesReady');
    expect(advanceEnrollmentItems).not.toHaveBeenCalled();
  });
});
