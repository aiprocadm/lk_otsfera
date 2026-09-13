// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
// §10 ТЗ v0.5 (этап 2 PR-3): страница подтягивает панель рабочего статуса —
// мокаем сервис обычной функцией (в файле есть сброс моков).
vi.mock('@/lib/services/orderStatuses', () => ({
  getOrderStatusPanel: async () => ({
    current: null,
    forward: [],
    backward: [],
    terminal: null,
    history: [],
  }),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

// A1: список слушателей читает сервис карточки заказа (форма запроса —
// services.manager.orderDetail.unit); prisma страница только прокидывает.
const { prismaMock } = vi.hoisted(() => ({ prismaMock: { student: {} } }));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { loadManagerOrderDetail, listOrderStudentOptions, loadOrderDeal } = vi.hoisted(() => ({
  loadManagerOrderDetail: vi.fn(),
  listOrderStudentOptions: vi.fn(),
  loadOrderDeal: vi.fn(),
}));
vi.mock('@/lib/services/manager/orderDetail', () => ({
  loadManagerOrderDetail,
  listOrderStudentOptions,
  loadOrderDeal,
}));

const { getDealActivity } = vi.hoisted(() => ({ getDealActivity: vi.fn() }));
vi.mock('@/lib/services/manager/dealActivity', () => ({ getDealActivity }));

// Этап 5 (`У-139`): блок «Состав и стоимость» — тот же, что у менеджера.
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

// Этап 1 ТЗ 12.09.2026 (`У-180`): «Контакт заказа» — тот же блок, что у
// менеджера (правило зеркала §0.2). Сервис и режим команды стабятся, панель —
// заглушка, печатающая пропсы (кабинет обязан быть `leader`).
const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));
const { getOrderContactPanel } = vi.hoisted(() => ({ getOrderContactPanel: vi.fn() }));
vi.mock('@/lib/services/orders/primaryContact', () => ({ getOrderContactPanel }));
vi.mock('@/components/orders/order-contact-panel', () => ({
  OrderContactPanel: (props: {
    orderId: string;
    cabinet: string;
    organizationId: string | null;
    current: unknown;
    options: unknown[];
  }) => React.createElement('div', { 'data-testid': 'order-contact-panel' }, JSON.stringify(props)),
}));

const { listDirections } = vi.hoisted(() => ({ listDirections: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ listDirections }));

const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

// `У-144`: панель выпуска документов — тот же компонент, что у менеджера и
// админа; данные для неё собирает сервис, страница только монтирует.
const { getDocumentGenerationPanel } = vi.hoisted(() => ({
  getDocumentGenerationPanel: vi.fn(),
}));
vi.mock('@/lib/services/documents/generationPanel', () => ({ getDocumentGenerationPanel }));
vi.mock('@/components/manager/generate-documents-panel', () => ({
  GenerateDocumentsPanel: (props: {
    orderId: string;
    counterpartyName: string;
    orderLines: unknown[];
    missingByType: Record<string, unknown[]>;
    hasInvoice: boolean;
    hasContract: boolean;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'generate-panel' },
      `${props.orderId}:missing=${props.missingByType.invoice?.length ?? 0}` +
        `:invoice=${props.hasInvoice}:contract=${props.hasContract}` +
        `:party=${props.counterpartyName}:lines=${props.orderLines.length}`
    ),
}));

vi.mock('@/components/leader/leader-assign-order-manager-form', () => ({
  LeaderAssignOrderManagerForm: (props: {
    orderId: string;
    currentManagerId: string | null;
    candidates: unknown[];
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'leader-assign-form' },
      JSON.stringify({
        orderId: props.orderId,
        currentManagerId: props.currentManagerId,
        candidates: props.candidates,
      })
    ),
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/manager/manager-order-detail-view', () => ({
  ManagerOrderDetailView: (props: {
    data: unknown;
    backHref: string;
    directions: unknown[];
    students: unknown[];
    customFields?: unknown[];
    activityItems?: unknown[];
    inboundEnabled?: boolean;
    telephonyEnabled?: boolean;
    linesSection?: React.ReactNode;
    generatePanel?: React.ReactNode;
    dealPanel?: React.ReactNode;
    contactPanel?: React.ReactNode;
    breadcrumbs?: Array<{ label: string; href: string | null }>;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'order-detail-view' },
      props.linesSection,
      props.backHref,
      JSON.stringify(props.directions),
      JSON.stringify(props.students),
      JSON.stringify(props.customFields),
      JSON.stringify(props.activityItems),
      String(props.inboundEnabled),
      String(props.telephonyEnabled),
      props.generatePanel,
      props.dealPanel,
      props.contactPanel,
      JSON.stringify(props.breadcrumbs ?? [])
    ),
}));

import LeaderOrderDetailPage from '@/app/leader/orders/[id]/page';

const SESSION = {
  sub: 'u1',
  role: 'leader' as const,
  companyId: 'c1',
};

const BASE_DATA = {
  order: {
    id: 'order-1',
    organizationId: 'org-1',
    managerId: 'm-current',
    orderNumber: '2024-001',
    title: 'Обучение по ОТ',
    executionStatus: 'in_progress',
    documents: [],
    payments: [],
    commentsCountByMe: 0,
  },
  auditEntries: [],
  comments: [],
  documentRows: [],
  items: [],
};

describe('LeaderOrderDetailPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    listOrderStudentOptions.mockReset();
    loadManagerOrderDetail.mockReset();
    getDealActivity.mockReset();
    listDirections.mockReset();
    getValuesForEntity.mockReset();
    isFeatureEnabled.mockReset();
    loadOrderDeal.mockReset();
    loadOrderDeal.mockResolvedValue(null);
    listCompanyManagers.mockReset();
    listCompanyManagers.mockResolvedValue([]);
    getOrderLinesPanel.mockReset();
    getOrderLinesPanel.mockResolvedValue(null);
    getCompanyTeamVisibility.mockReset().mockResolvedValue(false);
    getOrderContactPanel.mockReset().mockResolvedValue(null);
    getDocumentGenerationPanel.mockReset();
    nav.notFound.mockClear();
  });

  it('монтирует блок «Состав и стоимость» — зеркало карточки менеджера', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue(BASE_DATA);
    listDirections.mockResolvedValue({ ok: true, directions: [] });
    listOrderStudentOptions.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    getDealActivity.mockResolvedValue({ ok: true, items: [] });
    isFeatureEnabled.mockReturnValue(false);
    getOrderLinesPanel.mockResolvedValue({
      view: {
        lines: [],
        totals: { net: '0.00', vat: '0.00', gross: '0.00' },
        readOnly: false,
        totalAmount: '0.00',
        totalAmountIsManual: false,
      },
      catalog: [],
    });

    const { container } = await renderServerComponent(
      LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(getOrderLinesPanel).toHaveBeenCalledWith(
      expect.objectContaining({ student: expect.anything() }),
      SESSION,
      'order-1'
    );
    expect(container.querySelector('[data-testid="order-lines"]')?.textContent).toBe(
      'order-1:true:0'
    );
  });

  it('без доступа к строкам блок не монтируется', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue(BASE_DATA);
    listDirections.mockResolvedValue({ ok: true, directions: [] });
    listOrderStudentOptions.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    getDealActivity.mockResolvedValue({ ok: true, items: [] });
    isFeatureEnabled.mockReturnValue(false);

    const { container } = await renderServerComponent(
      LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(container.querySelector('[data-testid="order-lines"]')).toBeNull();
  });

  it('calls notFound() when loadManagerOrderDetail returns null', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue(null);

    await expect(
      renderServerComponent(LeaderOrderDetailPage({ params: Promise.resolve({ id: 'missing' }) }))
    ).rejects.toThrow('NOT_FOUND');

    expect(listDirections).not.toHaveBeenCalled();
    expect(getDealActivity).not.toHaveBeenCalled();
  });

  it('renders the order detail view with a /leader/orders back link, using org-scoped students when organizationId is present, and wires the deal-activity feed with the leader session', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue(BASE_DATA);
    listDirections.mockResolvedValue({ ok: true, directions: [{ id: 'd1', name: 'Направление' }] });
    listOrderStudentOptions.mockResolvedValue([{ id: 's1', name: 'Студент', email: 's@x.com' }]);
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
    getDealActivity.mockResolvedValue({
      ok: true,
      items: [
        {
          kind: 'event',
          id: 'e1',
          at: new Date('2026-01-01T00:00:00Z'),
          label: 'Смена статуса заказа',
        },
      ],
    });
    isFeatureEnabled.mockImplementation((flag: string) => flag === 'telephony_mango');

    const { container } = await renderServerComponent(
      LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(loadManagerOrderDetail).toHaveBeenCalledWith(
      expect.objectContaining({ student: expect.anything() }),
      SESSION,
      'order-1'
    );
    expect(listOrderStudentOptions).toHaveBeenCalledWith(prismaMock, 'org-1');
    expect(getValuesForEntity).toHaveBeenCalledWith(
      expect.objectContaining({ student: expect.anything() }),
      expect.anything(), // сессия: этап 1 ТЗ v0.5 фильтрует поля по ролям на сервере
      'order',
      'order-1'
    );
    expect(getDealActivity).toHaveBeenCalledWith(
      expect.objectContaining({ student: expect.anything() }),
      SESSION,
      'order-1',
      { view: 'all' }
    );
    expect(isFeatureEnabled).toHaveBeenCalledWith('inbound_messaging');
    expect(isFeatureEnabled).toHaveBeenCalledWith('telephony_mango');
    expect(container.textContent).toContain('/leader/orders');
    expect(container.textContent).toContain('Направление');
    expect(container.textContent).toContain('Студент');
    expect(container.textContent).toContain('"kind":"event"');
    // inboundEnabled=false (only telephony_mango truthy), telephonyEnabled=true.
    expect(container.textContent).toContain('falsetrue');
  });

  it('falls back to directions:[] / customFields:[] / activityItems:[] when the results are ok:false, both feature flags off, and organizationId:undefined when the order has none', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue({
      ...BASE_DATA,
      order: { ...BASE_DATA.order, organizationId: null },
    });
    listDirections.mockResolvedValue({ ok: false, error: 'forbidden' });
    listOrderStudentOptions.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: false, error: 'not_found' });
    getDealActivity.mockResolvedValue({ ok: false, error: 'not_found' });
    isFeatureEnabled.mockReturnValue(false);

    const { container } = await renderServerComponent(
      LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    // Заказ без организации: сервис получает null (что он делает с ним в
    // запросе — регресс services.manager.orderDetail.unit).
    expect(listOrderStudentOptions).toHaveBeenCalledWith(prismaMock, null);
    expect(container.textContent).toContain('[]falsefalse');
  });

  it('монтирует форму назначения менеджера: кандидаты фильтруются по isActive, мапятся в {id,email,name}, currentManagerId — из data.order.managerId', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue(BASE_DATA);
    listDirections.mockResolvedValue({ ok: true, directions: [] });
    listOrderStudentOptions.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    getDealActivity.mockResolvedValue({ ok: true, items: [] });
    isFeatureEnabled.mockReturnValue(false);
    // Третья строка — сам руководитель (ТЗ 2026-08-17: isLeader выводится из
    // role='leader'). Он остаётся в кандидатах: фильтр только по isActive.
    listCompanyManagers.mockResolvedValue([
      {
        id: 'm1',
        name: 'Анна',
        email: 'anna@x.com',
        isActive: true,
        isLeader: false,
        assignments: [],
      },
      {
        id: 'm2',
        name: 'Борис',
        email: 'boris@x.com',
        isActive: false,
        isLeader: false,
        assignments: [],
      },
      {
        id: 'm-current',
        name: 'Вера',
        email: 'vera@x.com',
        isActive: true,
        isLeader: true,
        assignments: [],
      },
    ]);

    const { getByTestId } = await renderServerComponent(
      LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(listCompanyManagers).toHaveBeenCalledWith(
      expect.objectContaining({ student: expect.anything() }),
      'c1'
    );
    const formProps = JSON.parse(getByTestId('leader-assign-form').textContent ?? '{}');
    expect(formProps).toEqual({
      orderId: 'order-1',
      currentManagerId: 'm-current',
      candidates: [
        { id: 'm1', email: 'anna@x.com', name: 'Анна' },
        { id: 'm-current', email: 'vera@x.com', name: 'Вера' },
      ],
    });
    // Деталка рендерится рядом с формой, а не заменяется ею.
    expect(getByTestId('order-detail-view')).toBeTruthy();
  });

  it('companyId=null: listCompanyManagers не вызывается, кандидаты пустые; managerId=null прокидывается как currentManagerId', async () => {
    requireManagerLeader.mockResolvedValue({ ...SESSION, companyId: null });
    loadManagerOrderDetail.mockResolvedValue({
      ...BASE_DATA,
      order: { ...BASE_DATA.order, managerId: null },
    });
    listDirections.mockResolvedValue({ ok: true, directions: [] });
    listOrderStudentOptions.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    getDealActivity.mockResolvedValue({ ok: true, items: [] });
    isFeatureEnabled.mockReturnValue(false);

    const { getByTestId } = await renderServerComponent(
      LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(listCompanyManagers).not.toHaveBeenCalled();
    const formProps = JSON.parse(getByTestId('leader-assign-form').textContent ?? '{}');
    expect(formProps).toEqual({ orderId: 'order-1', currentManagerId: null, candidates: [] });
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
      requireManagerLeader.mockResolvedValue(SESSION);
      loadManagerOrderDetail.mockResolvedValue(BASE_DATA);
      listOrderStudentOptions.mockResolvedValue([]);
      listDirections.mockResolvedValue({ ok: true, directions: [] });
      getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
      getDealActivity.mockResolvedValue({ ok: true, items: [] });
      return renderServerComponent(
        LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
      );
    }

    it('со включённым флагом показывает сделку в границах своей компании', async () => {
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'deals_pipeline');
      loadOrderDeal.mockResolvedValue(DEAL);

      const { container } = await render();

      expect(loadOrderDeal).toHaveBeenCalledWith(prismaMock, 'order-1', { companyId: 'c1' });
      expect(container.textContent).toContain('Переговоры, из которых вырос этот заказ');
      expect(container.innerHTML).toContain('/leader/deals');
    });

    it('лидов в кабинете руководителя нет — имя лида остаётся текстом, без ссылки', async () => {
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'deals_pipeline');
      loadOrderDeal.mockResolvedValue(DEAL);

      const { container } = await render();

      expect(container.textContent).toContain('ООО «Ромашка»');
      expect(container.innerHTML).not.toContain('/leader/leads');
      expect(container.innerHTML).not.toContain('/manager/leads');
    });

    it('флаг выключен → сделка не читается и панели нет', async () => {
      isFeatureEnabled.mockReturnValue(false);

      const { container } = await render();

      expect(loadOrderDeal).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('Переговоры, из которых вырос этот заказ');
    });

    it('у заказа без номера крошка берёт его название', async () => {
      isFeatureEnabled.mockReturnValue(false);
      requireManagerLeader.mockResolvedValue(SESSION);
      loadManagerOrderDetail.mockResolvedValue({
        ...BASE_DATA,
        order: { ...BASE_DATA.order, orderNumber: null },
      });
      listOrderStudentOptions.mockResolvedValue([]);
      listDirections.mockResolvedValue({ ok: true, directions: [] });
      getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
      getDealActivity.mockResolvedValue({ ok: true, items: [] });

      const { container } = await renderServerComponent(
        LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
      );

      expect(container.textContent).toContain('Обучение по ОТ');
      expect(container.textContent).not.toContain('Заказ №');
      expect(container.textContent).toContain('Заказы');
    });

    it('заказ не из сделки → панели нет', async () => {
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'deals_pipeline');
      loadOrderDeal.mockResolvedValue(null);

      const { container } = await render();

      expect(container.textContent).not.toContain('Переговоры, из которых вырос этот заказ');
    });
  });

  // Этап 1 ТЗ 12.09.2026 (`У-180`): «Контакт заказа» у руководителя — зеркало
  // карточки менеджера: тот же сервис, тот же компонент, кабинет — свой.
  describe('панель «Контакт заказа» (`У-180`)', () => {
    const PANEL = {
      current: null,
      options: [{ id: 'ct-1', name: 'Пётр Петров', position: null, organizationId: 'org-1' }],
    };

    async function render() {
      requireManagerLeader.mockResolvedValue(SESSION);
      loadManagerOrderDetail.mockResolvedValue(BASE_DATA);
      listOrderStudentOptions.mockResolvedValue([]);
      listDirections.mockResolvedValue({ ok: true, directions: [] });
      getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
      getDealActivity.mockResolvedValue({ ok: true, items: [] });
      return renderServerComponent(
        LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
      );
    }

    it('флаг contacts выключен: ни сервис, ни режим команды не читаются, панели нет', async () => {
      isFeatureEnabled.mockReturnValue(false);

      const { container } = await render();

      expect(getOrderContactPanel).not.toHaveBeenCalled();
      expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="order-contact-panel"]')).toBeNull();
    });

    it('флаг включён, сервис отказал (null): панели нет, но teamMode прочитан свежим и передан', async () => {
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'contacts');
      getCompanyTeamVisibility.mockResolvedValue(true);
      getOrderContactPanel.mockResolvedValue(null);

      const { container } = await render();

      expect(getCompanyTeamVisibility).toHaveBeenCalledWith(prismaMock, 'c1');
      expect(getOrderContactPanel).toHaveBeenCalledWith(prismaMock, SESSION, true, BASE_DATA.order);
      expect(container.querySelector('[data-testid="order-contact-panel"]')).toBeNull();
    });

    it('флаг включён, сервис отдал данные: панель смонтирована для кабинета руководителя', async () => {
      // Контакт ещё не выбран (`current: null`), но список есть — панель нужна,
      // чтобы его выбрать; кабинет `leader` — ссылки уйдут в свой раздел.
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'contacts');
      getOrderContactPanel.mockResolvedValue(PANEL);

      const { container } = await render();

      expect(getOrderContactPanel).toHaveBeenCalledWith(
        prismaMock,
        SESSION,
        false,
        BASE_DATA.order
      );
      const panel = container.querySelector('[data-testid="order-contact-panel"]');
      expect(JSON.parse(panel?.textContent ?? '{}')).toEqual({
        orderId: 'order-1',
        cabinet: 'leader',
        organizationId: 'org-1',
        current: null,
        options: PANEL.options,
      });
    });
  });

  // `У-144` (дефект `Д-13`): руководитель выпускает документы из карточки —
  // тот же компонент и тот же сервис, что у менеджера. Панель есть только при
  // включённом флаге и при обеих сторонах сделки (организация и компания).
  describe('панель выпуска документов (`У-144`)', () => {
    async function render(orderOver: Record<string, unknown> = {}) {
      requireManagerLeader.mockResolvedValue(SESSION);
      loadManagerOrderDetail.mockResolvedValue({
        ...BASE_DATA,
        order: { ...BASE_DATA.order, companyId: 'co-1', ...orderOver },
      });
      listOrderStudentOptions.mockResolvedValue([]);
      listDirections.mockResolvedValue({ ok: true, directions: [] });
      getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
      getDealActivity.mockResolvedValue({ ok: true, items: [] });
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'document_generation');
      getDocumentGenerationPanel.mockResolvedValue({
        missingByType: { invoice: [{ code: 'inn' }], act: [], contract: [], extra_agreement: [] },
        hasInvoice: false,
        hasContract: true,
        baseDocuments: [],
        counterpartyName: 'ООО «Ромашка»',
        orderLines: [{ id: 'l1' }],
      });
      return renderServerComponent(
        LeaderOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
      );
    }

    it('флаг включён, стороны на месте: сервис собрал данные, панель смонтирована', async () => {
      const { container } = await render();

      expect(getDocumentGenerationPanel).toHaveBeenCalledWith(prismaMock, {
        orderId: 'order-1',
        companyId: 'co-1',
        organizationId: 'org-1',
      });
      expect(container.querySelector('[data-testid="generate-panel"]')?.textContent).toBe(
        'order-1:missing=1:invoice=false:contract=true:party=ООО «Ромашка»:lines=1'
      );
    });

    it('заказ без организации: панели нет, сервис не зовётся', async () => {
      // Без стороны-заказчика выпускать документ некому — панель не рисуем,
      // чтобы не вести в форму, которой сервер откажет.
      const { container } = await render({ organizationId: null });

      expect(getDocumentGenerationPanel).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="generate-panel"]')).toBeNull();
    });

    it('заказ без компании-продавца: панели нет, сервис не зовётся', async () => {
      const { container } = await render({ companyId: null });

      expect(getDocumentGenerationPanel).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="generate-panel"]')).toBeNull();
    });
  });
});
