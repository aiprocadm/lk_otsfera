// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LeaderFunnelPage from '@/app/leader/funnel/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Старый адрес «Воронки продаж» руководителя (этап 4 ТЗ 28.10.2026, `У-349`):
 * воронка — вид внутри «Лидов», страница говорит «раздел переехал» (зеркало
 * `/manager/funnel`, `У-312`). Доска и настройка стадий — на `/leader/leads`
 * (их проверяет `pages.leader-leads.test.tsx`).
 */

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => nav);

describe('LeaderFunnelPage — раздел переехал', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    isFeatureEnabled.mockReset();
    nav.notFound.mockClear();
  });

  it('без флага sales_funnel — 404, как и раньше, до проверки роли', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(LeaderFunnelPage())).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('sales_funnel');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('с флагом — гард руководителя и ссылка на воронку внутри «Лидов» руководителя', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue({ sub: 'u1', role: 'leader', companyId: 'c1' });

    const { container } = await renderServerComponent(LeaderFunnelPage());

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(container.textContent).toContain('Раздел переехал в «Лиды».');
    expect(container.textContent).toContain('Настройка стадий воронки — там же, под доской.');
    const link = container.querySelector('a[href="/leader/leads?view=funnel"]');
    expect(link?.textContent).toBe('Открыть воронку в «Лидах»');
    // Не в кабинет менеджера: руководитель остаётся в своём.
    expect(container.querySelector('a[href^="/manager/"]')).toBeNull();
  });
});
