// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminHealthPage from '@/app/admin/health/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getSyncLag } = vi.hoisted(() => ({ getSyncLag: vi.fn() }));
vi.mock('@/lib/services/admin/syncHealth', () => ({ getSyncLag }));

const { getQueueStats, getDlq } = vi.hoisted(() => ({ getQueueStats: vi.fn(), getDlq: vi.fn() }));
vi.mock('@/lib/services/admin/queueStats', () => ({ getQueueStats, getDlq }));

const { listAlertStates } = vi.hoisted(() => ({ listAlertStates: vi.fn() }));
vi.mock('@/lib/services/admin/alerts', () => ({ listAlertStates }));

const { listSyncErrors } = vi.hoisted(() => ({ listSyncErrors: vi.fn() }));
vi.mock('@/lib/services/syncSummary', () => ({ listSyncErrors }));

vi.mock('@/components/admin/queue-stats-grid', () => ({
  QueueStatsGrid: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'queue-stats-grid' }, JSON.stringify(props.rows))
}));

vi.mock('@/components/admin/dlq-table', () => ({
  DlqTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'dlq-table' }, JSON.stringify(props.rows))
}));

vi.mock('@/components/admin/retry-all-button', () => ({
  RetryAllButton: (props: { queue: string }) =>
    React.createElement('div', { 'data-testid': 'retry-all-button' }, props.queue)
}));

vi.mock('@/components/admin/alerts-section', () => ({
  AlertsSection: (props: { alerts: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'alerts-section' }, JSON.stringify(props.alerts))
}));

vi.mock('@/components/admin/sync-errors-section', () => ({
  SyncErrorsSection: (props: { errors: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'sync-errors-section' }, JSON.stringify(props.errors))
}));


const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminHealthPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getSyncLag.mockReset();
    getQueueStats.mockReset();
    getDlq.mockReset();
    listAlertStates.mockReset();
    // дефолты для тестов, где алерты/ошибки не в фокусе
    listAlertStates.mockResolvedValue({ ok: true, alerts: [] });
    listSyncErrors.mockReset();
    listSyncErrors.mockResolvedValue([]);
  });

  it('renders sync lag rows with lag label/badge tiers (seconds/minutes/hours/days) and error highlight', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncLag.mockResolvedValue([
      { entity: 'organization', lagMs: 30 * 1000, successCount24h: 5, errorCount24h: 0 },
      { entity: 'order', lagMs: 5 * 60 * 1000, successCount24h: 2, errorCount24h: 1 },
      { entity: 'payment', lagMs: 3 * 60 * 60 * 1000, successCount24h: 0, errorCount24h: 0 },
      { entity: 'document', lagMs: 2 * 24 * 60 * 60 * 1000, successCount24h: 0, errorCount24h: 0 }
    ]);
    getQueueStats.mockResolvedValue([{ queue: 'docs.scanDocument', counts: { active: 1 } }]);
    getDlq.mockResolvedValue([{ id: 'j1', queue: 'docs.scanDocument' }]);

    const { container } = await renderServerComponent(AdminHealthPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(container.textContent).toContain('Здоровье системы');
    expect(container.textContent).toContain('Организации');
    expect(container.textContent).toContain('30с');
    expect(container.textContent).toContain('5м');
    expect(container.textContent).toContain('3ч');
    expect(container.textContent).toContain('2д');
    expect(container.querySelector('[data-testid="queue-stats-grid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="retry-all-button"]')).not.toBeNull();
  });

  it('передаёт алерты и ошибки синхронизации в обе новые секции', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncLag.mockResolvedValue([]);
    getQueueStats.mockResolvedValue([]);
    getDlq.mockResolvedValue([]);
    listAlertStates.mockResolvedValue({ ok: true, alerts: [{ key: 'dlq_depth', status: 'firing' }] });
    listSyncErrors.mockResolvedValue([{ id: 'sl1', entity: 'payment' }]);

    const { container } = await renderServerComponent(AdminHealthPage());

    expect(listAlertStates).toHaveBeenCalledWith(expect.anything(), SESSION);
    const alerts = container.querySelector('[data-testid="alerts-section"]');
    expect(alerts?.textContent).toContain('dlq_depth');
    const errors = container.querySelector('[data-testid="sync-errors-section"]');
    expect(errors?.textContent).toContain('sl1');

    // подзаголовок упоминает алерты и ошибки синхронизации
    expect(container.textContent).toContain('алерты и последние ошибки синхронизации');
    // алерты — первая секция: firing-блок идёт раньше таблицы лага
    const lagHeading = Array.from(container.querySelectorAll('h2')).find(
      (h) => h.textContent === 'Лаг синхронизации'
    );
    expect(lagHeading).toBeDefined();
    expect(
      alerts!.compareDocumentPosition(lagHeading!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('forbidden-ветка listAlertStates деградирует в пустой список алертов', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncLag.mockResolvedValue([]);
    getQueueStats.mockResolvedValue([]);
    getDlq.mockResolvedValue([]);
    listAlertStates.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(AdminHealthPage());

    expect(container.querySelector('[data-testid="alerts-section"]')?.textContent).toBe('[]');
  });

  it('renders lagMs:null as em-dash badge, empty sync/queue/dlq states, and catches all section rejections', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncLag.mockRejectedValue(new Error('db down'));
    getQueueStats.mockRejectedValue(new Error('redis down'));
    getDlq.mockRejectedValue(new Error('redis down'));
    listAlertStates.mockRejectedValue(new Error('db down'));
    listSyncErrors.mockRejectedValue(new Error('db down'));

    const { container } = await renderServerComponent(AdminHealthPage());

    expect(container.textContent).toContain('сейчас недоступны');
    expect(container.textContent).toContain('проверьте Redis');
    expect(container.querySelector('[data-testid="dlq-table"]')).not.toBeNull();
    // graceful degrade: обе новые секции рендерятся с пустыми данными
    expect(container.querySelector('[data-testid="alerts-section"]')?.textContent).toBe('[]');
    expect(container.querySelector('[data-testid="sync-errors-section"]')?.textContent).toBe('[]');
  });

  it('renders lagMs:null badge explicitly when a row has no lag data', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncLag.mockResolvedValue([
      { entity: 'organization', lagMs: null, successCount24h: 0, errorCount24h: 0 }
    ]);
    getQueueStats.mockResolvedValue([]);
    getDlq.mockResolvedValue([]);

    const { container } = await renderServerComponent(AdminHealthPage());

    expect(container.textContent).toContain('—');
  });
});
