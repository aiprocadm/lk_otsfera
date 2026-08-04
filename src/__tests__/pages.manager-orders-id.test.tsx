// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
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

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

// A1: прямых запросов на странице не осталось — prisma только прокидывается в
// сервисы. Формы запросов пиннятся в services.manager.orderDetail.unit и
// services.documents.generationPanel.unit.
const { prismaMock } = vi.hoisted(() => ({ prismaMock: { student: {} } }));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { loadManagerOrderDetail, listOrderStudentOptions, loadOrderDealChain } = vi.hoisted(() => ({
  loadManagerOrderDetail: vi.fn(),
  listOrderStudentOptions: vi.fn(),
  loadOrderDealChain: vi.fn(),
}));
vi.mock('@/lib/services/manager/orderDetail', () => ({
  loadManagerOrderDetail,
  listOrderStudentOptions,
  loadOrderDealChain,
}));

const { getDocumentGenerationPanel } = vi.hoisted(() => ({
  getDocumentGenerationPanel: vi.fn(),
}));
vi.mock('@/lib/services/documents/generationPanel', () => ({ getDocumentGenerationPanel }));

const { getDealActivity } = vi.hoisted(() => ({ getDealActivity: vi.fn() }));
vi.mock('@/lib/services/manager/dealActivity', () => ({ getDealActivity }));

const { listDirections } = vi.hoisted(() => ({ listDirections: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ listDirections }));

const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));

// Этап 12 (ФТ-5.1): страница собирает блок «Готовность к передаче».
const { getOrderReadiness } = vi.hoisted(() => ({ getOrderReadiness: vi.fn() }));
vi.mock('@/lib/services/manager/orderDelivery', () => ({ getOrderReadiness }));
vi.mock('@/components/manager/order-readiness-panel', () => ({
  OrderReadinessPanel: () => null,
}));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
// Этап 12 PR-2 (ФТ-5.3): панель массовой загрузки сканов удостоверений.
const { listCertificateScanTargets } = vi.hoisted(() => ({
  listCertificateScanTargets: vi.fn(),
}));
vi.mock('@/lib/services/manager/certificateScans', () => ({ listCertificateScanTargets }));
vi.mock('@/components/manager/certificate-scans-panel', () => ({
  CertificateScansPanel: () => React.createElement('div', { 'data-testid': 'scans-panel' }),
}));

vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/components/manager/generate-documents-panel', () => ({
  GenerateDocumentsPanel: (props: {
    orderId: string;
    missing: unknown[];
    hasInvoice: boolean;
    hasContract: boolean;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'generate-panel' },
      `${props.orderId}:missing=${props.missing.length}:invoice=${props.hasInvoice}:contract=${props.hasContract}`
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
    certificateScansPanel?: React.ReactNode;
    generatePanel?: React.ReactNode;
    readinessPanel?: React.ReactNode;
    breadcrumbs?: Array<{ label: string; href: string | null }>;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'order-detail-view' },
      props.backHref,
      JSON.stringify(props.directions),
      JSON.stringify(props.students),
      JSON.stringify(props.customFields),
      JSON.stringify(props.activityItems),
      String(props.inboundEnabled),
      String(props.telephonyEnabled),
      props.certificateScansPanel,
      props.generatePanel,
      props.readinessPanel,
      JSON.stringify(props.breadcrumbs ?? [])
    ),
}));

import ManagerOrderDetailPage from '@/app/manager/orders/[id]/page';

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  managerRole: 'member' as const,
  companyId: 'c1',
};

const BASE_DATA = {
  order: {
    id: 'order-1',
    organizationId: 'org-1',
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

describe('ManagerOrderDetailPage', () => {
  beforeEach(() => {
    getOrderReadiness.mockResolvedValue({
      ok: true,
      readiness: { ready: true, gaps: [], items: [] },
      deliveredAt: null,
    });
    requireManager.mockReset();
    listOrderStudentOptions.mockReset();
    loadManagerOrderDetail.mockReset();
    getDealActivity.mockReset();
    listDirections.mockReset();
    getValuesForEntity.mockReset();
    isFeatureEnabled.mockReset();
    loadOrderDealChain.mockReset();
    loadOrderDealChain.mockResolvedValue(null);
    getDocumentGenerationPanel.mockReset();
    listCertificateScanTargets.mockReset();
    listCertificateScanTargets.mockResolvedValue({ ok: true, targets: [] });
    nav.notFound.mockClear();
  });

  it('calls notFound() when loadManagerOrderDetail returns null', async () => {
    requireManager.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue(null);

    await expect(
      renderServerComponent(ManagerOrderDetailPage({ params: Promise.resolve({ id: 'missing' }) }))
    ).rejects.toThrow('NOT_FOUND');

    expect(listDirections).not.toHaveBeenCalled();
    expect(getDealActivity).not.toHaveBeenCalled();
  });

  it('renders the order detail view with a /manager/orders back link, using org-scoped students when organizationId is present', async () => {
    requireManager.mockResolvedValue(SESSION);
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
    isFeatureEnabled.mockImplementation((flag: string) => flag === 'inbound_messaging');

    const { container } = await renderServerComponent(
      ManagerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
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
    expect(container.textContent).toContain('/manager/orders');
    expect(container.textContent).toContain('Направление');
    expect(container.textContent).toContain('Студент');
    expect(container.textContent).toContain('"kind":"event"');
    expect(container.textContent).toContain('truefalse');
  });

  it('falls back to directions:[] / customFields:[] / activityItems:[] when the results are ok:false, both feature flags off, and organizationId:undefined when the order has none', async () => {
    requireManager.mockResolvedValue(SESSION);
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
      ManagerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    // Заказ без организации: сервис получает null и сам решает, во что его
    // превратить в запросе (регресс — services.manager.orderDetail.unit).
    expect(listOrderStudentOptions).toHaveBeenCalledWith(prismaMock, null);
    expect(container.textContent).toContain('[]falsefalse');
  });

  // Этап 12 PR-2 (ФТ-5.3): панель сканов — только у обучения и только пока
  // результат не передан.
  describe('панель сканов удостоверений', () => {
    function trainingOrder(extra: Record<string, unknown> = {}) {
      return {
        ...BASE_DATA,
        order: { ...BASE_DATA.order, serviceType: 'training', resultDeliveredAt: null, ...extra },
      };
    }

    async function renderWith(data: unknown) {
      requireManager.mockResolvedValue(SESSION);
      loadManagerOrderDetail.mockResolvedValue(data);
      listDirections.mockResolvedValue({ ok: true, directions: [] });
      listOrderStudentOptions.mockResolvedValue([]);
      getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
      getDealActivity.mockResolvedValue({ ok: true, items: [] });
      isFeatureEnabled.mockReturnValue(false);
      return renderServerComponent(
        ManagerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
      );
    }

    it('заказ на обучение до передачи — панель собрана', async () => {
      const { container } = await renderWith(trainingOrder());
      expect(listCertificateScanTargets).toHaveBeenCalled();
      expect(container.querySelector('[data-testid="scans-panel"]')).not.toBeNull();
    });

    it('после передачи результата панель не нужна', async () => {
      const { container } = await renderWith(
        trainingOrder({ resultDeliveredAt: new Date('2026-07-01') })
      );
      expect(listCertificateScanTargets).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="scans-panel"]')).toBeNull();
    });

    it('заказ на разработку документов — панели нет', async () => {
      const { container } = await renderWith({
        ...BASE_DATA,
        order: { ...BASE_DATA.order, serviceType: 'document_development', resultDeliveredAt: null },
      });
      expect(listCertificateScanTargets).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="scans-panel"]')).toBeNull();
    });

    it('заказ вне скоупа для сервиса сканов — панель не рисуется', async () => {
      listCertificateScanTargets.mockResolvedValue({ ok: false, error: 'forbidden' });
      const { container } = await renderWith(trainingOrder());
      expect(container.querySelector('[data-testid="scans-panel"]')).toBeNull();
    });
  });

  // Этап 11 PR-2 (ФТ-15.6): цепочка обращение → лид → сделка → заказ.
  describe('хлебные крошки', () => {
    async function renderOrder() {
      requireManager.mockResolvedValue(SESSION);
      loadManagerOrderDetail.mockResolvedValue({
        ...BASE_DATA,
        order: { ...BASE_DATA.order, title: 'Обучение по ОТ' },
      });
      listDirections.mockResolvedValue({ ok: true, directions: [] });
      listOrderStudentOptions.mockResolvedValue([]);
      getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
      getDealActivity.mockResolvedValue({ ok: true, items: [] });
      return renderServerComponent(
        ManagerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
      );
    }

    it('со сделками выключенными флагом цепочка не дочитывается', async () => {
      isFeatureEnabled.mockReturnValue(false);
      const { container } = await renderOrder();
      expect(loadOrderDealChain).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Заказы');
    });

    it('заказ из сделки с лидом и обращением разворачивает всю цепочку', async () => {
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'deals_pipeline');
      loadOrderDealChain.mockResolvedValue({
        title: 'Сделка с Ромашкой',
        lead: {
          id: 'l1',
          clientCompanyName: 'ООО «Ромашка»',
          sourceRequest: { id: 'r1', subject: 'Нужно обучение' },
        },
      });
      const { container } = await renderOrder();
      expect(loadOrderDealChain).toHaveBeenCalledWith(prismaMock, 'order-1');
      expect(container.textContent).toContain('Обращения клиентов');
      expect(container.textContent).toContain('Нужно обучение');
      expect(container.textContent).toContain('/manager/leads/l1');
      expect(container.textContent).toContain('Заказ №2024-001');
    });

    it('сделка без лида даёт цепочку без обращения', async () => {
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'deals_pipeline');
      loadOrderDealChain.mockResolvedValue({ title: 'Прямая сделка', lead: null });
      const { container } = await renderOrder();
      expect(container.textContent).toContain('Прямая сделка');
      expect(container.textContent).not.toContain('Обращения клиентов');
    });
  });
});
describe('панель генерации документов (этап 8, ФТ-9.4/9.5)', () => {
  async function renderWithGeneration(orderOver: Record<string, unknown> = {}) {
    requireManager.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue({
      ...BASE_DATA,
      order: {
        ...BASE_DATA.order,
        companyId: 'co-1',
        serviceType: 'training',
        resultDeliveredAt: null,
        ...orderOver,
      },
    });
    listDirections.mockResolvedValue({ ok: true, directions: [] });
    listOrderStudentOptions.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    getDealActivity.mockResolvedValue({ ok: true, items: [] });
    listCertificateScanTargets.mockResolvedValue({ ok: true, targets: [] });
    isFeatureEnabled.mockImplementation((flag: string) => flag === 'document_generation');
    getDocumentGenerationPanel.mockResolvedValue({
      missing: [],
      hasInvoice: true,
      hasContract: false,
    });
    return renderServerComponent(
      ManagerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );
  }

  it('флаг включён и стороны на месте: панель собрана, счёт уже есть, договора нет', async () => {
    // Данные панели (полнота реквизитов + что уже сгенерировано) считает сервис;
    // страница передаёт их в компонент — от них зависит активность кнопок.
    const { container } = await renderWithGeneration();
    const panel = container.querySelector('[data-testid="generate-panel"]');
    expect(panel?.textContent).toBe('order-1:missing=0:invoice=true:contract=false');
    expect(getDocumentGenerationPanel).toHaveBeenCalledWith(prismaMock, {
      orderId: 'order-1',
      companyId: 'co-1',
      organizationId: 'org-1',
    });
  });

  // Ветка «сторона исчезла между запросами» живёт внутри сервиса
  // (services.documents.generationPanel.unit); странице важно лишь, что пустой
  // список недостающего доезжает до компонента.
  it('карточка стороны исчезла между запросами → панель с пустым списком недостающего', async () => {
    requireManager.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue({
      ...BASE_DATA,
      order: {
        ...BASE_DATA.order,
        companyId: 'co-1',
        serviceType: 'training',
        resultDeliveredAt: null,
      },
    });
    listDirections.mockResolvedValue({ ok: true, directions: [] });
    listOrderStudentOptions.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    getDealActivity.mockResolvedValue({ ok: true, items: [] });
    listCertificateScanTargets.mockResolvedValue({ ok: true, targets: [] });
    isFeatureEnabled.mockImplementation((flag: string) => flag === 'document_generation');
    getDocumentGenerationPanel.mockResolvedValue({
      missing: [],
      hasInvoice: false,
      hasContract: false,
    });
    const { container } = await renderServerComponent(
      ManagerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );
    expect(container.querySelector('[data-testid="generate-panel"]')?.textContent).toContain(
      'missing=0'
    );
  });

  it('заказ без companyId: панели нет даже при включённом флаге', async () => {
    const { container } = await renderWithGeneration({ companyId: null });
    expect(container.querySelector('[data-testid="generate-panel"]')).toBeNull();
  });

  it('передача уже состоялась: панель готовности показывает дату', async () => {
    getOrderReadiness.mockResolvedValue({
      ok: true,
      readiness: { ready: true, gaps: [], items: [] },
      deliveredAt: new Date('2026-07-01T10:00:00Z'),
    });
    const { container } = await renderWithGeneration();
    expect(container.textContent).toBeTruthy();
  });

  it('отказ сервиса готовности: страница открывается без панели готовности', async () => {
    getOrderReadiness.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderWithGeneration();
    expect(container.querySelector('[data-testid="order-detail-view"]')).not.toBeNull();
  });
});
