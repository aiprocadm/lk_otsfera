// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerFunnelPage from '@/app/manager/funnel/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getFunnelBoard } = vi.hoisted(() => ({ getFunnelBoard: vi.fn() }));
vi.mock('@/lib/services/funnel/board', () => ({ getFunnelBoard }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/funnel/funnel-board', () => ({
  FunnelBoard: (props: { board: unknown }) =>
    React.createElement('div', { 'data-testid': 'funnel-board' }, JSON.stringify(props.board)),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};

describe('ManagerFunnelPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    isFeatureEnabled.mockReset();
    getFunnelBoard.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when the sales_funnel flag is disabled (before auth check)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(ManagerFunnelPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('sales_funnel');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('renders the funnel board when the flag is enabled', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    getFunnelBoard.mockResolvedValue({ stages: [], columns: [], shown: 0, total: 0 });

    const { container } = await renderServerComponent(ManagerFunnelPage());

    expect(getFunnelBoard).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Воронка продаж');
    expect(container.textContent).not.toContain('Показаны первые');
  });

  // `Р-27` (В-3): доска режется по `BOARD_CAP`, живые лиды идут первыми —
  // экран честно говорит, сколько скрыто, и где искать остальное.
  it('total > shown → подпись «Показаны первые N из M» с подсказкой про карточку организации', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    getFunnelBoard.mockResolvedValue({ stages: [], columns: [], shown: 500, total: 640 });

    const { container } = await renderServerComponent(ManagerFunnelPage());

    expect(container.textContent).toContain('Показаны первые 500 из 640.');
    expect(container.textContent).toContain('Живые лиды идут первыми и не теряются');
    expect(container.textContent).toContain('вкладка «Лиды»');
  });
});
