import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listManagersForOrg } = vi.hoisted(() => ({ listManagersForOrg: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listManagersForOrg }));

vi.mock('@/server-actions/admin/manager', () => ({
  deactivateManagerAssignmentFormAction: vi.fn(),
  reactivateManagerAssignmentFormAction: vi.fn()
}));

vi.mock('@/components/admin/assign-or-invite-manager-form', () => ({
  AssignOrInviteManagerForm: ({ organizationId }: { organizationId: string }) =>
    React.createElement('div', { 'data-testid': 'assign-form' }, organizationId)
}));

import { ManagersBlock } from '@/components/admin/managers-block';

function makeAssignment(overrides: Partial<{
  id: string;
  assignedAt: Date;
  deactivatedAt: Date | null;
  user: { name: string | null; email: string };
}> = {}) {
  return {
    id: 'assign-1',
    assignedAt: new Date('2026-01-15'),
    deactivatedAt: null,
    user: { name: 'Иван Иванов', email: 'ivan@example.com' },
    ...overrides
  };
}

describe('ManagersBlock', () => {
  beforeEach(() => {
    listManagersForOrg.mockReset();
  });

  it('renders the "no managers" notice when both active and inactive are empty', async () => {
    listManagersForOrg.mockResolvedValue({ active: [], inactive: [] });

    const el = await ManagersBlock({ orgId: 'org-1' });
    const html = renderToString(el);

    expect(html).toContain('пока нет назначенных менеджеров');
    expect(html).toContain('org-1');
  });

  it('renders an active manager row with name, email, assignedAt, and deactivate action', async () => {
    listManagersForOrg.mockResolvedValue({
      active: [makeAssignment()],
      inactive: []
    });

    const el = await ManagersBlock({ orgId: 'org-1' });
    const html = renderToString(el);

    expect(html).toContain('Иван Иванов');
    expect(html).toContain('ivan@example.com');
    expect(html).toContain('15.01.2026');
    expect(html).toContain('Деактивировать');
    expect(html).not.toContain('пока нет назначенных менеджеров');
  });

  it('renders "—" when an active manager has no name', async () => {
    listManagersForOrg.mockResolvedValue({
      active: [makeAssignment({ user: { name: null, email: 'noname@example.com' } })],
      inactive: []
    });

    const el = await ManagersBlock({ orgId: 'org-1' });
    const html = renderToString(el);

    expect(html).toContain('—');
    expect(html).toContain('noname@example.com');
  });

  it('renders the "Архив" section with inactive managers and reactivate action', async () => {
    listManagersForOrg.mockResolvedValue({
      active: [],
      inactive: [makeAssignment({ id: 'assign-2', deactivatedAt: new Date('2026-02-01') })]
    });

    const el = await ManagersBlock({ orgId: 'org-1' });
    const html = renderToString(el);

    expect(html).toContain('Архив');
    expect(html).toContain('деактивирован');
    expect(html).toContain('01.02.2026');
    expect(html).toContain('Возобновить');
  });

  it('renders "—" when an inactive manager has no name', async () => {
    listManagersForOrg.mockResolvedValue({
      active: [],
      inactive: [makeAssignment({
        id: 'assign-noname',
        user: { name: null, email: 'noname2@example.com' },
        deactivatedAt: new Date('2026-02-05')
      })]
    });

    const el = await ManagersBlock({ orgId: 'org-1' });
    const html = renderToString(el);

    expect(html).toContain('—');
    expect(html).toContain('noname2@example.com');
  });

  it('omits the deactivatedAt label when it is null on an inactive row', async () => {
    listManagersForOrg.mockResolvedValue({
      active: [],
      inactive: [makeAssignment({ id: 'assign-3', deactivatedAt: null })]
    });

    const el = await ManagersBlock({ orgId: 'org-1' });
    const html = renderToString(el);

    expect(html).not.toContain('деактивирован');
    expect(html).toContain('Возобновить');
  });

  it('renders both active and inactive lists together', async () => {
    listManagersForOrg.mockResolvedValue({
      active: [makeAssignment({ id: 'a1' })],
      inactive: [makeAssignment({ id: 'a2', deactivatedAt: new Date('2026-03-01') })]
    });

    const el = await ManagersBlock({ orgId: 'org-1' });
    const html = renderToString(el);

    expect(html).toContain('Деактивировать');
    expect(html).toContain('Возобновить');
    expect(html).toContain('Архив');
  });
});
