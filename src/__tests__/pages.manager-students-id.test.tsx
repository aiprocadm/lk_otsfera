// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { studentFindUnique, organizationFindUnique } = vi.hoisted(() => ({
  studentFindUnique: vi.fn(),
  organizationFindUnique: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    student: { findUnique: studentFindUnique },
    organization: { findUnique: organizationFindUnique }
  }
}));

const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ listCertificates }));

const { managedOrgIds, getCompanyTeamVisibility } = vi.hoisted(() => ({
  managedOrgIds: vi.fn(),
  getCompanyTeamVisibility: vi.fn()
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ managedOrgIds, getCompanyTeamVisibility }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/training/certificate-list', () => ({
  CertificateList: (props: { certificates: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'cert-list' }, JSON.stringify(props.certificates))
}));

import ManagerStudentDetailPage from '@/app/manager/students/[id]/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

const STUDENT = {
  id: 's1',
  name: 'Иван Иванов',
  email: 'ivan@x.com',
  organizationId: 'org-1',
  createdAt: new Date('2024-01-01'),
  organization: { id: 'org-1', name: 'Org' }
};

describe('ManagerStudentDetailPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    studentFindUnique.mockReset();
    organizationFindUnique.mockReset();
    listCertificates.mockReset();
    managedOrgIds.mockReset();
    getCompanyTeamVisibility.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when the student does not exist', async () => {
    requireManager.mockResolvedValue(SESSION);
    studentFindUnique.mockResolvedValue(null);

    await expect(
      renderServerComponent(ManagerStudentDetailPage({ params: Promise.resolve({ id: 'missing' }) }))
    ).rejects.toThrow('NOT_FOUND');

    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
  });

  it('teamMode:true — calls notFound() when the org is not in the same company', async () => {
    requireManager.mockResolvedValue(SESSION);
    studentFindUnique.mockResolvedValue(STUDENT);
    getCompanyTeamVisibility.mockResolvedValue(true);
    organizationFindUnique.mockResolvedValue({ companyId: 'other-company' });

    await expect(
      renderServerComponent(ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('teamMode:true — calls notFound() when the org lookup returns null', async () => {
    requireManager.mockResolvedValue(SESSION);
    studentFindUnique.mockResolvedValue(STUDENT);
    getCompanyTeamVisibility.mockResolvedValue(true);
    organizationFindUnique.mockResolvedValue(null);

    await expect(
      renderServerComponent(ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('teamMode:true — renders when the org matches the session companyId', async () => {
    requireManager.mockResolvedValue(SESSION);
    studentFindUnique.mockResolvedValue(STUDENT);
    getCompanyTeamVisibility.mockResolvedValue(true);
    organizationFindUnique.mockResolvedValue({ companyId: 'c1' });
    listCertificates.mockResolvedValue({ ok: true, certificates: [{ id: 'cert1' }] });

    const { container } = await renderServerComponent(
      ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) })
    );

    expect(container.textContent).toContain('Иван Иванов');
    expect(container.textContent).toContain('Org');
    expect(container.textContent).toContain('cert1');
  });

  it('teamMode:false — calls notFound() when the org is not in managedOrgIds', async () => {
    requireManager.mockResolvedValue(SESSION);
    studentFindUnique.mockResolvedValue(STUDENT);
    getCompanyTeamVisibility.mockResolvedValue(false);
    managedOrgIds.mockReturnValue(['org-2']);

    await expect(
      renderServerComponent(ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) }))
    ).rejects.toThrow('NOT_FOUND');

    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it('teamMode:false — renders when the org is in managedOrgIds, falling back to empty certificates on ok:false', async () => {
    requireManager.mockResolvedValue(SESSION);
    studentFindUnique.mockResolvedValue(STUDENT);
    getCompanyTeamVisibility.mockResolvedValue(false);
    managedOrgIds.mockReturnValue(['org-1']);
    listCertificates.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) })
    );

    expect(container.textContent).toContain('Иван Иванов');
  });
});
