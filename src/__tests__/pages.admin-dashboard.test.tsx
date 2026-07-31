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

import AdminDashboardPage from '@/app/admin/dashboard/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    kpis.mockReset();
    attention.mockReset();
    recentEvents.mockReset();
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
    expect(container.textContent).toContain('Кабинет администратора');
    expect(container.textContent).toContain('Заказы');
    expect(container.textContent).toContain('Просрочен');
    expect(container.textContent).toContain('Скоро');
    expect(container.textContent).toContain('Иванов');
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
