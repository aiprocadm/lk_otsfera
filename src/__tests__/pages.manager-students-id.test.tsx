// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { redirect, notFound } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ redirect, notFound }));

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { student: { findUnique } } }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

const { studentOrgAccess } = vi.hoisted(() => ({ studentOrgAccess: vi.fn() }));
vi.mock('@/lib/services/students/access', () => ({ studentOrgAccess }));

import ManagerStudentGatewayPage from '@/app/manager/students/[id]/page';

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', companyId: 'co-1' });
  getCompanyTeamVisibility.mockResolvedValue(false);
  studentOrgAccess.mockResolvedValue({ canRead: true, canWrite: true });
  findUnique.mockResolvedValue({ organizationId: 'org-1' });
});

/**
 * `У-97`: карточка сотрудника живёт внутри карточки организации. Прежний
 * адрес остаётся рабочим шлюзом — по нему есть закладки, — но своего экрана
 * больше не рисует: у него не было бы даже крошек, ведь раздел «Сотрудники»
 * снят из меню требованием `У-103`.
 */
describe('/manager/students/[id] — шлюз в карточку организации (У-97)', () => {
  it('уводит на карточку сотрудника внутри его организации', async () => {
    await expect(
      ManagerStudentGatewayPage({ params: Promise.resolve({ id: 'stu-1' }) })
    ).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/manager/organizations/org-1/students/stu-1');
  });

  it('несуществующий сотрудник — «не найдено», без редиректа', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      ManagerStudentGatewayPage({ params: Promise.resolve({ id: 'ghost' }) })
    ).rejects.toThrow('NOT_FOUND');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('чужой сотрудник — «не найдено»: адрес чужой организации не утекает', async () => {
    // Без этой проверки шлюз выдал бы id чужой организации любому менеджеру,
    // подставившему чужой id в адрес.
    studentOrgAccess.mockResolvedValue({ canRead: false, canWrite: false });
    await expect(
      ManagerStudentGatewayPage({ params: Promise.resolve({ id: 'stu-foreign' }) })
    ).rejects.toThrow('NOT_FOUND');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('режим видимости команды читается свежим и передаётся в политику (C8)', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    await expect(
      ManagerStudentGatewayPage({ params: Promise.resolve({ id: 'stu-1' }) })
    ).rejects.toThrow('REDIRECT');
    expect(studentOrgAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'org-1', true);
  });
});
