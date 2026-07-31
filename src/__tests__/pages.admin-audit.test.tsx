// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminAuditPage from '@/app/admin/audit/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listAudit, listAuditFilters } = vi.hoisted(() => ({
  listAudit: vi.fn(),
  listAuditFilters: vi.fn()
}));
vi.mock('@/lib/services/admin/auditLog', () => ({ listAudit, listAuditFilters }));

vi.mock('@/components/admin/audit-log-filters', () => ({
  AuditLogFilters: (props: { entities: unknown[]; actions: unknown[]; actors: unknown[]; current: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'audit-filters' },
      JSON.stringify(props.entities),
      JSON.stringify(props.current)
    )
}));

vi.mock('@/components/admin/audit-log-table', () => ({
  AuditLogTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'audit-table' }, JSON.stringify(props.rows))
}));


const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminAuditPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listAudit.mockReset();
    listAuditFilters.mockReset();
  });

  it('parses filters (entity/action/actorUserId/from/to/q) and passes them to listAudit, renders nextCursor "load more" link', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAudit.mockResolvedValue({ rows: [{ id: 'a1' }], nextCursor: 'cur-2' });
    listAuditFilters.mockResolvedValue({ entities: ['order'], actions: ['order_created'], actors: [] });

    const { container } = await renderServerComponent(
      AdminAuditPage({
        searchParams: Promise.resolve({
          entity: 'order',
          action: 'order_created',
          actorUserId: 'u1',
          from: '2024-01-01',
          to: '2024-02-01',
          q: '  test  '
        })
      })
    );

    expect(requireAdmin).toHaveBeenCalled();
    expect(listAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        entity: 'order',
        action: 'order_created',
        actorUserId: 'u1',
        q: 'test',
        take: 50
      })
    );
    expect(container.textContent).toContain('Аудит');
    const link = container.querySelector('a[href^="/admin/audit?"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toContain('cursor=cur-2');
  });

  it('treats an invalid "from" date as undefined and omits empty q/cursor, and does not render load-more when nextCursor is null', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAudit.mockResolvedValue({ rows: [], nextCursor: null });
    listAuditFilters.mockResolvedValue({ entities: [], actions: [], actors: [] });

    const { container } = await renderServerComponent(
      AdminAuditPage({ searchParams: Promise.resolve({ from: 'not-a-date' }) })
    );

    expect(listAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ from: undefined, q: undefined, cursor: undefined })
    );
    expect(container.querySelector('a[href^="/admin/audit?"]')).toBeNull();
  });
});
