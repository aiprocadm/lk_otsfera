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

const { listExchangeHistory } = vi.hoisted(() => ({ listExchangeHistory: vi.fn() }));
vi.mock('@/lib/services/import/history', () => ({ listExchangeHistory }));

vi.mock('@/components/admin/sync-trigger-button', () => ({
  SyncTriggerButton: (props: { entity: string }) =>
    React.createElement('button', { 'data-testid': `trigger-${props.entity}` }),
}));
vi.mock('@/components/admin/sync-schedule-toggle', () => ({
  SyncScheduleToggle: (props: { schedulerId: string }) =>
    React.createElement('button', { 'data-testid': `pause-${props.schedulerId}` }),
}));
vi.mock('@/components/admin/sync-cursor-dialog', () => ({
  SyncCursorDialog: (props: { entity: string }) =>
    React.createElement('button', { 'data-testid': `cursor-${props.entity}` }),
}));
vi.mock('@/components/admin/pending-records-section', () => ({
  PendingRecordsSection: () => React.createElement('div', { 'data-testid': 'pending-records' }),
}));
vi.mock('@/components/import/exchange-history', () => ({
  ExchangeHistory: (props: { items: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'exchange-history' }, String(props.items.length)),
}));

import LeaderSyncPage from '@/app/leader/settings/integrations/1c/auto/page';
import LeaderOneCHistoryPage from '@/app/leader/settings/integrations/1c/history/page';
import LeaderOneCIndexPage from '@/app/leader/settings/integrations/1c/page';
import AdminSyncPage from '@/app/admin/settings/integrations/1c/auto/page';

const LEADER = { sub: 'l1', role: 'leader' as const, companyId: 'c1' };
const ADMIN = { sub: 'a1', role: 'admin' as const };

beforeEach(() => {
  requireSettingsSection
    .mockReset()
    .mockImplementation((_id: string, cabinet: string) =>
      Promise.resolve(cabinet === 'admin' ? ADMIN : LEADER)
    );
  getSyncSummary
    .mockReset()
    .mockResolvedValue([
      { entity: 'organization', lastSuccessAt: new Date('2024-01-01T10:00:00Z'), cursor: 'cur-1' },
    ]);
  getQueueStats.mockReset().mockResolvedValue([]);
  loadPausedSchedulerIds.mockReset().mockResolvedValue(new Set<string>());
  listPendingRecords.mockReset().mockResolvedValue({ ok: true, records: [] });
  listExchangeHistory.mockReset().mockResolvedValue({ ok: true, items: [] });
});

/**
 * `У-118` (дефект `Д-33`): вкладки «Автообмен» и «История» у руководителя были
 * видны в переключателе, но вели на «страница не найдена». При вставшем обмене
 * руководитель не мог ни посмотреть состояние, ни запустить обмен руками.
 */
describe('«Обмен с 1С» руководителя: вкладки существуют (У-118)', () => {
  it('корень раздела спрашивает, что человек хочет сделать, а не бросает в форму', async () => {
    const { container } = await renderServerComponent(LeaderOneCIndexPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', 'leader');
    expect(container.querySelector('h1')?.textContent).toBe('Обмен с 1С');
    expect(container.textContent).toContain('Что вы хотите сделать?');
    // Навигатор ведёт в СВОЙ кабинет.
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/leader/settings/integrations/1c/auto');
    expect(hrefs.filter((h) => h?.startsWith('/admin/'))).toEqual([]);
  });

  it('«Автообмен»: состояние расписаний и ручной запуск есть', async () => {
    const { container } = await renderServerComponent(LeaderSyncPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', 'leader');
    expect(container.querySelector('h1')?.textContent).toBe('Автообмен');
    expect(container.querySelector('[data-testid="trigger-organization"]')).not.toBeNull();
    expect(container.textContent).toContain('работает');
  });

  it('«Автообмен»: платформенные рычаги руководителю не даём', async () => {
    // Пауза расписания и перемотка курсора задевают все компании сразу —
    // остаются админскими. Очередь разбора — тоже админская, и сервис за ней
    // даже не вызывается.
    const { container } = await renderServerComponent(LeaderSyncPage());
    expect(container.querySelector('[data-testid^="pause-"]')).toBeNull();
    expect(container.querySelector('[data-testid^="cursor-"]')).toBeNull();
    expect(container.querySelector('[data-testid="pending-records"]')).toBeNull();
    expect(listPendingRecords).not.toHaveBeenCalled();
  });

  it('у админа те же рычаги на месте — экран общий, но не урезанный', async () => {
    const { container } = await renderServerComponent(AdminSyncPage());
    expect(
      container.querySelector('[data-testid="pause-oneCSync.pullOrganizations.cron"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="cursor-organization"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pending-records"]')).not.toBeNull();
    expect(listPendingRecords).toHaveBeenCalled();
  });

  it('«История»: экран есть, скоуп режет сервис', async () => {
    const { container } = await renderServerComponent(LeaderOneCHistoryPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', 'leader');
    expect(listExchangeHistory).toHaveBeenCalledWith({}, LEADER);
    expect(container.querySelector('[data-testid="exchange-history"]')).not.toBeNull();
  });

  it('«История»: отказ сервиса — понятный текст, а не пустой экран', async () => {
    listExchangeHistory.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(LeaderOneCHistoryPage());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Недостаточно прав');
  });
});
