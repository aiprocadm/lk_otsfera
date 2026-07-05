import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listMembers } = vi.hoisted(() => ({ listMembers: vi.fn() }));
vi.mock('@/lib/services/organization/team', () => ({ listMembers }));

vi.mock('@/components/partner/invite-customer-admin-form', () => ({
  InviteCustomerAdminForm: ({ organizationId, source, label }: { organizationId: string; source: string; label: string }) =>
    React.createElement('button', { 'data-org': organizationId, 'data-source': source }, label)
}));

import { CustomerAccessSection } from '@/components/partner/customer-access-section';
import type { OrgMemberRow } from '@/lib/services/organization/team';

function makeMember(overrides: Partial<OrgMemberRow> = {}): OrgMemberRow {
  return {
    organizationUserId: 'ou1',
    userId: 'u1',
    email: 'a@x.com',
    name: 'Анна',
    roleInOrg: 'admin',
    isActive: true,
    invitedAt: new Date('2026-01-01'),
    lastLoginAt: null,
    ...overrides
  };
}

describe('CustomerAccessSection (async server component)', () => {
  beforeEach(() => {
    listMembers.mockReset();
  });

  it('renders the "no active admin" message when there is no active admin member, and shows the partner-facing hint when canInvite', async () => {
    listMembers.mockResolvedValue([]);
    const element = await CustomerAccessSection({ organizationId: 'org1', canInvite: true });
    const html = renderToString(element);
    expect(html).toContain('пока нет активных администраторов');
    expect(html).toContain('Пригласите первого, чтобы клиент мог самостоятельно видеть свои заказы.');
  });

  it('shows the read-only hint (partner-admin phrasing) when canInvite is false and there is no active admin', async () => {
    listMembers.mockResolvedValue([]);
    const element = await CustomerAccessSection({ organizationId: 'org1', canInvite: false });
    const html = renderToString(element);
    expect(html).toContain('Партнёр-администратор может пригласить первого через эту страницу.');
  });

  it('lists active admin members with name, email and invited-since date', async () => {
    listMembers.mockResolvedValue([makeMember({ name: 'Иван Петров', email: 'ivan@x.com', invitedAt: new Date('2026-02-15') })]);
    const element = await CustomerAccessSection({ organizationId: 'org1', canInvite: true });
    const html = renderToString(element);
    expect(html).toContain('Иван Петров');
    expect(html).toContain('ivan@x.com');
    expect(html).toContain('15.02.2026');
  });

  it('excludes inactive admins and non-admin roles from the active-admin list', async () => {
    listMembers.mockResolvedValue([
      makeMember({ organizationUserId: 'ou2', name: 'Неактивный', isActive: false }),
      makeMember({ organizationUserId: 'ou3', name: 'Участник', roleInOrg: 'member' })
    ]);
    const element = await CustomerAccessSection({ organizationId: 'org1', canInvite: true });
    const html = renderToString(element);
    expect(html).not.toContain('Неактивный');
    expect(html).not.toContain('Участник');
    expect(html).toContain('пока нет активных администраторов');
  });

  it('hides the invite form when canInvite is false', async () => {
    listMembers.mockResolvedValue([makeMember()]);
    const element = await CustomerAccessSection({ organizationId: 'org1', canInvite: false });
    const html = renderToString(element);
    expect(html).not.toContain('data-org');
  });

  it('shows "Пригласить администратора" label when there is no active admin yet', async () => {
    listMembers.mockResolvedValue([]);
    const element = await CustomerAccessSection({ organizationId: 'org1', canInvite: true });
    const html = renderToString(element);
    expect(html).toContain('Пригласить администратора');
  });

  it('shows "Пригласить ещё" label when at least one active admin already exists', async () => {
    listMembers.mockResolvedValue([makeMember()]);
    const element = await CustomerAccessSection({ organizationId: 'org1', canInvite: true });
    const html = renderToString(element);
    expect(html).toContain('Пригласить ещё');
  });

  it('defaults source to "partner" and forwards organizationId to the invite form', async () => {
    listMembers.mockResolvedValue([]);
    const element = await CustomerAccessSection({ organizationId: 'org42', canInvite: true });
    const html = renderToString(element);
    expect(html).toContain('data-org="org42"');
    expect(html).toContain('data-source="partner"');
  });

  it('forwards an explicit source="admin" to the invite form', async () => {
    listMembers.mockResolvedValue([]);
    const element = await CustomerAccessSection({ organizationId: 'org42', canInvite: true, source: 'admin' });
    const html = renderToString(element);
    expect(html).toContain('data-source="admin"');
  });
});
