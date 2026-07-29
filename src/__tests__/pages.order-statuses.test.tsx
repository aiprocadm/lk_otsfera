// @vitest-environment jsdom
/**
 * §10 ТЗ v0.5 (этап 2, PR-2) — страницы справочника статусов: админская и
 * зеркало в кабинете руководителя (§4 ТЗ даёт настройку статусов и ему, а
 * Model A запрещает пускать его в `/admin/*`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin, requireManagerLeader } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManagerLeader: vi.fn()
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin, requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listStatusDefinitions } = vi.hoisted(() => ({ listStatusDefinitions: vi.fn() }));
vi.mock('@/lib/services/orderStatuses', () => ({ listStatusDefinitions }));

vi.mock('@/components/admin/order-statuses-admin', () => ({
  OrderStatusesAdmin: (props: { rows: { id: string }[] }) =>
    React.createElement('div', { 'data-testid': 'statuses' }, JSON.stringify(props.rows))
}));

import AdminOrderStatusesPage from '@/app/admin/order-statuses/page';
import LeaderOrderStatusesPage from '@/app/leader/settings/order-statuses/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'manager' as const, managerRole: 'leader' as const };

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue(ADMIN);
  requireManagerLeader.mockReset().mockResolvedValue(LEADER);
  listStatusDefinitions.mockReset().mockResolvedValue({ ok: true, rows: [{ id: 's1' }] });
});

describe('AdminOrderStatusesPage', () => {
  it('гард админа, справочник отдаётся компоненту', async () => {
    const { container } = await renderServerComponent(AdminOrderStatusesPage());
    expect(requireAdmin).toHaveBeenCalled();
    expect(listStatusDefinitions).toHaveBeenCalledWith({}, ADMIN);
    expect(container.textContent).toContain('s1');
  });

  it('отказ сервиса даёт пустой список, а не падение', async () => {
    listStatusDefinitions.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(AdminOrderStatusesPage());
    expect(container.textContent).toContain('[]');
  });
});

describe('LeaderOrderStatusesPage', () => {
  it('гард руководителя, тот же сервис', async () => {
    const { container } = await renderServerComponent(LeaderOrderStatusesPage());
    expect(requireManagerLeader).toHaveBeenCalled();
    expect(listStatusDefinitions).toHaveBeenCalledWith({}, LEADER);
    expect(container.textContent).toContain('s1');
  });

  it('отказ сервиса даёт пустой список', async () => {
    listStatusDefinitions.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(LeaderOrderStatusesPage());
    expect(container.textContent).toContain('[]');
  });
});
