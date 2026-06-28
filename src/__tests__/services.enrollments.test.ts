import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { canReviewEnrollments, canSubmitEnrollments, submitterRoleLabel } from '@/lib/services/enrollments/policy';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { approveEnrollment, rejectEnrollment, markProvisioned } from '@/lib/services/enrollments/lifecycle';

const s = (over: Record<string, unknown> = {}) => ({ sub: 'u1', role: 'manager', ...over }) as never;

beforeEach(() => recordAudit.mockReset());

describe('enrollment policy', () => {
  it('reviewers = manager (incl leader) + admin', () => {
    expect(canReviewEnrollments(s({ role: 'manager' }))).toBe(true);
    expect(canReviewEnrollments(s({ role: 'admin' }))).toBe(true);
    expect(canReviewEnrollments(s({ role: 'partner' }))).toBe(false);
    expect(canReviewEnrollments(s({ role: 'organization' }))).toBe(false);
  });
  it('submitters = all 5 roles (leader=manager), not student', () => {
    for (const r of ['partner', 'organization', 'manager', 'admin']) expect(canSubmitEnrollments(s({ role: r }))).toBe(true);
    expect(canSubmitEnrollments(s({ role: 'student' }))).toBe(false);
  });
  it('labels leader distinctly', () => {
    expect(submitterRoleLabel(s({ role: 'manager', managerRole: 'leader' }))).toBe('leader');
    expect(submitterRoleLabel(s({ role: 'manager' }))).toBe('manager');
    expect(submitterRoleLabel(s({ role: 'partner' }))).toBe('partner');
  });
});

describe('submitEnrollmentRequest', () => {
  function db(over: Record<string, unknown> = {}) {
    return {
      enrollmentRequest: { create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'E1', ...data })) },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'o1' }) },
      ...over
    } as never;
  }
  it('rejects empty required fields', async () => {
    const r = await submitEnrollmentRequest(db(), s({ role: 'admin' }), { studentName: '', studentEmail: 'a@b.c', courseTitle: 'X' });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });
  it('snapshots submitterRole and partnerId for a partner', async () => {
    const r = await submitEnrollmentRequest(db(), s({ role: 'partner', partnerId: 'p1' }), { studentName: 'Иван', studentEmail: 'i@x.ru', courseTitle: 'ОТ', organizationId: 'o1' });
    expect(r.ok && r.request.submitterRole).toBe('partner');
    expect(r.ok && r.request.partnerId).toBe('p1');
  });
  it('blocks a partner targeting an org outside its scope', async () => {
    const d = db({ organization: { findFirst: vi.fn().mockResolvedValue(null) } });
    const r = await submitEnrollmentRequest(d, s({ role: 'partner', partnerId: 'p1' }), { studentName: 'И', studentEmail: 'i@x.ru', courseTitle: 'ОТ', organizationId: 'oX' });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
  it('forbids a role that cannot submit (student)', async () => {
    const r = await submitEnrollmentRequest(db(), s({ role: 'student' }), { studentName: 'И', studentEmail: 'i@x.ru', courseTitle: 'ОТ' });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('listEnrollmentRequests scope', () => {
  function db(rows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(rows);
    return { db: { enrollmentRequest: { findMany } } as never, findMany };
  }
  it('reviewer sees the whole queue (empty scope)', async () => {
    const { db: d, findMany } = db();
    await listEnrollmentRequests(d, s({ role: 'manager' }));
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({});
  });
  it('partner scoped by partnerId', async () => {
    const { db: d, findMany } = db();
    await listEnrollmentRequests(d, s({ role: 'partner', partnerId: 'p1' }));
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({ partnerId: 'p1' });
  });
});

describe('enrollment lifecycle', () => {
  function db(status: string) {
    return {
      enrollmentRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: 'E1', status }),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'E1', ...data }))
      }
    } as never;
  }
  it('approve: pending → approved', async () => {
    const r = await approveEnrollment(db('pending'), { id: 'E1', reviewerId: 'm1' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.status).toBe('approved');
  });
  it('approve forbidden from non-pending', async () => {
    expect(await approveEnrollment(db('approved'), { id: 'E1', reviewerId: 'm1' })).toEqual({ ok: false, error: 'lifecycle_violation' });
  });
  it('markProvisioned requires externalStudentId and approved status', async () => {
    expect(await markProvisioned(db('approved'), { id: 'E1', reviewerId: 'm1', externalStudentId: '' })).toEqual({ ok: false, error: 'validation' });
    expect(await markProvisioned(db('pending'), { id: 'E1', reviewerId: 'm1', externalStudentId: 'LMS-9' })).toEqual({ ok: false, error: 'lifecycle_violation' });
    const r = await markProvisioned(db('approved'), { id: 'E1', reviewerId: 'm1', externalStudentId: 'LMS-9' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.status).toBe('provisioned');
    expect(r.request.externalStudentId).toBe('LMS-9');
  });
  it('reject sets reason; cannot reject a provisioned request', async () => {
    const r = await rejectEnrollment(db('pending'), { id: 'E1', reviewerId: 'm1', reason: 'нет мест' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.status).toBe('rejected');
    expect(await rejectEnrollment(db('provisioned'), { id: 'E1', reviewerId: 'm1', reason: 'x' })).toEqual({ ok: false, error: 'lifecycle_violation' });
  });
});
