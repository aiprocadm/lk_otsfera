/**
 * Unit tests for src/lib/services/manager/students.ts
 * Covers: teamMode=ON (company-wide scope), teamMode=OFF with/without q,
 * cursor path, nextCursor=null when not hasMore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managedOrgIds } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managedOrgIds: vi.fn()
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managedOrgIds
}));

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { listStudents, getStudent } from '@/lib/services/manager/students';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

function studentRow(id: string) {
  return {
    id,
    name: `Student ${id}`,
    email: `${id}@s.local`,
    organization: { id: 'org-1', name: 'Org One' }
  };
}

function makePrisma(rows: ReturnType<typeof studentRow>[]) {
  return {
    student: { findMany: vi.fn().mockResolvedValue(rows) },
    company: { findUnique: vi.fn() }
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managedOrgIds.mockReturnValue(['org-1']);
});

describe('listStudents', () => {
  it('returns empty rows with null nextCursor when no students found', async () => {
    const p = makePrisma([]);
    const result = await listStudents(p, { session: SESSION });
    expect(result.rows).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('uses teamMode=OFF scope: organizationId IN managedOrgIds', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    managedOrgIds.mockReturnValue(['org-1', 'org-2']);
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { student: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listStudents(p, { session: SESSION });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ AND: expect.arrayContaining([{ organizationId: { in: ['org-1', 'org-2'] } }]) });
  });

  it('uses teamMode=ON scope: organization.companyId filter', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { student: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listStudents(p, { session: SESSION });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ AND: expect.arrayContaining([{ organization: { companyId: 'co-1' } }]) });
  });

  it('uses __no_company__ sentinel when session.companyId is null in teamMode=ON', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const nullSession = { ...SESSION, companyId: null };
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { student: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listStudents(p, { session: nullSession as never });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ AND: expect.arrayContaining([{ organization: { companyId: '__no_company__' } }]) });
  });

  it('adds search filter when q is provided', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { student: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listStudents(p, { session: SESSION, q: 'иванов' });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        {
          OR: [
            { name: { contains: 'иванов', mode: 'insensitive' } },
            { email: { contains: 'иванов', mode: 'insensitive' } }
          ]
        }
      ])
    });
  });

  it('passes cursor when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { student: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listStudents(p, { session: SESSION, cursor: 'cursor-abc' });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: 'cursor-abc' });
    expect(call.skip).toBe(1);
  });

  it('does not pass cursor when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { student: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listStudents(p, { session: SESSION });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toBeUndefined();
  });

  it('paginates: returns nextCursor when more rows than take', async () => {
    // default take=50, return 51 rows
    const rows = Array.from({ length: 51 }, (_, i) => studentRow(`s${i}`));
    const p = makePrisma(rows);
    const result = await listStudents(p, { session: SESSION, take: 50 });
    expect(result.rows).toHaveLength(50);
    expect(result.nextCursor).toBe('s49');
  });

  it('returns nextCursor=null when rows count equals take', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => studentRow(`s${i}`));
    const p = makePrisma(rows);
    const result = await listStudents(p, { session: SESSION, take: 3 });
    expect(result.rows).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });
});

describe('PII journal capture', () => {
  it('listStudents журналирует выдачу с точным составом ids', async () => {
    const p = makePrisma([studentRow('s1'), studentRow('s2')]);
    await listStudents(p, { session: SESSION, q: 'ив' });
    expect(recordPiiAccess).toHaveBeenCalledWith(p, {
      session: SESSION,
      context: 'manager_students_list',
      subjectIds: ['s1', 's2'],
      meta: { take: 50, hasQuery: true, cursor: false }
    });
  });
});

describe('getStudent', () => {
  function makeDetailPrisma(student: unknown, orgCompanyId?: string) {
    return {
      student: { findUnique: vi.fn().mockResolvedValue(student) },
      organization: { findUnique: vi.fn().mockResolvedValue(orgCompanyId ? { companyId: orgCompanyId } : null) },
      company: { findUnique: vi.fn() }
    } as never;
  }
  const STUDENT = { id: 's1', name: 'Иван', email: 'i@x.ru', organizationId: 'org-1', createdAt: new Date(), organization: { id: 'org-1', name: 'Org' } };

  it('teamMode=OFF: отдаёт студента из managed-org и журналирует view', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    managedOrgIds.mockReturnValue(['org-1']);
    const p = makeDetailPrisma(STUDENT);
    const res = await getStudent(p, SESSION, 's1');
    expect(res).toEqual(STUDENT);
    expect(recordPiiAccess).toHaveBeenCalledWith(p, {
      session: SESSION,
      context: 'manager_student_view',
      subjectIds: ['s1']
    });
  });

  it('teamMode=OFF: чужая организация → null, журнал не пишется', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    managedOrgIds.mockReturnValue(['org-2']);
    const res = await getStudent(makeDetailPrisma(STUDENT), SESSION, 's1');
    expect(res).toBeNull();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('teamMode=ON: пускает по companyId организации', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const res = await getStudent(makeDetailPrisma(STUDENT, 'co-1'), SESSION, 's1');
    expect(res).toEqual(STUDENT);
  });

  it('teamMode=ON: чужая company → null', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const res = await getStudent(makeDetailPrisma(STUDENT, 'co-OTHER'), SESSION, 's1');
    expect(res).toBeNull();
  });

  it('несуществующий студент → null', async () => {
    const res = await getStudent(makeDetailPrisma(null), SESSION, 'nope');
    expect(res).toBeNull();
  });
});
