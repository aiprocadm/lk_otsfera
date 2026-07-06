import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { DlqTable } from '@/components/admin/dlq-table';
import type { DlqRow } from '@/lib/services/admin/queueStats';

function makeRow(overrides: Partial<DlqRow> = {}): DlqRow {
  return {
    queue: 'oneCSync.pullOrders' as DlqRow['queue'],
    jobId: 'job-1',
    name: 'pull-orders',
    failedReason: 'Timeout',
    failedAt: new Date(),
    attemptsMade: 5,
    ...overrides
  };
}

describe('DlqTable', () => {
  it('renders empty state message when there are no rows', () => {
    const html = renderToString(React.createElement(DlqTable, { rows: [] }));
    expect(html).toContain('Все очереди чисты');
  });

  it('renders a row with queue, jobId, name, failedReason, attempts', () => {
    const rows = [makeRow()];
    const html = renderToString(React.createElement(DlqTable, { rows }));
    expect(html).toContain('oneCSync.pullOrders');
    expect(html).toContain('job-1');
    expect(html).toContain('pull-orders');
    expect(html).toContain('Timeout');
    expect(html).toContain('>5<');
  });

  it('renders "—" when failedReason is null', () => {
    const rows = [makeRow({ failedReason: null })];
    const html = renderToString(React.createElement(DlqTable, { rows }));
    expect(html).toContain('—');
  });

  it('age label: seconds when failedAt is < 60s ago', () => {
    const rows = [makeRow({ failedAt: new Date(Date.now() - 5000) })];
    const html = renderToString(React.createElement(DlqTable, { rows }));
    expect(html).toMatch(/\d+с/);
  });

  it('age label: minutes when failedAt is minutes ago', () => {
    const rows = [makeRow({ failedAt: new Date(Date.now() - 5 * 60 * 1000) })];
    const html = renderToString(React.createElement(DlqTable, { rows }));
    expect(html).toMatch(/\dм/);
  });

  it('age label: hours when failedAt is hours ago', () => {
    const rows = [makeRow({ failedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })];
    const html = renderToString(React.createElement(DlqTable, { rows }));
    expect(html).toMatch(/\dч/);
  });

  it('age label: days when failedAt is days ago', () => {
    const rows = [makeRow({ failedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })];
    const html = renderToString(React.createElement(DlqTable, { rows }));
    expect(html).toMatch(/\dд/);
  });

  it('age label: "—" when failedAt is null', () => {
    const rows = [makeRow({ failedAt: null })];
    const html = renderToString(React.createElement(DlqTable, { rows }));
    expect(html).toContain('—');
  });

  it('renders multiple rows keyed by queue:jobId', () => {
    const rows = [makeRow({ jobId: 'j1' }), makeRow({ jobId: 'j2' })];
    const html = renderToString(React.createElement(DlqTable, { rows }));
    expect(html).toContain('j1');
    expect(html).toContain('j2');
  });
});
