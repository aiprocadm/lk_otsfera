// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getSyncSummary } = vi.hoisted(() => ({ getSyncSummary: vi.fn() }));
vi.mock('@/lib/services/syncSummary', () => ({ getSyncSummary }));

const { getQueueStats } = vi.hoisted(() => ({ getQueueStats: vi.fn() }));
vi.mock('@/lib/services/admin/queueStats', () => ({ getQueueStats }));

const { loadPausedSchedulerIds } = vi.hoisted(() => ({ loadPausedSchedulerIds: vi.fn() }));
vi.mock('@/lib/jobs/scheduling', () => ({ loadPausedSchedulerIds }));

const { SYNC_ENTITIES } = vi.hoisted(() => ({
  SYNC_ENTITIES: {
    organization: { queueName: 'oneCSync.pullOrganizations', schedulerId: 'oneCSync.pullOrganizations.cron' },
    order: { queueName: 'oneCSync.pullOrders', schedulerId: 'oneCSync.pullOrders.cron' },
    payment: { queueName: 'oneCSync.pullPayments', schedulerId: 'oneCSync.pullPayments.cron' },
    document: { queueName: 'oneCSync.pullDocuments', schedulerId: 'oneCSync.pullDocuments.cron' }
  }
}));
vi.mock('@/lib/services/admin/syncControl', () => ({ SYNC_ENTITIES }));

vi.mock('@/components/admin/sync-trigger-button', () => ({
  SyncTriggerButton: (props: { entity: string }) =>
    React.createElement('div', { 'data-testid': 'sync-trigger' }, props.entity)
}));

vi.mock('@/components/admin/sync-schedule-toggle', () => ({
  SyncScheduleToggle: (props: { schedulerId: string; paused: boolean }) =>
    React.createElement('div', { 'data-testid': 'sync-schedule-toggle' }, props.schedulerId, String(props.paused))
}));

vi.mock('@/components/admin/sync-cursor-dialog', () => ({
  SyncCursorDialog: (props: { entity: string; currentCursor: unknown }) =>
    React.createElement('div', { 'data-testid': 'sync-cursor-dialog' }, props.entity, String(props.currentCursor))
}));

import AdminSyncPage from '@/app/admin/sync/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminSyncPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getSyncSummary.mockReset();
    getQueueStats.mockReset();
    loadPausedSchedulerIds.mockReset();
  });

  it('renders sync summary rows with active queue badge, formatted date, paused toggle, and cursor', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([
      { entity: 'organization', lastSuccessAt: new Date('2024-01-01T10:00:00Z'), cursor: 'cur-1' },
      { entity: 'order', lastSuccessAt: null, cursor: null }
    ]);
    getQueueStats.mockResolvedValue([{ queue: 'oneCSync.pullOrganizations', counts: { active: 2 } }]);
    loadPausedSchedulerIds.mockResolvedValue(new Set(['oneCSync.pullOrders.cron']));

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(container.textContent).toContain('Управление синхронизацией');
    expect(container.textContent).toContain('Организации');
    expect(container.textContent).toContain('выполняется');
    expect(container.textContent).toContain('—');
    const toggles = container.querySelectorAll('[data-testid="sync-schedule-toggle"]');
    expect(toggles.length).toBeGreaterThan(0);
  });

  it('catches getQueueStats/loadPausedSchedulerIds rejections and falls back to empty defaults', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([
      { entity: 'organization', lastSuccessAt: new Date('2024-01-01'), cursor: null }
    ]);
    getQueueStats.mockRejectedValue(new Error('redis down'));
    loadPausedSchedulerIds.mockRejectedValue(new Error('db down'));

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(container.textContent).toContain('Сверка (reconcile)');
    expect(container.textContent).toContain('нет курсора');
  });

  it('shows the reconcile row active-badge when its queue has active jobs', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([]);
    getQueueStats.mockResolvedValue([{ queue: 'oneCSync.reconcile', counts: { active: 1 } }]);
    loadPausedSchedulerIds.mockResolvedValue(new Set());

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(container.textContent).toContain('Сверка (reconcile)');
    expect(container.textContent).toContain('выполняется');
  });
});
