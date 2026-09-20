import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Четыре роута, у каждого — своя недопроверенная ветка.
 *
 * «Прочитать все уведомления» одним действием (иначе колокольчик с сотней
 * непрочитанных не расчистить), различение «повтор» и «ошибка ввода» у
 * удостоверений (409 против 400 — по 400 человек начинает искать опечатку,
 * которой нет), и две двери: гость и заявка без организации.
 */
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireManager: vi.fn(),
  requireRole: vi.fn(),
  requireSession: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationsRead: vi.fn(),
  listNotifications: vi.fn(),
  canSubmitEnrollments: vi.fn(),
  canAccessEnrollmentOrg: vi.fn(),
  listOrgStudents: vi.fn(),
  recordPiiAccess: vi.fn(),
  createCertificate: vi.fn(),
  issueFromOrderItem: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager: mocks.requireManager }));
vi.mock('@/lib/auth/guard', () => ({
  requireRole: mocks.requireRole,
  requireSession: mocks.requireSession,
}));
vi.mock('@/lib/services/notifications/inbox', () => ({
  listNotifications: mocks.listNotifications,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
  markNotificationsRead: mocks.markNotificationsRead,
}));
vi.mock('@/lib/services/enrollments/policy', () => ({
  canSubmitEnrollments: mocks.canSubmitEnrollments,
  canAccessEnrollmentOrg: mocks.canAccessEnrollmentOrg,
}));
vi.mock('@/lib/services/organization/students', () => ({
  listOrgStudents: mocks.listOrgStudents,
}));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess: mocks.recordPiiAccess }));
vi.mock('@/lib/services/training/certificates', () => ({
  createCertificate: mocks.createCertificate,
  issueFromOrderItem: mocks.issueFromOrderItem,
}));

import { PATCH as notificationsPatch } from '@/app/api/notifications/route';
import { GET as enrollmentStudentsGet } from '@/app/api/enrollments/students/route';
import { POST as certificatesPost } from '@/app/api/manager/certificates/route';

const SESSION = { sub: 'u1', role: 'manager', email: 'm@x.ru', companyId: 'c1' };

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue(SESSION);
  mocks.requireManager.mockResolvedValue(SESSION);
  // Гарды из `auth/guard` отвечают не сессией, а результатом-обёрткой.
  mocks.requireSession.mockResolvedValue({ ok: true, value: SESSION });
  mocks.requireRole.mockReturnValue({ ok: true, value: SESSION });
  mocks.canSubmitEnrollments.mockReturnValue(true);
  mocks.canAccessEnrollmentOrg.mockResolvedValue(true);
  mocks.listOrgStudents.mockResolvedValue({ rows: [] });
  mocks.markAllNotificationsRead.mockResolvedValue({ updated: 7 });
  mocks.markNotificationsRead.mockResolvedValue({ updated: 1 });
});

describe('PATCH /api/notifications — «прочитать все»', () => {
  it('отмечает всё разом и отвечает, сколько записей тронуто', async () => {
    const res = await notificationsPatch(
      jsonReq('http://localhost/api/notifications', { all: true })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBe(7);
    expect(mocks.markAllNotificationsRead).toHaveBeenCalledWith({}, SESSION);
    expect(mocks.markNotificationsRead).not.toHaveBeenCalled();
  });

  it('одиночная отметка идёт другим путём', async () => {
    await notificationsPatch(jsonReq('http://localhost/api/notifications', { id: 'n1' }));

    expect(mocks.markAllNotificationsRead).not.toHaveBeenCalled();
    expect(mocks.markNotificationsRead).toHaveBeenCalledWith({}, SESSION, {
      id: 'n1',
      isRead: true,
    });
  });
});

describe('GET /api/enrollments/students — сотрудники для мастера заявки', () => {
  it('гость получает 401', async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await enrollmentStudentsGet(
      new Request('http://localhost/api/enrollments/students?organizationId=o1')
    );

    expect(res.status).toBe(401);
    expect(mocks.listOrgStudents).not.toHaveBeenCalled();
  });

  it('без организации — 400, а не пустой список', async () => {
    const res = await enrollmentStudentsGet(
      new Request('http://localhost/api/enrollments/students')
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'validation' });
  });

  it('роль без права подавать заявки — 403', async () => {
    mocks.canSubmitEnrollments.mockReturnValue(false);

    const res = await enrollmentStudentsGet(
      new Request('http://localhost/api/enrollments/students?organizationId=o1')
    );

    expect(res.status).toBe(403);
  });

  it('чужая организация — 403, даже если право есть', async () => {
    mocks.canAccessEnrollmentOrg.mockResolvedValue(false);

    const res = await enrollmentStudentsGet(
      new Request('http://localhost/api/enrollments/students?organizationId=чужая')
    );

    expect(res.status).toBe(403);
    expect(mocks.listOrgStudents).not.toHaveBeenCalled();
  });
});

describe('POST /api/manager/certificates — коды отказов', () => {
  it.each([
    ['forbidden', 403],
    ['not_found', 404],
    ['already_issued', 409],
    ['validation', 400],
  ])('код сервиса «%s» превращается в %i', async (error, status) => {
    mocks.issueFromOrderItem.mockResolvedValue({ ok: false, error });

    const res = await certificatesPost(
      jsonReq('http://localhost/api/manager/certificates', {
        orderItemId: 'oi1',
        number: 'У-1',
        issuedAt: '2026-09-01',
      })
    );

    expect(res.status).toBe(status);
  });
});
