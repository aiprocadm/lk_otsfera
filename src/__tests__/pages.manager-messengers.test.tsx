// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerMessengersPage from '@/app/manager/messengers/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDialogs, listDialogCandidates } = vi.hoisted(() => ({
  listDialogs: vi.fn(),
  listDialogCandidates: vi.fn(),
}));
vi.mock('@/lib/services/messengers/list', () => ({ listDialogs }));
vi.mock('@/lib/services/messengers/start', () => ({ listDialogCandidates }));

vi.mock('@/components/manager/messengers/dialog-list', () => ({
  DialogList: (props: { items: { id: string }[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'dialog-list' },
      props.items.map((i) => i.id).join(',')
    ),
}));
vi.mock('@/components/manager/messengers/new-dialog-button', () => ({
  NewDialogButton: (props: { candidates: unknown[] }) =>
    React.createElement('button', null, `Новый диалог (${props.candidates.length})`),
}));

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

/**
 * Экран «Мессенджеры» (спека 2026-09-12 §5.1): гейт флага, разбор фильтров,
 * пустое состояние с кнопкой, список и пагинация.
 */
describe('ManagerMessengersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listDialogs.mockResolvedValue({ items: [], total: 0 });
    listDialogCandidates.mockResolvedValue([]);
  });

  it('флаг inbound_messaging выключен → notFound без обращения к сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(ManagerMessengersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('без параметров: первая страница, пустое состояние с главной кнопкой', async () => {
    const { container } = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({}) })
    );
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Мессенджеры');
    expect(container.textContent).toContain('Переписка с клиентами');
    expect(container.textContent).toContain('Диалогов пока нет');
    // Кнопка и в шапке, и в пустом состоянии.
    expect(container.textContent?.match(/Новый диалог \(0\)/g)?.length).toBe(2);
  });

  it('фильтры и skip разбираются; мусорные значения отбрасываются', async () => {
    listDialogs.mockResolvedValue({ items: [{ id: 'd1' }, { id: 'd2' }], total: 60 });
    const { container } = await renderServerComponent(
      ManagerMessengersPage({
        searchParams: Promise.resolve({ channel: 'max', status: 'closed', skip: '50' }),
      })
    );
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, {
      channel: 'max',
      status: 'closed',
      page: 3,
      pageSize: 25,
    });
    expect(container.querySelector('[data-testid="dialog-list"]')?.textContent).toBe('d1,d2');

    listDialogs.mockClear();
    await renderServerComponent(
      ManagerMessengersPage({
        searchParams: Promise.resolve({ channel: 'sms', status: 'archived', skip: 'abc' }),
      })
    );
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
  });

  it('пусто под фильтром — другое объяснение', async () => {
    const { container } = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({ status: 'open' }) })
    );
    expect(container.textContent).toContain('Под этот фильтр диалогов нет');
  });
});
