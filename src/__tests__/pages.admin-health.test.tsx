// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getSyncLag } = vi.hoisted(() => ({ getSyncLag: vi.fn() }));
vi.mock('@/lib/services/admin/syncHealth', () => ({ getSyncLag }));

const { getQueueStats, getDlq } = vi.hoisted(() => ({ getQueueStats: vi.fn(), getDlq: vi.fn() }));
vi.mock('@/lib/services/admin/queueStats', () => ({ getQueueStats, getDlq }));

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

import AdminHealthPage from '@/app/admin/health/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminHealthPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getSyncLag.mockReset();
    getQueueStats.mockReset();
    getDlq.mockReset();
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

  it('renders lagMs:null as em-dash badge, empty sync/queue/dlq states, and catches getSyncLag/getQueueStats/getDlq rejections', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getSyncLag.mockRejectedValue(new Error('db down'));
    getQueueStats.mockRejectedValue(new Error('redis down'));
    getDlq.mockRejectedValue(new Error('redis down'));

    const { container } = await renderServerComponent(AdminHealthPage());

    expect(container.textContent).toContain('сейчас недоступны');
    expect(container.textContent).toContain('проверьте Redis');
    expect(container.querySelector('[data-testid="dlq-table"]')).not.toBeNull();
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
