import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { notifySubmitterEnrollmentStatus } = vi.hoisted(() => ({
  notifySubmitterEnrollmentStatus: vi.fn(),
}));
vi.mock('@/lib/services/enrollments/notify', () => ({ notifySubmitterEnrollmentStatus }));

import {
  ENROLLMENT_PIPELINE,
  aggregateEnrollmentHeaderStatus,
  advanceEnrollmentItems,
  approveEnrollment,
  rejectEnrollment,
  markProvisioned,
} from '@/lib/services/enrollments/lifecycle';

beforeEach(() => {
  recordAudit.mockReset();
  notifySubmitterEnrollmentStatus.mockReset();
});

const st = (s: string) => ({ status: s }) as never;

describe('ENROLLMENT_PIPELINE (порядок конвейера)', () => {
  it('pending → approved → provisioned → in_training → certificates_ready', () => {
    expect(ENROLLMENT_PIPELINE).toEqual([
      'pending',
      'approved',
      'provisioned',
      'in_training',
      'certificates_ready',
    ]);
  });
});

describe('aggregateEnrollmentHeaderStatus (минимальный по конвейеру среди не-отклонённых)', () => {
  it('все pending → pending', () => {
    expect(aggregateEnrollmentHeaderStatus([st('pending'), st('pending')])).toBe('pending');
  });
  it('смесь approved+provisioned → approved (минимум)', () => {
    expect(aggregateEnrollmentHeaderStatus([st('approved'), st('provisioned')])).toBe('approved');
  });
  it('provisioned+in_training → provisioned', () => {
    expect(aggregateEnrollmentHeaderStatus([st('provisioned'), st('in_training')])).toBe(
      'provisioned'
    );
  });
  it('все certificates_ready → certificates_ready', () => {
    expect(
      aggregateEnrollmentHeaderStatus([st('certificates_ready'), st('certificates_ready')])
    ).toBe('certificates_ready');
  });
  it('rejected игнорируются: rejected+in_training → in_training', () => {
    expect(aggregateEnrollmentHeaderStatus([st('rejected'), st('in_training')])).toBe(
      'in_training'
    );
  });
  it('все rejected → rejected; пусто → rejected', () => {
    expect(aggregateEnrollmentHeaderStatus([st('rejected'), st('rejected')])).toBe('rejected');
    expect(aggregateEnrollmentHeaderStatus([])).toBe('rejected');
  });
});

describe('advanceEnrollmentItems (bulk provisioned → in_training → certificates_ready)', () => {
  function db(status: string, items: { id: string; status: string }[]) {
    const findUnique = vi.fn().mockResolvedValue({ id: 'E1', status, items });
    const requestUpdate = vi
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'E1',
        ...data,
      }));
    const itemUpdateMany = vi.fn().mockResolvedValue({ count: items.length });
    const base = {
      enrollmentRequest: { findUnique },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            enrollmentRequest: { update: requestUpdate },
            enrollmentRequestItem: { updateMany: itemUpdateMany },
          })
        ),
    };
    return { d: base as never, requestUpdate, itemUpdateMany };
  }
  const ARGS = { id: 'E1', reviewerId: 'm1', target: 'in_training' as const };

  it('not_found на отсутствующей заявке', async () => {
    const { d } = db('provisioned', []);
    (
      d as { enrollmentRequest: { findUnique: ReturnType<typeof vi.fn> } }
    ).enrollmentRequest.findUnique = vi.fn().mockResolvedValue(null);
    expect(await advanceEnrollmentItems(d, ARGS)).toEqual({ ok: false, error: 'not_found' });
  });

  it('itemIds: [] → validation (пустой явный выбор)', async () => {
    const { d } = db('provisioned', [{ id: 'i1', status: 'provisioned' }]);
    expect(await advanceEnrollmentItems(d, { ...ARGS, itemIds: [] })).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('неизвестный itemId → validation', async () => {
    const { d } = db('provisioned', [{ id: 'i1', status: 'provisioned' }]);
    expect(await advanceEnrollmentItems(d, { ...ARGS, itemIds: ['iX'] })).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('позиция не на предыдущем шаге конвейера → lifecycle_violation', async () => {
    const { d } = db('approved', [{ id: 'i1', status: 'approved' }]);
    expect(await advanceEnrollmentItems(d, { ...ARGS, itemIds: ['i1'] })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
  });

  it('без itemIds и нет позиций на предыдущем шаге → lifecycle_violation', async () => {
    const { d } = db('approved', [
      { id: 'i1', status: 'approved' },
      { id: 'i2', status: 'rejected' },
    ]);
    expect(await advanceEnrollmentItems(d, ARGS)).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
  });

  it('успех: все provisioned → in_training, шапка in_training, податель уведомлён, аудит без ПДн', async () => {
    const { d, requestUpdate, itemUpdateMany } = db('provisioned', [
      { id: 'i1', status: 'provisioned' },
      { id: 'i2', status: 'provisioned' },
    ]);
    const r = await advanceEnrollmentItems(d, ARGS);
    if (!r.ok) throw new Error('expected ok');
    expect(r.movedCount).toBe(2);
    expect(r.headerChanged).toBe(true);
    expect(r.request.status).toBe('in_training');
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { requestId: 'E1', id: { in: ['i1', 'i2'] } },
      data: { status: 'in_training' },
    });
    expect(requestUpdate).toHaveBeenCalledWith({
      where: { id: 'E1' },
      data: { status: 'in_training' },
    });
    expect(notifySubmitterEnrollmentStatus).toHaveBeenCalledTimes(1);
    expect(notifySubmitterEnrollmentStatus.mock.calls[0][1]).toMatchObject({
      id: 'E1',
      status: 'in_training',
    });
    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      action: 'enrollment_items_advanced',
      entityId: 'E1',
      after: { target: 'in_training', movedCount: 2, headerStatus: 'in_training' },
    });
  });

  it('частичный переход (1 из 2): шапка остаётся provisioned (минимум), уведомления нет', async () => {
    const { d, requestUpdate } = db('provisioned', [
      { id: 'i1', status: 'provisioned' },
      { id: 'i2', status: 'provisioned' },
    ]);
    const r = await advanceEnrollmentItems(d, { ...ARGS, itemIds: ['i1'] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.movedCount).toBe(1);
    expect(r.headerChanged).toBe(false);
    expect(r.request.status).toBe('provisioned');
    expect(requestUpdate).toHaveBeenCalledWith({
      where: { id: 'E1' },
      data: { status: 'provisioned' },
    });
    expect(notifySubmitterEnrollmentStatus).not.toHaveBeenCalled();
  });

  it('itemIds чистятся: дубли и пробелы схлопываются до одного id', async () => {
    const { d, itemUpdateMany } = db('provisioned', [
      { id: 'i1', status: 'provisioned' },
      { id: 'i2', status: 'provisioned' },
    ]);
    const r = await advanceEnrollmentItems(d, { ...ARGS, itemIds: ['i1', ' i1 ', 'i1', ''] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.movedCount).toBe(1);
    expect(itemUpdateMany.mock.calls[0][0].where.id).toEqual({ in: ['i1'] });
  });

  it('certificates_ready: предыдущий шаг in_training, rejected не мешает шапке', async () => {
    const { d, itemUpdateMany } = db('in_training', [
      { id: 'i1', status: 'in_training' },
      { id: 'i2', status: 'rejected' },
    ]);
    const r = await advanceEnrollmentItems(d, {
      id: 'E1',
      reviewerId: 'm1',
      target: 'certificates_ready',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.headerChanged).toBe(true);
    expect(r.request.status).toBe('certificates_ready');
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { requestId: 'E1', id: { in: ['i1'] } },
      data: { status: 'certificates_ready' },
    });
  });
});

describe('approve/reject/markProvisioned уведомляют подателя (best-effort в notify.ts)', () => {
  function db(status: string, itemCount = 1) {
    const requestUpdate = vi
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'E1',
        ...data,
      }));
    const itemUpdateMany = vi.fn().mockResolvedValue({ count: itemCount });
    const base = {
      enrollmentRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'E1', status }) },
      enrollmentRequestItem: { count: vi.fn().mockResolvedValue(itemCount) },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            enrollmentRequest: { update: requestUpdate },
            enrollmentRequestItem: { updateMany: itemUpdateMany },
          })
        ),
    };
    return { d: base as never };
  }

  it('approve: уведомление с обновлённой шапкой approved', async () => {
    const r = await approveEnrollment(db('pending').d, { id: 'E1', reviewerId: 'm1' });
    if (!r.ok) throw new Error('expected ok');
    expect(notifySubmitterEnrollmentStatus).toHaveBeenCalledTimes(1);
    expect(notifySubmitterEnrollmentStatus.mock.calls[0][1]).toMatchObject({
      id: 'E1',
      status: 'approved',
    });
  });

  it('reject: уведомление с rejected и причиной', async () => {
    const r = await rejectEnrollment(db('pending').d, {
      id: 'E1',
      reviewerId: 'm1',
      reason: 'нет мест',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(notifySubmitterEnrollmentStatus.mock.calls[0][1]).toMatchObject({
      status: 'rejected',
      rejectedReason: 'нет мест',
    });
  });

  it('markProvisioned: уведомление с provisioned', async () => {
    const r = await markProvisioned(db('approved').d, {
      id: 'E1',
      reviewerId: 'm1',
      externalStudentId: 'LMS-9',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(notifySubmitterEnrollmentStatus.mock.calls[0][1]).toMatchObject({
      status: 'provisioned',
    });
  });

  it('на lifecycle_violation уведомления нет', async () => {
    expect(await approveEnrollment(db('approved').d, { id: 'E1', reviewerId: 'm1' })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
    expect(notifySubmitterEnrollmentStatus).not.toHaveBeenCalled();
  });
});
