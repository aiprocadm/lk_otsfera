// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrdersForAdmin, listCompanyOptions } = vi.hoisted(() => ({
  listOrdersForAdmin: vi.fn(),
  listCompanyOptions: vi.fn(),
}));
vi.mock('@/lib/services/admin/orders', () => ({ listOrdersForAdmin, listCompanyOptions }));

const { getOrderedStatuses } = vi.hoisted(() => ({ getOrderedStatuses: vi.fn() }));
vi.mock('@/lib/services/orderStatuses', () => ({ getOrderedStatuses }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import AdminOrdersPage from '@/app/admin/orders/page';

const ROW = {
  id: 'o1',
  orderNumber: '2024-001',
  title: 'Обучение по электробезопасности',
  totalAmount: { toString: () => '100000' },
  paidAmount: { toString: () => '40000' },
  financialStatus: 'partially_paid',
  executionStatus: 'in_progress',
  organization: { id: 'org1', name: 'ООО Ромашка' },
  company: { id: 'c1', name: 'Промтехносфера' },
  manager: { id: 'm1', name: 'Иванов', email: 'i@b.c' },
  statusDefinition: { id: 's1', label: 'В работе', isTerminal: false },
};

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ sub: 'a1', role: 'admin' });
  listOrdersForAdmin.mockReset().mockResolvedValue({ rows: [ROW], nextCursor: null });
  listCompanyOptions.mockReset().mockResolvedValue([
    { id: 'c1', name: 'Промтехносфера' },
    { id: 'c2', name: 'Вторая' },
  ]);
  getOrderedStatuses.mockReset().mockResolvedValue([
    { id: 's1', label: 'В работе', isActive: true },
    { id: 's2', label: 'Архивный', isActive: false },
  ]);
});

/**
 * `У-112`: раздела «Заказы» у администратора не было — адрес молча уводил на
 * дашборд. Пункт меню при этом существовал: человек нажимал «Заказы» и попадал
 * не туда, куда просил.
 */
describe('AdminOrdersPage (У-112)', () => {
  const render = (sp: Record<string, string> = {}) =>
    renderServerComponent(AdminOrdersPage({ searchParams: Promise.resolve(sp) }));

  it('показывает список, а не уводит на дашборд', async () => {
    const { container } = await render();
    expect(requireAdmin).toHaveBeenCalled();
    expect(container.querySelector('h1')?.textContent).toBe('Заказы');
    expect(container.textContent).toContain('Обучение по электробезопасности');
  });

  it('в строке видно компанию — админ смотрит на все компании сразу', async () => {
    const { container } = await render();
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toContain('Компания');
    expect(headers).toContain('Долг');
    expect(container.textContent).toContain('Промтехносфера');
  });

  it('долг считается как разность суммы и оплаты', async () => {
    const { container } = await render();
    // 100 000 − 40 000; неразрывный пробел между разрядами — как рисует Intl.
    expect(container.textContent?.replace(/ /g, ' ')).toContain('60 000 ₽');
  });

  it('фильтр по компании есть, а по организации — нет', async () => {
    // Организаций в системе тысячи: выпадающий список пришлось бы молча
    // обрезать. Админ фильтрует по компании и ищет по названию и номеру.
    const { container } = await render();
    expect(container.querySelector('select[name="companyId"]')).not.toBeNull();
    expect(container.querySelector('select[name="organizationId"]')).toBeNull();
  });

  it('фильтры из адреса доходят до сервиса, «без менеджера» — как флаг', async () => {
    await render({ search: 'дог', companyId: 'c1', unassigned: '1' });
    expect(listOrdersForAdmin).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ search: 'дог', companyId: 'c1', unassigned: true })
    );
  });

  it('в фильтр статусов попадают только действующие строки справочника', async () => {
    const { container } = await render();
    const options = [...container.querySelectorAll('select[name="statusId"] option')].map(
      (o) => o.textContent
    );
    expect(options).toContain('В работе');
    expect(options).not.toContain('Архивный');
  });

  it('пустой список объясняет себя, а не молчит (§15)', async () => {
    listOrdersForAdmin.mockResolvedValue({ rows: [], nextCursor: null });
    const { container } = await render();
    expect(container.textContent).toContain('заказов нет');
  });

  it('ссылки строки ведут в кабинет админа, а не в чужой', async () => {
    const { container } = await render();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin/orders/o1');
    expect(hrefs.filter((h) => h?.startsWith('/manager/'))).toEqual([]);
  });
});
