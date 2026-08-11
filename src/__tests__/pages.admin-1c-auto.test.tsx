// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getSyncSummary } = vi.hoisted(() => ({ getSyncSummary: vi.fn() }));
vi.mock('@/lib/services/syncSummary', () => ({ getSyncSummary }));

const { getQueueStats } = vi.hoisted(() => ({ getQueueStats: vi.fn() }));
vi.mock('@/lib/services/admin/queueStats', () => ({ getQueueStats }));

const { loadPausedSchedulerIds } = vi.hoisted(() => ({ loadPausedSchedulerIds: vi.fn() }));
vi.mock('@/lib/jobs/scheduling', () => ({ loadPausedSchedulerIds }));

const { listPendingRecords } = vi.hoisted(() => ({ listPendingRecords: vi.fn() }));
vi.mock('@/lib/services/admin/pendingRecords', () => ({ listPendingRecords }));

vi.mock('@/components/admin/requeue-pending-button', () => ({
  RequeuePendingButton: (props: { id: string }) =>
    React.createElement('button', { 'data-testid': 'requeue' }, props.id),
}));

const { SYNC_ENTITIES } = vi.hoisted(() => ({
  SYNC_ENTITIES: {
    organization: {
      queueName: 'oneCSync.pullOrganizations',
      schedulerId: 'oneCSync.pullOrganizations.cron',
      cronLabel: '0 */6 * * *',
    },
    order: {
      queueName: 'oneCSync.pullOrders',
      schedulerId: 'oneCSync.pullOrders.cron',
      cronLabel: '*/15 * * * *',
    },
    payment: {
      queueName: 'oneCSync.pullPayments',
      schedulerId: 'oneCSync.pullPayments.cron',
      cronLabel: '*/15 * * * *',
    },
    document: {
      queueName: 'oneCSync.pullDocuments',
      schedulerId: 'oneCSync.pullDocuments.cron',
      cronLabel: '0 * * * *',
    },
    certificateExpiry: {
      queueName: 'notifications.certificateExpiry',
      schedulerId: 'notifications.certificateExpiry.cron',
      cronLabel: '0 7 * * *',
    },
    emailPoll: {
      queueName: 'inbound.email.poll',
      schedulerId: 'inbound.email.poll.cron',
      cronLabel: '*/5 * * * *',
    },
    mangoBackfill: {
      queueName: 'telephony.mango.backfill',
      schedulerId: 'telephony.mango.backfill.cron',
      cronLabel: '0 * * * *',
    },
    monthlyCommissions: {
      queueName: 'docs.calculateMonthlyCommissions',
      schedulerId: 'docs.calculateMonthlyCommissions.cron',
      cronLabel: '0 6 1 * *',
    },
  },
}));
vi.mock('@/lib/services/admin/syncControl', () => ({ SYNC_ENTITIES }));

vi.mock('@/components/admin/sync-trigger-button', () => ({
  SyncTriggerButton: (props: { entity: string }) =>
    React.createElement('div', { 'data-testid': 'sync-trigger' }, props.entity),
}));

vi.mock('@/components/admin/sync-schedule-toggle', () => ({
  SyncScheduleToggle: (props: { schedulerId: string; paused: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'sync-schedule-toggle' },
      props.schedulerId,
      String(props.paused)
    ),
}));

vi.mock('@/components/admin/sync-cursor-dialog', () => ({
  SyncCursorDialog: (props: { entity: string; currentCursor: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'sync-cursor-dialog' },
      props.entity,
      String(props.currentCursor)
    ),
}));

import AdminSyncPage from '@/app/admin/settings/integrations/1c/auto/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminSyncPage', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset();
    getSyncSummary.mockReset();
    getQueueStats.mockReset();
    loadPausedSchedulerIds.mockReset();
    listPendingRecords.mockReset();
    listPendingRecords.mockResolvedValue({ ok: true, records: [] });
  });

  it('renders sync summary rows with active queue badge, formatted date, paused toggle, and cursor', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([
      { entity: 'organization', lastSuccessAt: new Date('2024-01-01T10:00:00Z'), cursor: 'cur-1' },
      { entity: 'order', lastSuccessAt: null, cursor: null },
    ]);
    getQueueStats.mockResolvedValue([
      { queue: 'oneCSync.pullOrganizations', counts: { active: 2 } },
    ]);
    loadPausedSchedulerIds.mockResolvedValue(new Set(['oneCSync.pullOrders.cron']));

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(requireSettingsSection).toHaveBeenCalled();
    expect(container.textContent).toContain('Синхронизация с 1С');
    expect(container.textContent).toContain('Организации');
    expect(container.textContent).toContain('выполняется');
    expect(container.textContent).toContain('—');
    const toggles = container.querySelectorAll('[data-testid="sync-schedule-toggle"]');
    expect(toggles.length).toBeGreaterThan(0);
  });

  it('catches getQueueStats/loadPausedSchedulerIds rejections and falls back to empty defaults', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([
      { entity: 'organization', lastSuccessAt: new Date('2024-01-01'), cursor: null },
    ]);
    getQueueStats.mockRejectedValue(new Error('redis down'));
    loadPausedSchedulerIds.mockRejectedValue(new Error('db down'));

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(container.textContent).toContain('Сверка (reconcile)');
    expect(container.textContent).toContain('нет курсора');
  });

  it('shows the reconcile row active-badge when its queue has active jobs', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([]);
    getQueueStats.mockResolvedValue([{ queue: 'oneCSync.reconcile', counts: { active: 1 } }]);
    loadPausedSchedulerIds.mockResolvedValue(new Set());

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(container.textContent).toContain('Сверка (reconcile)');
    expect(container.textContent).toContain('выполняется');
  });

  it('renders the background jobs section: 4 rows with RU labels, cron strings, activity badge and trigger buttons (G3)', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([]);
    // Одна фоновая очередь активна → ровно один бейдж «выполняется» в секции.
    getQueueStats.mockResolvedValue([{ queue: 'inbound.email.poll', counts: { active: 1 } }]);
    loadPausedSchedulerIds.mockResolvedValue(new Set());

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(container.textContent).toContain('Прочие фоновые задачи');
    // RU-названия задач
    expect(container.textContent).toContain('Напоминания об истечении удостоверений');
    expect(container.textContent).toContain('Поллинг входящей почты');
    expect(container.textContent).toContain('Бэкфилл звонков Mango');
    expect(container.textContent).toContain('Расчёт ежемесячных комиссий');
    // cron-строки из реестра
    expect(container.textContent).toContain('0 7 * * *');
    expect(container.textContent).toContain('*/5 * * * *');
    expect(container.textContent).toContain('0 6 1 * *');
    // кнопки запуска: reconcile (основная таблица) + 4 фоновые задачи
    const triggers = Array.from(container.querySelectorAll('[data-testid="sync-trigger"]')).map(
      (el) => el.textContent
    );
    expect(triggers).toEqual(
      expect.arrayContaining([
        'certificateExpiry',
        'emailPoll',
        'mangoBackfill',
        'monthlyCommissions',
      ])
    );
    // колонка «Сейчас»: active>0 у inbound.email.poll → ровно один бейдж на странице
    const badges = Array.from(container.querySelectorAll('span')).filter(
      (el) => el.textContent === 'выполняется'
    );
    expect(badges).toHaveLength(1);
    // пояснение, где смотреть результаты
    expect(container.textContent).toContain('уведомления');
    expect(container.textContent).toContain('инбокс');
    expect(container.textContent).toContain('звонки');
    expect(container.textContent).toContain('ведомост');
  });

  it('renders the 1C pending records section: dead row gets a requeue button, pending row does not', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([]);
    getQueueStats.mockResolvedValue([]);
    loadPausedSchedulerIds.mockResolvedValue(new Set());
    listPendingRecords.mockResolvedValue({
      ok: true,
      records: [
        {
          id: 'd1',
          entity: 'order',
          externalId: 'ORD-1',
          reason: 'organization_not_found',
          attempts: 5,
          status: 'dead',
          firstSeenAt: new Date('2026-07-01T10:00:00Z'),
          lastTriedAt: new Date('2026-07-02T10:00:00Z'),
        },
        {
          id: 'p1',
          entity: 'payment',
          externalId: 'PAY-1',
          reason: 'order_not_found',
          attempts: 1,
          status: 'pending',
          firstSeenAt: new Date('2026-07-03T10:00:00Z'),
          lastTriedAt: new Date('2026-07-04T10:00:00Z'),
        },
      ],
    });

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(listPendingRecords).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Отложенные записи 1С');
    expect(container.textContent).toContain('ORD-1');
    expect(container.textContent).toContain('PAY-1');
    const requeueButtons = container.querySelectorAll('[data-testid="requeue"]');
    expect(requeueButtons).toHaveLength(1);
    expect(requeueButtons[0].textContent).toBe('d1');
  });

  it('pending section: empty state on ok with no records and on non-ok result', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([]);
    getQueueStats.mockResolvedValue([]);
    loadPausedSchedulerIds.mockResolvedValue(new Set());
    listPendingRecords.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(container.textContent).toContain('Отложенных записей нет');
  });

  it('pending section degrades gracefully when listPendingRecords rejects', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    getSyncSummary.mockResolvedValue([]);
    getQueueStats.mockResolvedValue([]);
    loadPausedSchedulerIds.mockResolvedValue(new Set());
    listPendingRecords.mockRejectedValue(new Error('db down'));

    const { container } = await renderServerComponent(AdminSyncPage());

    expect(container.textContent).toContain('Отложенные записи 1С');
    expect(container.textContent).toContain('Отложенных записей нет');
  });
});
