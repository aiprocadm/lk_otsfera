// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { kpis, attention, recentEvents } = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn(),
}));
vi.mock('@/lib/services/admin/dashboard', () => ({ kpis, attention, recentEvents }));

// `У-246` (этап 7): кросс-компанийный свод под флагом этапа.
const { getCrossCompanyMonth, isFeatureEnabled } = vi.hoisted(() => ({
  getCrossCompanyMonth: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));
vi.mock('@/lib/services/admin/crossCompany', () => ({ getCrossCompanyMonth }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

import AdminDashboardPage from '@/app/admin/dashboard/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    kpis.mockReset();
    attention.mockReset();
    recentEvents.mockReset();
    getCrossCompanyMonth.mockReset();
    getCrossCompanyMonth.mockResolvedValue({
      year: 2026,
      month: 9,
      rows: [
        {
          companyId: 'c1',
          companyName: 'Первая',
          orders: 4,
          paid: '750.00',
          leads: 3,
          requests: 1,
        },
      ],
      docsNotPushed: 0,
      lastMigration: null,
    });
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(false);
  });

  it('fetches kpis/attention/events in parallel and renders them', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    kpis.mockResolvedValue([{ label: 'Заказы', value: 5, href: '/admin/orders' }]);
    attention.mockResolvedValue([
      { id: 'a1', title: 'Просрочен', href: '/admin/orders/1', severity: 'urgent' },
      { id: 'a2', title: 'Скоро', href: '/admin/orders/2', severity: 'normal' },
    ]);
    recentEvents.mockResolvedValue([
      {
        id: 'e1',
        actor: 'Иванов',
        verb: 'order_created',
        entity: 'order',
        timestamp: new Date('2024-01-01'),
      },
    ]);

    const { container } = await renderServerComponent(AdminDashboardPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(kpis).toHaveBeenCalledWith({});
    expect(attention).toHaveBeenCalledWith({});
    expect(recentEvents).toHaveBeenCalledWith({}, 20);
    expect(container.textContent).toContain('Главная');
    expect(container.textContent).toContain('Заказы');
    expect(container.textContent).toContain('Просрочен');
    expect(container.textContent).toContain('Скоро');
    expect(container.textContent).toContain('Иванов');
  });

  it('флаг выключен — свода по компаниям нет и считать его не начинают', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    kpis.mockResolvedValue([]);
    attention.mockResolvedValue([]);
    recentEvents.mockResolvedValue([]);

    const { queryByTestId } = await renderServerComponent(AdminDashboardPage());

    expect(queryByTestId('admin-cross-company')).toBeNull();
    expect(getCrossCompanyMonth).not.toHaveBeenCalled();
  });

  it('флаг включён — свод считается за текущий месяц и виден', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireAdmin.mockResolvedValue(SESSION);
    kpis.mockResolvedValue([]);
    attention.mockResolvedValue([]);
    recentEvents.mockResolvedValue([]);

    const { getByTestId } = await renderServerComponent(AdminDashboardPage());

    expect(isFeatureEnabled).toHaveBeenCalledWith('leader_analytics');
    const args = getCrossCompanyMonth.mock.calls[0] as unknown as [
      unknown,
      { year: number; month: number },
    ];
    expect(typeof args[1].year).toBe('number');
    expect(typeof args[1].month).toBe('number');
    expect(getByTestId('admin-cross-company').textContent).toContain('Первая');
  });

  it('renders empty states for attention and events', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    kpis.mockResolvedValue([]);
    attention.mockResolvedValue([]);
    recentEvents.mockResolvedValue([]);

    const { container } = await renderServerComponent(AdminDashboardPage());

    expect(container.textContent).toContain('Всё под контролем');
    expect(container.textContent).toContain('Пока тут пусто');
  });
});
