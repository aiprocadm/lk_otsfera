/**
 * Unit tests extending coverage for enrollments — covers branches not hit
 * by the existing services.enrollments.test.ts (mocked prisma).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { approveEnrollment, rejectEnrollment, markProvisioned } from '@/lib/services/enrollments/lifecycle';

beforeEach(() => { recordAudit.mockClear(); });

const sess = (over: Record<string, unknown> = {}) =>
  ({ sub: 'u1', role: 'manager', ...over }) as never;

// ───────────────────────────────────────────
// submitEnrollmentRequest — uncovered branches
// ───────────────────────────────────────────
describe('submitEnrollmentRequest — additional branches', () => {
  function db(over: Record<string, unknown> = {}) {
    return {
      enrollmentRequest: {
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'E1', ...data,
        })),
      },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'o1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      ...over,
    } as never;
  }

  it('organization role with explicit organizationId inside memberships — uses that org', async () => {
    const s = sess({
      role: 'organization',
      organizationId: 'o-default',
      organizationMemberships: [{ organizationId: 'o-explicit', isActive: true }],
    });
    const r = await submitEnrollmentRequest(db(), s, {
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
      organizationId: 'o-explicit',
    });
    expect(r.organizationId).toBe('o-explicit');
  });

  it('organization role with organizationId NOT in memberships → FORBIDDEN', async () => {
    const s = sess({
      role: 'organization',
      organizationId: 'o-default',
      organizationMemberships: [{ organizationId: 'o-mine', isActive: true }],
    });
    await expect(
      submitEnrollmentRequest(db(), s, {
        studentName: 'Иван',
        studentEmail: 'i@x.ru',
        courseTitle: 'ОТ',
        organizationId: 'o-OTHER',
      })
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('organization role with NO organizationId → falls back to ids[0] from active memberships', async () => {
    const s = sess({
      role: 'organization',
      organizationId: null,
      organizationMemberships: [{ organizationId: 'o-first', isActive: true }],
    });
    const r = await submitEnrollmentRequest(db(), s, {
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
    });
    expect(r.organizationId).toBe('o-first');
  });

  it('organization role with NO organizationId and NO active memberships → organizationId=null', async () => {
    const s = sess({
      role: 'organization',
      organizationId: null,
      organizationMemberships: [],
    });
    const r = await submitEnrollmentRequest(db(), s, {
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
    });
    // session.organizationId is null, ids[0] is undefined → null
    expect(r.organizationId).toBeNull();
  });

  it('organization role with organizationMemberships=undefined → uses session.organizationId', async () => {
    // Tests the ?? [] branch when organizationMemberships is undefined
    const s = sess({
      role: 'organization',
      organizationId: 'o-session',
      organizationMemberships: undefined,
    });
    const r = await submitEnrollmentRequest(db(), s, {
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
    });
    // ids = [] (memberships undefined → []), organizationId falls back to session.organizationId
    expect(r.organizationId).toBe('o-session');
  });

  it('partner role with NO organizationId → partnerId set, organizationId null', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'partner', partnerId: 'p1' }), {
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
      // no organizationId
    });
    expect(r.partnerId).toBe('p1');
    expect(r.organizationId).toBeNull();
  });

  it('partner role WITH organizationId and non-null partnerId → hits findFirst with partnerId (line 45 arm 0)', async () => {
    // Branch: partnerId ?? undefined — covers arm 0 (partnerId IS defined, use it)
    // Requires: role=partner, organizationId provided, partnerId set
    const orgFindFirst = vi.fn().mockResolvedValue({ id: 'o-scoped' });
    const d = {
      enrollmentRequest: {
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'E1', ...data,
        })),
      },
      organization: { findFirst: orgFindFirst },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as never;
    const r = await submitEnrollmentRequest(
      d,
      sess({ role: 'partner', partnerId: 'p-real' }),
      { studentName: 'Иван', studentEmail: 'i@x.ru', courseTitle: 'ОТ', organizationId: 'o-scoped' }
    );
    // findFirst was called with the real partnerId (not undefined)
    expect(orgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ partnerId: 'p-real' }) })
    );
    expect(r.organizationId).toBe('o-scoped');
  });

  it('partner role with no partnerId in session → partnerId=null', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'partner', partnerId: undefined }), {
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
    });
    expect(r.partnerId).toBeNull();
  });

  it('partner WITH organizationId and null partnerId → findFirst uses undefined (covers line 45 ?? arm 0)', async () => {
    // Branch: partnerId ?? undefined — arm 0 = partnerId IS null/undefined → uses undefined
    // Requires: role=partner, organizationId provided, partnerId is null
    const orgFindFirst = vi.fn().mockResolvedValue({ id: 'o-unscoped' });
    const d = {
      enrollmentRequest: {
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'E2', ...data,
        })),
      },
      organization: { findFirst: orgFindFirst },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as never;
    const r = await submitEnrollmentRequest(
      d,
      sess({ role: 'partner', partnerId: null }),
      { studentName: 'Иван', studentEmail: 'i@x.ru', courseTitle: 'ОТ', organizationId: 'o-unscoped' }
    );
    // partnerId=null → ?? undefined → findFirst called with partnerId: undefined
    expect(orgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ partnerId: undefined }) })
    );
    expect(r.organizationId).toBe('o-unscoped');
  });

  it('note trimmed to null when empty string', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'admin' }), {
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
      note: '   ',
    });
    expect(r.note).toBeNull();
  });

  it('note preserved when non-empty', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'admin' }), {
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
      note: 'спецкурс',
    });
    expect(r.note).toBe('спецкурс');
  });
});

// ───────────────────────────────────────────
// listEnrollmentRequests — uncovered branches
// ───────────────────────────────────────────
describe('listEnrollmentRequests — additional branches', () => {
  function makeRow(id: string) {
    return {
      id,
      studentName: 'Иван',
      studentEmail: 'i@x.ru',
      courseTitle: 'ОТ',
      status: 'pending' as const,
      organizationId: null,
      organization: null,
      partner: null,
      submitterRole: 'partner',
      submittedByUser: { name: 'Сергей' },
      externalStudentId: null,
      rejectedReason: null,
      note: null,
      createdAt: new Date(),
      reviewedAt: null,
    };
  }

  function db(rows: ReturnType<typeof makeRow>[]) {
    return { enrollmentRequest: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
  }

  it('organization scope: OR [organizationId in ids, submittedByUserId]', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    const s = sess({
      role: 'organization',
      sub: 'u-org',
      organizationMemberships: [{ organizationId: 'o1', isActive: true }, { organizationId: 'o2', isActive: false }],
    });
    await listEnrollmentRequests(d, s);
    const scope = findMany.mock.calls[0][0].where.AND[0];
    expect(scope).toHaveProperty('OR');
    // Only active memberships → o1 only
    expect(scope.OR[0]).toEqual({ organizationId: { in: ['o1'] } });
    expect(scope.OR[1]).toEqual({ submittedByUserId: 'u-org' });
  });

  it('organization scope with empty memberships: OR with empty in array', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    const s = sess({
      role: 'organization',
      sub: 'u-org',
      organizationMemberships: [],
    });
    await listEnrollmentRequests(d, s);
    const scope = findMany.mock.calls[0][0].where.AND[0];
    expect(scope.OR[0]).toEqual({ organizationId: { in: [] } });
  });

  it('organization scope with undefined memberships (??[] branch): falls back to []', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    const s = sess({
      role: 'organization',
      sub: 'u-org',
      organizationMemberships: undefined,
    });
    await listEnrollmentRequests(d, s);
    const scope = findMany.mock.calls[0][0].where.AND[0];
    expect(scope.OR[0]).toEqual({ organizationId: { in: [] } });
  });

  it('partner with null partnerId → scope uses __none__ sentinel', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    const s = sess({ role: 'partner', partnerId: undefined });
    await listEnrollmentRequests(d, s);
    const scope = findMany.mock.calls[0][0].where.AND[0];
    expect(scope).toEqual({ partnerId: '__none__' });
  });

  it('non-reviewer, non-partner, non-org → submittedByUserId scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    const s = sess({ role: 'student', sub: 'u-student' });
    await listEnrollmentRequests(d, s);
    const scope = findMany.mock.calls[0][0].where.AND[0];
    expect(scope).toEqual({ submittedByUserId: 'u-student' });
  });

  it('applies status filter when opts.status provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess(), { status: 'approved' as never });
    const and = findMany.mock.calls[0][0].where.AND;
    expect(and).toContainEqual({ status: 'approved' });
  });

  it('applies search filter when opts.search provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess(), { search: 'тест' });
    const and = findMany.mock.calls[0][0].where.AND;
    const searchClause = and.find((c: Record<string, unknown>) => 'OR' in c);
    expect(searchClause).toBeDefined();
    expect(searchClause.OR[0]).toMatchObject({ studentName: { contains: 'тест' } });
  });

  it('uses cursor when opts.cursor provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess(), { cursor: 'some-id', take: 5 });
    const query = findMany.mock.calls[0][0];
    expect(query).toHaveProperty('cursor', { id: 'some-id' });
    expect(query).toHaveProperty('skip', 1);
  });

  it('hasMore=true: returns nextCursor pointing to last row in page', async () => {
    // take=2, returns 3 rows → hasMore=true
    const rows = [makeRow('r1'), makeRow('r2'), makeRow('r3')];
    const result = await listEnrollmentRequests(db(rows), sess(), { take: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBe('r2');
  });

  it('hasMore=false: returns nextCursor=null', async () => {
    const rows = [makeRow('r1'), makeRow('r2')];
    const result = await listEnrollmentRequests(db(rows), sess(), { take: 5 });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('maps organizationName from organization relation when present', async () => {
    const row = { ...makeRow('r1'), organizationId: 'o1', organization: { name: 'Org X' }, partnerName: null };
    const result = await listEnrollmentRequests(db([row as never]), sess(), { take: 5 });
    expect(result.rows[0].organizationName).toBe('Org X');
  });

  it('maps partnerName from partner relation when present', async () => {
    const row = { ...makeRow('r1'), partner: { name: 'Partner Y' } };
    const result = await listEnrollmentRequests(db([row as never]), sess(), { take: 5 });
    expect(result.rows[0].partnerName).toBe('Partner Y');
  });

  it('organizationName=null when organization relation is null', async () => {
    const row = { ...makeRow('r1'), organization: null };
    const result = await listEnrollmentRequests(db([row as never]), sess(), { take: 5 });
    expect(result.rows[0].organizationName).toBeNull();
  });

  it('partnerName=null when partner relation is null', async () => {
    const row = { ...makeRow('r1'), partner: null };
    const result = await listEnrollmentRequests(db([row as never]), sess(), { take: 5 });
    expect(result.rows[0].partnerName).toBeNull();
  });

  it('default take=20 when opts not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess());
    // take+1 = 21
    expect(findMany.mock.calls[0][0].take).toBe(21);
  });
});

// ───────────────────────────────────────────
// lifecycle — additional branches
// ───────────────────────────────────────────
describe('enrollment lifecycle — additional branches', () => {
  function db(status: string) {
    return {
      enrollmentRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: 'E1', status }),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'E1', ...data,
        })),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as never;
  }

  function dbNull() {
    return {
      enrollmentRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    } as never;
  }

  it('approveEnrollment: throws NOT_FOUND when request not found', async () => {
    await expect(
      approveEnrollment(dbNull(), { id: 'E-missing', reviewerId: 'm1' })
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('rejectEnrollment: throws NOT_FOUND when request not found', async () => {
    await expect(
      rejectEnrollment(dbNull(), { id: 'E-missing', reviewerId: 'm1', reason: 'нет' })
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('markProvisioned: throws NOT_FOUND when request not found', async () => {
    await expect(
      markProvisioned(dbNull(), { id: 'E-missing', reviewerId: 'm1', externalStudentId: 'LMS-1' })
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('rejectEnrollment: throws LIFECYCLE_VIOLATION from rejected status', async () => {
    await expect(
      rejectEnrollment(db('rejected'), { id: 'E1', reviewerId: 'm1', reason: 'нет' })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });

  it('rejectEnrollment: defaults reason to "Отклонено" when reason is whitespace', async () => {
    const r = await rejectEnrollment(db('pending'), { id: 'E1', reviewerId: 'm1', reason: '   ' });
    expect(r.rejectedReason).toBe('Отклонено');
  });

  it('rejectEnrollment: can reject from approved status', async () => {
    const r = await rejectEnrollment(db('approved'), { id: 'E1', reviewerId: 'm1', reason: 'изменились условия' });
    expect(r.status).toBe('rejected');
  });
});
