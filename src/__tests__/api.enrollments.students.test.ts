import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSession, notFoundIfDisabled, listOrgStudents, recordPiiAccess, orgFindFirst } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    notFoundIfDisabled: vi.fn(),
    listOrgStudents: vi.fn(),
    recordPiiAccess: vi.fn().mockResolvedValue(undefined),
    orgFindFirst: vi.fn(),
  }));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findFirst: orgFindFirst } } }));
vi.mock('@/lib/services/organization/students', () => ({ listOrgStudents }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { GET } from '@/app/api/enrollments/students/route';

const req = (qs: string) => new Request(`http://x/api/enrollments/students${qs}`);
const STUDENTS = [
  { id: 'st1', name: 'Иван', email: 'i@x.ru', externalStudentId: null, createdAt: new Date() },
];

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  listOrgStudents.mockResolvedValue({ rows: STUDENTS, total: 1 });
});

describe('GET /api/enrollments/students', () => {
  it('404 при выключенном флаге; 401 без сессии; 400 без organizationId', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await GET(req('?organizationId=o1'))).status).toBe(404);

    notFoundIfDisabled.mockReturnValue(null);
    getSession.mockResolvedValue(null);
    expect((await GET(req('?organizationId=o1'))).status).toBe(401);

    getSession.mockResolvedValue({ sub: 'u', role: 'admin' });
    expect((await GET(req(''))).status).toBe(400);
  });

  it('403 для роли без права подачи (student)', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'student' });
    expect((await GET(req('?organizationId=o1'))).status).toBe(403);
  });

  it('organization: только свои активные членства', async () => {
    getSession.mockResolvedValue({
      sub: 'u',
      role: 'organization',
      organizationMemberships: [
        { organizationId: 'o1', isActive: true },
        { organizationId: 'o2', isActive: false },
      ],
    });
    expect((await GET(req('?organizationId=o1'))).status).toBe(200);
    expect((await GET(req('?organizationId=o2'))).status).toBe(403); // неактивное членство
    expect((await GET(req('?organizationId=oX'))).status).toBe(403);
  });

  it('организация без списка членств вовсе → 403, а не падение', async () => {
    // Старый токен мог прийти без поля членств. Тогда доступа нет — но ответ
    // должен быть вежливым 403, а не ошибкой сервера.
    getSession.mockResolvedValue({ sub: 'u', role: 'organization' });
    expect((await GET(req('?organizationId=o1'))).status).toBe(403);
  });

  it('partner: только организации партнёра (scoped findFirst)', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' });
    orgFindFirst.mockResolvedValue({ id: 'o1' });
    expect((await GET(req('?organizationId=o1'))).status).toBe(200);
    expect(orgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', partnerId: 'p1' } })
    );
    orgFindFirst.mockResolvedValue(null);
    expect((await GET(req('?organizationId=oX'))).status).toBe(403);
  });

  it('partner без partnerId → sentinel __none__ (deny-all)', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'partner' });
    orgFindFirst.mockResolvedValue(null);
    expect((await GET(req('?organizationId=o1'))).status).toBe(403);
    expect(orgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', partnerId: '__none__' } })
    );
  });

  it('manager/admin: любая организация; ответ — только id/name/email; ПДн-журнал пишется', async () => {
    getSession.mockResolvedValue({ sub: 'm', role: 'manager' });
    const res = await GET(req('?organizationId=o1&q=иван'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ students: [{ id: 'st1', name: 'Иван', email: 'i@x.ru' }] });
    expect(listOrgStudents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1', search: 'иван', take: 200 })
    );
    expect(recordPiiAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: 'enrollment_wizard_students',
        subjectIds: ['st1'],
        meta: { take: 200, hasQuery: true },
      })
    );
  });

  it('без поискового запроса hasQuery=false, search=undefined', async () => {
    getSession.mockResolvedValue({ sub: 'a', role: 'admin' });
    await GET(req('?organizationId=o1'));
    expect(listOrgStudents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ search: undefined })
    );
    expect(recordPiiAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ meta: { take: 200, hasQuery: false } })
    );
  });
});
