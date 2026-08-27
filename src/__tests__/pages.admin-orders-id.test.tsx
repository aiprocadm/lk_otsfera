// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminOrderDetailPage from '@/app/admin/orders/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

// Запросы уехали в сервисы (аудит A1): карточка заказа — в admin/orders,
// список кандидатов-менеджеров — в admin/users. Форма запросов пиннится в
// services.admin.orders.test.ts и services.admin.users.test.ts.
const { getOrderForAdmin, listManagerCandidates } = vi.hoisted(() => ({
  getOrderForAdmin: vi.fn(),
  listManagerCandidates: vi.fn(),
}));
vi.mock('@/lib/services/admin/orders', () => ({ getOrderForAdmin }));
vi.mock('@/lib/services/admin/users', () => ({ listManagerCandidates }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));

const { loadOrderDeal } = vi.hoisted(() => ({ loadOrderDeal: vi.fn() }));
vi.mock('@/lib/services/manager/orderDetail', () => ({ loadOrderDeal }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

// Этап 5 (`У-139`): блок «Состав и стоимость» — тот же, что в кабинетах
// менеджера и руководителя (правило зеркала).
const { getOrderLinesPanel } = vi.hoisted(() => ({ getOrderLinesPanel: vi.fn() }));
vi.mock('@/lib/services/orders/linesPanel', () => ({ getOrderLinesPanel }));
vi.mock('@/components/orders/order-lines-section', () => ({
  OrderLinesSection: (props: { orderId: string; canEdit: boolean; catalog: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'order-lines' },
      `${props.orderId}:${String(props.canEdit)}:${props.catalog.length}`
    ),
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/admin/assign-order-manager-form', () => ({
  AssignOrderManagerForm: (props: {
    orderId: string;
    currentManagerId: unknown;
    candidates: unknown[];
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'assign-manager-form' },
      props.orderId,
      String(props.currentManagerId),
      JSON.stringify(props.candidates)
    ),
}));

vi.mock('@/components/orders/order-stage-stepper', () => ({
  OrderStageStepper: (props: { stage: unknown; labels: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'stage-stepper' },
      String(props.stage),
      JSON.stringify(props.labels)
    ),
}));

vi.mock('@/components/orders/order-custom-fields', () => ({
  OrderCustomFields: (props: { fields: unknown[]; orderId: string; editable: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'order-custom-fields' },
      JSON.stringify(props.fields),
      props.orderId,
      String(props.editable)
    ),
}));

const SESSION = { sub: 'admin1', role: 'admin' as const };

const BASE_ORDER = {
  id: 'order-1',
  orderNumber: '2024-001',
  title: 'Заказ на обучение',
  organization: { id: 'org-1', name: 'Org' },
  partner: { name: 'Partner' },
  manager: null,
  managerId: null,
  totalAmount: 1000,
  paidAmount: 0,
  executionStatus: 'in_progress',
  financialStatus: 'unpaid',
  contractSignedAt: null,
  completedAt: null,
  closedAt: null,
};

describe('AdminOrderDetailPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getOrderForAdmin.mockReset();
    listManagerCandidates.mockReset();
    getValuesForEntity.mockReset();
    loadOrderDeal.mockReset();
    loadOrderDeal.mockResolvedValue(null);
    isFeatureEnabled.mockReset();
    getOrderLinesPanel.mockReset();
    getOrderLinesPanel.mockResolvedValue(null);
    nav.notFound.mockClear();
  });

  it('монтирует блок «Состав и стоимость», когда сервис отдал строки', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrderForAdmin.mockResolvedValue({ ...BASE_ORDER });
    listManagerCandidates.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    getOrderLinesPanel.mockResolvedValue({
      view: {
        lines: [],
        totals: { net: '0.00', vat: '0.00', gross: '0.00' },
        readOnly: false,
        totalAmount: '0.00',
        totalAmountIsManual: false,
      },
      catalog: [{ id: 'ci-1' }, { id: 'ci-2' }],
    });

    const { container } = await renderServerComponent(
      AdminOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(getOrderLinesPanel).toHaveBeenCalledWith(expect.anything(), SESSION, 'order-1');
    expect(container.querySelector('[data-testid="order-lines"]')?.textContent).toBe(
      'order-1:true:2'
    );
  });

  it('без доступа к строкам блок не монтируется', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrderForAdmin.mockResolvedValue({ ...BASE_ORDER });
    listManagerCandidates.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });

    const { container } = await renderServerComponent(
      AdminOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(container.querySelector('[data-testid="order-lines"]')).toBeNull();
  });

  it('calls notFound() when the order is missing', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrderForAdmin.mockResolvedValue(null);
    listManagerCandidates.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });

    await expect(
      renderServerComponent(AdminOrderDetailPage({ params: Promise.resolve({ id: 'missing' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('renders order details with an organization link, partner name, custom fields, and candidates (Decimal-like totalAmount via toNumber())', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrderForAdmin.mockResolvedValue({ ...BASE_ORDER, totalAmount: { toNumber: () => 1000 } });
    listManagerCandidates.mockResolvedValue([{ id: 'm1', name: 'Менеджер', email: 'm@x.com' }]);
    getValuesForEntity.mockResolvedValue({
      ok: true,
      fields: [
        {
          definition: {
            id: 'f1',
            key: 'k1',
            label: 'Поле',
            fieldType: 'text',
            options: null,
            required: false,
            sortOrder: 0,
          },
          value: 'v',
        },
      ],
    });

    const { container } = await renderServerComponent(
      AdminOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(listManagerCandidates).toHaveBeenCalledWith(expect.anything());
    expect(getValuesForEntity).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(), // сессия: этап 1 ТЗ v0.5 фильтрует поля по ролям на сервере
      'order',
      'order-1'
    );
    expect(container.textContent).toContain('2024-001');
    expect(container.textContent).toContain('Заказ на обучение');
    const orgLink = container.querySelector('a[href="/admin/organizations/org-1"]');
    expect(orgLink).not.toBeNull();
    expect(container.textContent).toContain('Partner');
    expect(container.querySelector('[data-testid="assign-manager-form"]')).not.toBeNull();
  });

  it('falls back to "—" for missing organization/partner and [] custom fields when ok:false', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrderForAdmin.mockResolvedValue({
      ...BASE_ORDER,
      organization: null,
      partner: null,
      totalAmount: null,
    });
    listManagerCandidates.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: false, error: 'not_found' });

    const { container } = await renderServerComponent(
      AdminOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(container.querySelector('a[href^="/admin/organizations/"]')).toBeNull();
    expect(container.textContent).toContain('—');
    const customFields = container.querySelector('[data-testid="order-custom-fields"]');
    expect(customFields?.textContent).toContain('[]');
  });

  it('formats a plain-number totalAmount via fmtMoney (typeof === "number" branch)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrderForAdmin.mockResolvedValue({ ...BASE_ORDER, totalAmount: 1000 });
    listManagerCandidates.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });

    const { container } = await renderServerComponent(
      AdminOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(container.textContent).toContain('1 000');
  });

  describe('панель «Сделка» (19.08.2026)', () => {
    const DEAL = {
      id: 'd1',
      title: 'Сделка с Ромашкой',
      amount: '120000.00',
      status: 'won' as const,
      wonAt: new Date('2026-08-01T10:00:00Z'),
      stageName: 'Выиграна',
      managerName: 'Иванова А.',
      lead: {
        id: 'l1',
        clientCompanyName: 'ООО «Ромашка»',
        sourceRequest: { id: 'r1', subject: 'Нужно обучение' },
      },
    };

    async function render() {
      requireAdmin.mockResolvedValue(SESSION);
      getOrderForAdmin.mockResolvedValue(BASE_ORDER);
      listManagerCandidates.mockResolvedValue([]);
      getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
      return renderServerComponent(
        AdminOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
      );
    }

    it('админ видит сделку без границы компании (Model A), но без ссылок наружу', async () => {
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'deals_pipeline');
      loadOrderDeal.mockResolvedValue(DEAL);

      const { container } = await render();

      expect(loadOrderDeal).toHaveBeenCalledWith({}, 'order-1', { allCompanies: true });
      expect(container.textContent).toContain('Переговоры, из которых вырос этот заказ');
      expect(container.textContent).toContain('Иванова А.');
      // Зеркал сделок и лидов в /admin/* нет — мёртвых дверей не рисуем.
      expect(container.textContent).not.toContain('Все сделки');
      expect(container.innerHTML).not.toContain('/admin/deals');
      expect(container.innerHTML).not.toContain('/admin/leads');
    });

    it('флаг выключен → сделка не читается и панели нет', async () => {
      isFeatureEnabled.mockReturnValue(false);

      const { container } = await render();

      expect(loadOrderDeal).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('Переговоры, из которых вырос этот заказ');
    });
  });
});
