// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `У-100`: «Сотрудники» и «Доступ в кабинет» перестали быть пунктами меню —
 * это части одного объекта, своей организации, и живут её вкладками. Прежние
 * адреса **не удалены**: по ним остались закладки и ссылки в письмах-
 * приглашениях. Каждый из них уводит ровно на свою вкладку.
 */
const { requireOrganization } = vi.hoisted(() => ({ requireOrganization: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireOrganization }));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect }));

import StudentsGateway from '@/app/organization/students/page';
import StudentGateway from '@/app/organization/students/[id]/page';
import TeamGateway from '@/app/organization/team/page';

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganization.mockResolvedValue({ sub: 'u1', role: 'organization' });
});

describe('шлюзы со старых адресов кабинета заказчика (У-100)', () => {
  it('/organization/students → вкладка «Сотрудники»', async () => {
    await expect(StudentsGateway()).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/organization/company?tab=employees');
  });

  it('/organization/students/[id] → карточка сотрудника внутри организации', async () => {
    await expect(
      StudentGateway({ params: Promise.resolve({ id: 'stu-7' }) })
    ).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/organization/company/students/stu-7');
  });

  it('/organization/team → вкладка «Настройки»', async () => {
    await expect(TeamGateway()).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/organization/company?tab=settings');
  });

  it('гард роли остаётся на каждом шлюзе: посторонний не пройдёт даже транзитом', async () => {
    await expect(StudentsGateway()).rejects.toThrow('REDIRECT');
    await expect(TeamGateway()).rejects.toThrow('REDIRECT');
    await expect(
      StudentGateway({ params: Promise.resolve({ id: 'stu-7' }) })
    ).rejects.toThrow('REDIRECT');
    expect(requireOrganization).toHaveBeenCalledTimes(3);
  });
});
