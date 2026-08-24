// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * `У-97`: карточка сотрудника открывается внутри карточки организации во всех
 * четырёх кабинетах, где она есть. Крошки одинаковые: «Организации ›
 * <название> › Сотрудники › ФИО» — человек видит, из какой организации этот
 * человек и как вернуться к списку.
 */
const guards = vi.hoisted(() => ({
  requireManagerForOrg: vi.fn(),
  requireManagerLeader: vi.fn(),
  requireAdmin: vi.fn(),
  requirePartner: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => guards);

const { canPartnerAccessOrg } = vi.hoisted(() => ({ canPartnerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canPartnerAccessOrg }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

const { orgFindUnique } = vi.hoisted(() => ({ orgFindUnique: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findUnique: orgFindUnique } } }));

const { getOrgCardEmployee } = vi.hoisted(() => ({ getOrgCardEmployee: vi.fn() }));
vi.mock('@/lib/services/organization/orgCardEmployees', () => ({ getOrgCardEmployee }));

const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('@/lib/services/training/certificates', () => ({ listCertificates }));

vi.mock('@/lib/services/customFields', () => ({ getFieldsForEntity: async () => [] }));
vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: () => React.createElement('div', { 'data-testid': 'custom-fields' }),
}));

import ManagerPage from '@/app/manager/organizations/[id]/students/[studentId]/page';
import LeaderPage from '@/app/leader/organizations/[id]/students/[studentId]/page';
import AdminPage from '@/app/admin/organizations/[id]/students/[studentId]/page';
import PartnerPage from '@/app/partner/portfolio/[orgId]/students/[studentId]/page';

const EMPLOYEE = {
  id: 'stu-1',
  name: 'Иванов Иван',
  email: null,
  position: null,
  snils: null,
  birthDate: null,
  phone: null,
  note: null,
  status: 'active',
  createdAt: new Date('2026-01-10'),
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const g of Object.values(guards)) g.mockResolvedValue({ sub: 'u1', role: 'manager' });
  canPartnerAccessOrg.mockResolvedValue(true);
  orgFindUnique.mockResolvedValue({ name: 'ООО «Ромашка»' });
  getOrgCardEmployee.mockResolvedValue(EMPLOYEE);
  listCertificates.mockResolvedValue({ ok: true, certificates: [] });
});

const CASES = [
  {
    name: 'менеджер',
    render: () =>
      ManagerPage({ params: Promise.resolve({ id: 'org-1', studentId: 'stu-1' }) }),
    section: 'Организации',
  },
  {
    name: 'руководитель',
    render: () => LeaderPage({ params: Promise.resolve({ id: 'org-1', studentId: 'stu-1' }) }),
    section: 'Организации',
  },
  {
    name: 'администратор',
    render: () => AdminPage({ params: Promise.resolve({ id: 'org-1', studentId: 'stu-1' }) }),
    section: 'Организации',
  },
  {
    name: 'партнёр',
    render: () =>
      PartnerPage({ params: Promise.resolve({ orgId: 'org-1', studentId: 'stu-1' }) }),
    section: 'Портфель',
  },
] as const;

describe('карточка сотрудника внутри карточки организации (У-97)', () => {
  it.each(CASES)('$name: крошки ведут от раздела к организации и вкладке «Сотрудники»', async (c) => {
    const { container } = await renderServerComponent(c.render());
    const text = container.textContent ?? '';
    expect(text).toContain(c.section);
    expect(text).toContain('ООО «Ромашка»');
    expect(text).toContain('Сотрудники');
    expect(text).toContain('Иванов Иван');
  });

  it.each(CASES)('$name: сотрудник не найден — «не найдено»', async (c) => {
    getOrgCardEmployee.mockResolvedValue(null);
    await expect(renderServerComponent(c.render())).rejects.toThrow('NOT_FOUND');
  });

  it.each(CASES)('$name: организации нет — «не найдено»', async (c) => {
    orgFindUnique.mockResolvedValue(null);
    await expect(renderServerComponent(c.render())).rejects.toThrow('NOT_FOUND');
  });

  it('партнёр вне портфеля не попадает на экран вовсе', async () => {
    canPartnerAccessOrg.mockResolvedValue(false);
    await expect(
      renderServerComponent(
        PartnerPage({ params: Promise.resolve({ orgId: 'org-9', studentId: 'stu-1' }) })
      )
    ).rejects.toThrow('REDIRECT:/forbidden');
    expect(getOrgCardEmployee).not.toHaveBeenCalled();
  });

  it('удостоверения не отдались — экран не падает, раздел просто пуст', async () => {
    listCertificates.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(
      ManagerPage({ params: Promise.resolve({ id: 'org-1', studentId: 'stu-1' }) })
    );
    expect(container.textContent).toContain('Нет удостоверений');
  });

  it('у партнёра настраиваемых полей нет — их ведёт учебный центр', async () => {
    const { container } = await renderServerComponent(
      PartnerPage({ params: Promise.resolve({ orgId: 'org-1', studentId: 'stu-1' }) })
    );
    expect(container.querySelector('[data-testid="custom-fields"]')).toBeNull();

    const { container: managerView } = await renderServerComponent(
      ManagerPage({ params: Promise.resolve({ id: 'org-1', studentId: 'stu-1' }) })
    );
    expect(managerView.querySelector('[data-testid="custom-fields"]')).not.toBeNull();
  });
});
