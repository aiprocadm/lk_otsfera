// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderFunnelPage from '@/app/leader/funnel/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

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

vi.mock('@/components/funnel/stage-config', () => ({
  StageConfig: (props: { stages: unknown[]; isDefault: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'stage-config' },
      String(props.isDefault),
      JSON.stringify(props.stages)
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'leader' as const,
  companyId: 'c1',
};

describe('LeaderFunnelPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    isFeatureEnabled.mockReset();
    getFunnelBoard.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when the sales_funnel flag is disabled (before auth check)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(LeaderFunnelPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('sales_funnel');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('renders with default stages (isDefault: true when the first stage id starts with "default:")', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    getFunnelBoard.mockResolvedValue({
      stages: [{ id: 'default:new', name: 'Новый' }],
      columns: [],
      shown: 0,
      total: 0,
    });

    const { container } = await renderServerComponent(LeaderFunnelPage());

    expect(getFunnelBoard).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Воронка продаж');
    expect(container.textContent).toContain('true');
  });

  it('renders with custom stages (isDefault: false) and with an empty stages array', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    getFunnelBoard.mockResolvedValue({
      stages: [{ id: 'custom-1', name: 'Своя стадия' }],
      columns: [],
      shown: 0,
      total: 0,
    });

    const { container } = await renderServerComponent(LeaderFunnelPage());

    expect(container.textContent).toContain('false');
  });

  it('renders with an empty stages array (isDefault stays false, no crash on stages[0])', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    getFunnelBoard.mockResolvedValue({ stages: [], columns: [], shown: 0, total: 0 });

    const { container } = await renderServerComponent(LeaderFunnelPage());

    expect(container.textContent).toContain('false');
    expect(container.textContent).not.toContain('Показаны первые');
  });

  // `Р-27` (В-3): доска режется по `BOARD_CAP`, живые лиды идут первыми —
  // экран честно говорит, сколько скрыто, и где искать остальное.
  it('total > shown → подпись «Показаны первые N из M» с подсказкой про карточку организации', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    getFunnelBoard.mockResolvedValue({ stages: [], columns: [], shown: 500, total: 1200 });

    const { container } = await renderServerComponent(LeaderFunnelPage());

    expect(container.textContent).toContain('Показаны первые 500 из 1200.');
    expect(container.textContent).toContain('Живые лиды идут первыми и не теряются');
    expect(container.textContent).toContain('вкладка «Лиды»');
  });
});
