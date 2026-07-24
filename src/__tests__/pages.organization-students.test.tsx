// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrgStudents } = vi.hoisted(() => ({ listOrgStudents: vi.fn() }));
vi.mock('@/lib/services/organization/students', () => ({ listOrgStudents }));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-app-shell' }, props.activeOrgName, props.children)
}));

import OrganizationStudentsPage from '@/app/organization/students/page';

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const
};

describe('OrganizationStudentsPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    listOrgStudents.mockReset();
  });

  it('shows the search-empty EmptyState when a search yields no rows', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgStudents.mockResolvedValue({ rows: [], total: 0 });

    const { container } = await renderServerComponent(
      OrganizationStudentsPage({ searchParams: Promise.resolve({ search: 'нет-такого' }) })
    );

    expect(listOrgStudents).toHaveBeenCalledWith({}, expect.objectContaining({
      organizationId: 'org-1',
      search: 'нет-такого'
    }));
    expect(container.textContent).toContain('По запросу никого не нашли');
    expect(container.textContent).toContain('по запросу «нет-такого»');
  });

  it('shows the no-search EmptyState when the org has zero students', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgStudents.mockResolvedValue({ rows: [], total: 0 });

    const { container } = await renderServerComponent(
      OrganizationStudentsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('пока нет сотрудников');
  });

  it('renders a students table with pagination when there is more than one page', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgStudents.mockResolvedValue({
      rows: [
        {
          id: 's1',
          name: 'Иванов Иван',
          email: 'ivanov@example.com',
          externalStudentId: 'ext-1',
          createdAt: new Date('2024-03-15')
        },
        {
          id: 's2',
          name: 'Петров Пётр',
          email: 'petrov@example.com',
          externalStudentId: null,
          createdAt: new Date('2024-04-01')
        }
      ],
      total: 120
    });

    const { container } = await renderServerComponent(
      OrganizationStudentsPage({
        searchParams: Promise.resolve({ org: 'org-1', search: 'Иван', take: '50', skip: '50' })
      })
    );

    expect(container.textContent).toContain('Иванов Иван');
    expect(container.textContent).toContain('ext-1');
    expect(container.textContent).toContain('—'); // null externalStudentId fallback
    expect(container.textContent).toContain('Страница 2 из 3');
    expect(container.textContent).toContain('120 сотрудников');
    // both Назад and Вперёд links should render mid-list, carrying both org + search params
    const links = Array.from(container.querySelectorAll('a'));
    const backLink = links.find((a) => a.textContent === 'Назад');
    const nextLink = links.find((a) => a.textContent === 'Вперёд');
    expect(backLink?.getAttribute('href')).toBe(
      '/organization/students?org=org-1&search=%D0%98%D0%B2%D0%B0%D0%BD&take=50'
    );
    expect(nextLink?.getAttribute('href')).toContain('skip=100');
  });

  it('этап 3: при флаге certificates_registry ФИО становится ссылкой на карточку сотрудника', async () => {
    process.env.FEATURE_CERTIFICATES_REGISTRY = '1';
    try {
      getOrgPageContext.mockResolvedValue(CTX);
      listOrgStudents.mockResolvedValue({
        rows: [
          {
            id: 's1',
            name: 'Иванов Иван',
            email: 'ivanov@example.com',
            externalStudentId: null,
            createdAt: new Date('2024-03-15')
          }
        ],
        total: 1
      });

      const { container } = await renderServerComponent(
        OrganizationStudentsPage({ searchParams: Promise.resolve({}) })
      );

      const link = container.querySelector('a[href="/organization/students/s1"]');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Иванов Иван');
    } finally {
      delete process.env.FEATURE_CERTIFICATES_REGISTRY;
    }
  });

  it('pluralizes "1 сотрудник" and "N сотрудника" (2-4) correctly', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    const oneRow = [
      {
        id: 's1',
        name: 'Один Сотрудников',
        email: 'one@example.com',
        externalStudentId: null,
        createdAt: new Date('2024-01-01')
      }
    ];

    listOrgStudents.mockResolvedValue({ rows: oneRow, total: 1 });
    const { container: c1 } = await renderServerComponent(
      OrganizationStudentsPage({ searchParams: Promise.resolve({}) })
    );
    expect(c1.textContent).toContain('1 сотрудник ');

    listOrgStudents.mockResolvedValue({ rows: oneRow, total: 3 });
    const { container: c3 } = await renderServerComponent(
      OrganizationStudentsPage({ searchParams: Promise.resolve({}) })
    );
    expect(c3.textContent).toContain('3 сотрудника');

    // n=22: mod10=2 (2-4 bucket) but mod100=22, which is > 14 -- exercises the
    // `mod100 > 14` half of `(mod100 < 12 || mod100 > 14)` (n=3 above only hits
    // the `mod100 < 12` half).
    listOrgStudents.mockResolvedValue({ rows: oneRow, total: 22 });
    const { container: c22 } = await renderServerComponent(
      OrganizationStudentsPage({ searchParams: Promise.resolve({}) })
    );
    expect(c22.textContent).toContain('22 сотрудника');
  });

  it('hides the paginator when there is exactly one page, and clamps an out-of-range take', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgStudents.mockResolvedValue({ rows: [], total: 5 });

    const { container } = await renderServerComponent(
      OrganizationStudentsPage({ searchParams: Promise.resolve({ take: '99999', skip: 'abc' }) })
    );

    expect(listOrgStudents).toHaveBeenCalledWith({}, expect.objectContaining({ take: 200, skip: 0 }));
    expect(container.textContent).not.toContain('Страница');
  });
});
