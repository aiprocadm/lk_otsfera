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

const { loadManagerOrderDetail, listOrderStudentOptions } = vi.hoisted(() => ({
  loadManagerOrderDetail: vi.fn(),
  listOrderStudentOptions: vi.fn(),
}));
vi.mock('@/lib/services/manager/orderDetail', () => ({
  loadManagerOrderDetail,
  listOrderStudentOptions,
}));

const { getDealActivity } = vi.hoisted(() => ({ getDealActivity: vi.fn() }));
vi.mock('@/lib/services/manager/dealActivity', () => ({ getDealActivity }));

const { listDirections } = vi.hoisted(() => ({ listDirections: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ listDirections }));

const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

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
      String(props.telephonyEnabled)
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
    listCompanyManagers.mockReset();
    listCompanyManagers.mockResolvedValue([]);
    nav.notFound.mockClear();
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
});
