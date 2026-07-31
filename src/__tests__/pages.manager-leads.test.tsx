// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerLeadsPage from '@/app/manager/leads/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { findManyOrganizations } = vi.hoisted(() => ({ findManyOrganizations: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findMany: findManyOrganizations } } }));

const { listManagerLeads } = vi.hoisted(() => ({ listManagerLeads: vi.fn() }));
vi.mock('@/lib/services/manager/leads', () => ({ listManagerLeads }));

vi.mock('@/components/manager/lead-create-staff-form', () => ({
  LeadCreateStaffForm: (props: { organizations: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'lead-create-form' }, JSON.stringify(props.organizations))
}));

vi.mock('@/components/manager/manager-leads-filter', () => ({
  ManagerLeadsFilter: (props: { query: unknown }) =>
    React.createElement('div', { 'data-testid': 'leads-filter' }, JSON.stringify(props.query))
}));

vi.mock('@/components/manager/manager-leads-table', () => ({
  ManagerLeadsTable: (props: { rows: unknown[]; nextCursor: unknown; query: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'leads-table' },
      JSON.stringify(props.rows),
      String(props.nextCursor),
      JSON.stringify(props.query)
    )
}));


const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

describe('ManagerLeadsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listManagerLeads.mockReset();
    findManyOrganizations.mockReset();
    findManyOrganizations.mockResolvedValue([]);
  });

  it('passes an undefined status for an unrecognized status value', async () => {
    requireManager.mockResolvedValue(SESSION);
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });

    await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({ status: 'bogus' }) })
    );

    expect(listManagerLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: undefined, search: undefined, assignedToUserId: undefined, cursor: undefined })
    );
  });

  it('passes a recognized status through and assignedToUserId when assignedToMe=1', async () => {
    requireManager.mockResolvedValue(SESSION);
    listManagerLeads.mockResolvedValue({ rows: [{ id: 'l1' }], nextCursor: 'c2' });

    const { container } = await renderServerComponent(
      ManagerLeadsPage({
        searchParams: Promise.resolve({ status: 'new', q: 'ООО', assignedToMe: '1', cursor: 'c1' })
      })
    );

    expect(listManagerLeads).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'new', search: 'ООО', assignedToUserId: 'u1', cursor: 'c1' }
    );
    expect(findManyOrganizations).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    });
    expect(container.textContent).toContain('Лиды');
    expect(container.textContent).toContain('l1');
  });

  it('passes an empty organizations list when the manager has no companyId', async () => {
    requireManager.mockResolvedValue({ ...SESSION, companyId: null });
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });

    const { container } = await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({}) })
    );

    expect(findManyOrganizations).not.toHaveBeenCalled();
    expect(container.textContent).toContain('[]');
  });

  it('does not scope to assignedToUserId when assignedToMe is not "1"', async () => {
    requireManager.mockResolvedValue(SESSION);
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });

    await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({ assignedToMe: '0' }) })
    );

    expect(listManagerLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignedToUserId: undefined })
    );
  });
});
