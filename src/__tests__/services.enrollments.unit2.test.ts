/**
 * Unit tests extending coverage for enrollments — covers branches not hit
 * by the existing services.enrollments.test.ts (mocked prisma).
 * Этап 2: контракт submit — { directionId, organizationId?, note?, items[] }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { canSubmitEnrollments, submitterRoleLabel, canReviewEnrollments } = vi.hoisted(() => ({
  canSubmitEnrollments: vi.fn(() => true),
  submitterRoleLabel: vi.fn((s: { role: string }) => s.role),
  // list.ts depends on this; keep real semantics so the list-scope tests stay valid.
  canReviewEnrollments: vi.fn((s: { role: string }) => s.role === 'manager' || s.role === 'admin'),
}));
vi.mock('@/lib/services/enrollments/policy', () => ({
  canSubmitEnrollments,
  submitterRoleLabel,
  canReviewEnrollments,
}));

import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { approveEnrollment, rejectEnrollment, markProvisioned } from '@/lib/services/enrollments/lifecycle';

beforeEach(() => { recordAudit.mockClear(); });

const sess = (over: Record<string, unknown> = {}) =>
  ({ sub: 'u1', role: 'manager', ...over }) as never;

const ITEMS = [{ fullName: 'Иван', email: 'i@x.ru' }];

// ───────────────────────────────────────────
// submitEnrollmentRequest — uncovered branches
// ───────────────────────────────────────────
describe('submitEnrollmentRequest — additional branches', () => {
  beforeEach(() => {
    canSubmitEnrollments.mockReturnValue(true);
    canSubmitEnrollments.mockClear();
    submitterRoleLabel.mockClear();
  });

  function db(over: Record<string, unknown> = {}) {
    const create = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'E1', ...data,
    }));
    const base = {
      trainingDirection: { findFirst: vi.fn().mockResolvedValue({ id: 'd1' }) },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'o1' }) },
      student: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          enrollmentRequest: { create },
          enrollmentRequestItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
        })
      ),
      ...over,
    };
    return Object.assign(base, { __create: create }) as never;
  }

  // ─── §3 Result guard branches ───
  it('forbidden role (canSubmitEnrollments → false) → { ok:false, error:forbidden } and no tx', async () => {
    canSubmitEnrollments.mockReturnValue(false);
    const d = db();
    const res = await submitEnrollmentRequest(d, sess({ role: 'student' }), { directionId: 'd1', items: ITEMS });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect((d as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
  });

  it('validation: невалидный email позиции — русское сообщение, без tx', async () => {
    const d = db();
    const res = await submitEnrollmentRequest(d, sess({ role: 'admin' }), {
      directionId: 'd1',
      items: [{ fullName: 'Иван', email: 'not-an-email' }],
    });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect((res as { messages: string[] }).messages[0]).toContain('некорректный email');
    expect((d as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
  });

  it('partner with organizationId not under partner (findFirst → null) → forbidden', async () => {
    const d = db({ organization: { findFirst: vi.fn().mockResolvedValue(null) } });
    const res = await submitEnrollmentRequest(d, sess({ role: 'partner', partnerId: 'p1' }), {
      directionId: 'd1',
      organizationId: 'o-other',
      items: ITEMS,
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('happy path → ok:true with request.id and recordAudit called', async () => {
    const res = await submitEnrollmentRequest(db(), sess({ role: 'admin' }), { directionId: 'd1', items: ITEMS });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.request.id).toBe('E1');
    expect(recordAudit).toHaveBeenCalled();
  });

  it('organization role with explicit organizationId inside memberships — uses that org', async () => {
    const s = sess({
      role: 'organization',
      organizationId: 'o-default',
      organizationMemberships: [{ organizationId: 'o-explicit', isActive: true }],
    });
    const r = await submitEnrollmentRequest(db(), s, { directionId: 'd1', organizationId: 'o-explicit', items: ITEMS });
    expect(r.ok && r.request.organizationId).toBe('o-explicit');
  });

  it('organization role with organizationId NOT in memberships → forbidden', async () => {
    const s = sess({
      role: 'organization',
      organizationId: 'o-default',
      organizationMemberships: [{ organizationId: 'o-mine', isActive: true }],
    });
    const r = await submitEnrollmentRequest(db(), s, { directionId: 'd1', organizationId: 'o-OTHER', items: ITEMS });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('organization role with NO organizationId → falls back to ids[0] from active memberships', async () => {
    const s = sess({
      role: 'organization',
      organizationId: null,
      organizationMemberships: [{ organizationId: 'o-first', isActive: true }],
    });
    const r = await submitEnrollmentRequest(db(), s, { directionId: 'd1', items: ITEMS });
    expect(r.ok && r.request.organizationId).toBe('o-first');
  });

  it('organization role with NO organizationId and NO active memberships → organizationId=null', async () => {
    const s = sess({
      role: 'organization',
      organizationId: null,
      organizationMemberships: [],
    });
    const r = await submitEnrollmentRequest(db(), s, { directionId: 'd1', items: ITEMS });
    expect(r.ok && r.request.organizationId).toBeNull();
  });

  it('organization role with organizationMemberships=undefined → uses session.organizationId', async () => {
    const s = sess({
      role: 'organization',
      organizationId: 'o-session',
      organizationMemberships: undefined,
    });
    const r = await submitEnrollmentRequest(db(), s, { directionId: 'd1', items: ITEMS });
    expect(r.ok && r.request.organizationId).toBe('o-session');
  });

  it('partner role with NO organizationId → partnerId set, organizationId null', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'partner', partnerId: 'p1' }), {
      directionId: 'd1',
      items: ITEMS,
    });
    expect(r.ok && r.request.partnerId).toBe('p1');
    expect(r.ok && r.request.organizationId).toBeNull();
  });

  it('partner role WITH organizationId and non-null partnerId → findFirst scoped by partnerId', async () => {
    const orgFindFirst = vi.fn().mockResolvedValue({ id: 'o-scoped' });
    const d = db({ organization: { findFirst: orgFindFirst } });
    const r = await submitEnrollmentRequest(
      d,
      sess({ role: 'partner', partnerId: 'p-real' }),
      { directionId: 'd1', organizationId: 'o-scoped', items: ITEMS }
    );
    expect(orgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ partnerId: 'p-real' }) })
    );
    expect(r.ok && r.request.organizationId).toBe('o-scoped');
  });

  it('partner role with no partnerId in session → partnerId=null', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'partner', partnerId: undefined }), {
      directionId: 'd1',
      items: ITEMS,
    });
    expect(r.ok && r.request.partnerId).toBeNull();
  });

  it('partner WITH organizationId and null partnerId → findFirst uses undefined (?? arm)', async () => {
    const orgFindFirst = vi.fn().mockResolvedValue({ id: 'o-unscoped' });
    const d = db({ organization: { findFirst: orgFindFirst } });
    const r = await submitEnrollmentRequest(
      d,
      sess({ role: 'partner', partnerId: null }),
      { directionId: 'd1', organizationId: 'o-unscoped', items: ITEMS }
    );
    expect(orgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ partnerId: undefined }) })
    );
    expect(r.ok && r.request.organizationId).toBe('o-unscoped');
  });

  it('note trimmed to null when empty string', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'admin' }), {
      directionId: 'd1',
      items: ITEMS,
      note: '   ',
    });
    expect(r.ok && r.request.note).toBeNull();
  });

  it('note preserved when non-empty', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'admin' }), {
      directionId: 'd1',
      items: ITEMS,
      note: 'спецкурс',
    });
    expect(r.ok && r.request.note).toBe('спецкурс');
  });

  it('items=undefined трактуется как пустой список → validation', async () => {
    const r = await submitEnrollmentRequest(db(), sess({ role: 'admin' }), {
      directionId: 'd1',
      items: undefined as never,
    });
    expect(r).toMatchObject({ ok: false, error: 'validation' });
  });
});

// ───────────────────────────────────────────
// listEnrollmentRequests — uncovered branches
// ───────────────────────────────────────────
describe('listEnrollmentRequests — additional branches', () => {
  function makeRow(id: string) {
    return {
      id,
      status: 'pending' as const,
      organizationId: null,
      organization: null,
      partner: null,
      direction: null,
      legacyCourseTitle: 'ОТ',
      items: [{ id: `${id}-i1`, fullName: 'Иван', email: 'i@x.ru', status: 'pending' }],
      submitterRole: 'partner',
      submittedByUser: { name: 'Сергей' },
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
    const s = sess({ role: 'organization', sub: 'u-org', organizationMemberships: [] });
    await listEnrollmentRequests(d, s);
    const scope = findMany.mock.calls[0][0].where.AND[0];
    expect(scope.OR[0]).toEqual({ organizationId: { in: [] } });
  });

  it('organization scope with undefined memberships (??[] branch): falls back to []', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    const s = sess({ role: 'organization', sub: 'u-org', organizationMemberships: undefined });
    await listEnrollmentRequests(d, s);
    const scope = findMany.mock.calls[0][0].where.AND[0];
    expect(scope.OR[0]).toEqual({ organizationId: { in: [] } });
  });

  it('partner with null partnerId → scope uses __none__ sentinel', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess({ role: 'partner', partnerId: undefined }));
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({ partnerId: '__none__' });
  });

  it('non-reviewer, non-partner, non-org → submittedByUserId scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess({ role: 'student', sub: 'u-student' }));
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({ submittedByUserId: 'u-student' });
  });

  it('applies status filter when opts.status provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess(), { status: 'approved' as never });
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual({ status: 'approved' });
  });

  it('applies search filter when opts.search provided (направление первым плечом)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess(), { search: 'тест' });
    const and = findMany.mock.calls[0][0].where.AND;
    const searchClause = and.find((c: Record<string, unknown>) => 'OR' in c);
    expect(searchClause).toBeDefined();
    expect(searchClause.OR[0]).toMatchObject({ direction: { name: { contains: 'тест' } } });
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
    const row = { ...makeRow('r1'), organizationId: 'o1', organization: { name: 'Org X' } };
    const result = await listEnrollmentRequests(db([row as never]), sess(), { take: 5 });
    expect(result.rows[0]!.organizationName).toBe('Org X');
  });

  it('maps partnerName from partner relation when present', async () => {
    const row = { ...makeRow('r1'), partner: { name: 'Partner Y' } };
    const result = await listEnrollmentRequests(db([row as never]), sess(), { take: 5 });
    expect(result.rows[0]!.partnerName).toBe('Partner Y');
  });

  it('organizationName/partnerName=null when relations are null', async () => {
    const result = await listEnrollmentRequests(db([makeRow('r1')]), sess(), { take: 5 });
    expect(result.rows[0]!.organizationName).toBeNull();
    expect(result.rows[0]!.partnerName).toBeNull();
  });

  it('default take=20 when opts not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const d = { enrollmentRequest: { findMany } } as never;
    await listEnrollmentRequests(d, sess());
    expect(findMany.mock.calls[0][0].take).toBe(21);
  });
});

// ───────────────────────────────────────────
// lifecycle — additional branches
// ───────────────────────────────────────────
describe('enrollment lifecycle — additional branches', () => {
  function db(status: string) {
    const update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'E1', ...data,
    }));
    return {
      enrollmentRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'E1', status }) },
      enrollmentRequestItem: { count: vi.fn().mockResolvedValue(1) },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          enrollmentRequest: { update },
          enrollmentRequestItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        })
      ),
    } as never;
  }

  function dbNull() {
    return {
      enrollmentRequest: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;
  }

  it('approveEnrollment: returns not_found when request not found', async () => {
    expect(
      await approveEnrollment(dbNull(), { id: 'E-missing', reviewerId: 'm1' })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('rejectEnrollment: returns not_found when request not found', async () => {
    expect(
      await rejectEnrollment(dbNull(), { id: 'E-missing', reviewerId: 'm1', reason: 'нет' })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('markProvisioned: returns not_found when request not found', async () => {
    expect(
      await markProvisioned(dbNull(), { id: 'E-missing', reviewerId: 'm1', externalStudentId: 'LMS-1' })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('rejectEnrollment: returns lifecycle_violation from rejected status', async () => {
    expect(
      await rejectEnrollment(db('rejected'), { id: 'E1', reviewerId: 'm1', reason: 'нет' })
    ).toEqual({ ok: false, error: 'lifecycle_violation' });
  });

  it('rejectEnrollment: defaults reason to "Отклонено" when reason is whitespace', async () => {
    const r = await rejectEnrollment(db('pending'), { id: 'E1', reviewerId: 'm1', reason: '   ' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.rejectedReason).toBe('Отклонено');
  });

  it('rejectEnrollment: can reject from approved status', async () => {
    const r = await rejectEnrollment(db('approved'), { id: 'E1', reviewerId: 'm1', reason: 'изменились условия' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.status).toBe('rejected');
  });
});
