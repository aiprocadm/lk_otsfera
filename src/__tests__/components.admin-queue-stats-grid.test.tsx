import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

import { QueueStatsGrid } from '@/components/admin/queue-stats-grid';
import type { QueueStatsRow } from '@/lib/services/admin/queueStats';

function makeRow(
  overrides: Partial<QueueStatsRow['counts']> = {},
  queue = 'oneCSync.pullOrders'
): QueueStatsRow {
  return {
    queue: queue as QueueStatsRow['queue'],
    counts: {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      ...overrides,
    },
  };
}

describe('QueueStatsGrid', () => {
  it('renders an empty table when there are no rows', () => {
    const html = renderToString(React.createElement(QueueStatsGrid, { rows: [] }));
    expect(html).toContain('Очередь');
    expect(html).not.toContain('<tr class="border-t');
  });

  it('renders neutral badges when active/failed counts are zero', () => {
    const rows = [makeRow()];
    const html = renderToString(React.createElement(QueueStatsGrid, { rows }));
    expect(html).toContain('oneCSync.pullOrders');
    expect(html).toContain('bg-gray-50 text-gray-600');
    expect(html).not.toContain('bg-red-50 text-red-700');
    expect(html).not.toContain('bg-blue-50 text-blue-700');
  });

  it('renders red failed-badge when failed > 0', () => {
    const rows = [makeRow({ failed: 3 })];
    const html = renderToString(React.createElement(QueueStatsGrid, { rows }));
    expect(html).toContain('bg-red-50 text-red-700');
  });

  it('renders blue active-badge when active > 0', () => {
    const rows = [makeRow({ active: 2 })];
    const html = renderToString(React.createElement(QueueStatsGrid, { rows }));
    expect(html).toContain('bg-blue-50 text-blue-700');
  });

  it('renders waiting/completed/delayed counts as plain numbers', () => {
    const rows = [makeRow({ waiting: 5, completed: 10, delayed: 1 })];
    const html = renderToString(React.createElement(QueueStatsGrid, { rows }));
    expect(html).toContain('>5<');
    expect(html).toContain('>10<');
    expect(html).toContain('>1<');
  });

  it('renders multiple rows keyed by queue name', () => {
    const rows = [makeRow({}, 'docs.scanDocument'), makeRow({}, 'emails.send')];
    const html = renderToString(React.createElement(QueueStatsGrid, { rows }));
    expect(html).toContain('docs.scanDocument');
    expect(html).toContain('emails.send');
  });
});
