// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listManagerLeads } = vi.hoisted(() => ({ listManagerLeads: vi.fn() }));
vi.mock('@/lib/services/manager/leads', () => ({ listManagerLeads }));

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

import ManagerLeadsPage from '@/app/manager/leads/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

describe('ManagerLeadsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listManagerLeads.mockReset();
  });

  it('passes an undefined status for an unrecognized status value', async () => {
    requireManager.mockResolvedValue(SESSION);
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });

    await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({ status: 'bogus' }) })
    );

    expect(listManagerLeads).toHaveBeenCalledWith(
      {},
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
      {},
      { status: 'new', search: 'ООО', assignedToUserId: 'u1', cursor: 'c1' }
    );
    expect(container.textContent).toContain('Заявки');
    expect(container.textContent).toContain('l1');
  });

  it('does not scope to assignedToUserId when assignedToMe is not "1"', async () => {
    requireManager.mockResolvedValue(SESSION);
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });

    await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({ assignedToMe: '0' }) })
    );

    expect(listManagerLeads).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ assignedToUserId: undefined })
    );
  });
});
