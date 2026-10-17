// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ManagerFunnelPage from '@/app/manager/funnel/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Старый адрес «Воронки продаж» менеджера (этап 6 ТЗ 13.10.2026, `У-312`):
 * воронка — вид внутри «Лидов», здесь — «раздел переехал» со ссылкой на новое
 * место. Гарды прежние: флаг `sales_funnel` до авторизации и менеджерский контур.
 */
const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => nav);

describe('ManagerFunnelPage — раздел переехал', () => {
  beforeEach(() => {
    requireManager.mockReset();
    isFeatureEnabled.mockReset();
    nav.notFound.mockClear();
  });

  it('флаг выключен — 404 до проверки входа, как раньше', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(ManagerFunnelPage())).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('sales_funnel');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('флаг включён — «раздел переехал» и ссылка на воронку в «Лидах»', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue({ sub: 'u1', role: 'manager' });
    const { container } = await renderServerComponent(ManagerFunnelPage());
    expect(requireManager).toHaveBeenCalled();
    expect(container.querySelector('h1')?.textContent).toBe('Воронка продаж');
    expect(container.textContent).toContain('Раздел переехал в «Лиды».');
    const link = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Открыть воронку в «Лидах»'
    );
    expect(link?.getAttribute('href')).toBe('/manager/leads?view=funnel');
  });
});
