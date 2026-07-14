// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { studentFindMany } = vi.hoisted(() => ({ studentFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { student: { findMany: studentFindMany } }
}));

const { loadManagerOrderDetail } = vi.hoisted(() => ({ loadManagerOrderDetail: vi.fn() }));
vi.mock('@/lib/services/manager/orderDetail', () => ({ loadManagerOrderDetail }));

const { getDealActivity } = vi.hoisted(() => ({ getDealActivity: vi.fn() }));
vi.mock('@/lib/services/manager/dealActivity', () => ({ getDealActivity }));

const { listDirections } = vi.hoisted(() => ({ listDirections: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ listDirections }));

const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
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
    )
}));

import ManagerOrderDetailPage from '@/app/manager/orders/[id]/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

const BASE_DATA = {
  order: {
    id: 'order-1',
    organizationId: 'org-1',
    orderNumber: '2024-001',
    title: 'Обучение по ОТ',
    executionStatus: 'in_progress',
    documents: [],
    payments: [],
    commentsCountByMe: 0
  },
  auditEntries: [],
  comments: [],
  documentRows: [],
  items: []
};

describe('ManagerOrderDetailPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    studentFindMany.mockReset();
    loadManagerOrderDetail.mockReset();
    getDealActivity.mockReset();
    listDirections.mockReset();
    getValuesForEntity.mockReset();
    isFeatureEnabled.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when loadManagerOrderDetail returns null', async () => {
    requireManager.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        ManagerOrderDetailPage({ params: Promise.resolve({ id: 'missing' }) })
      )
    ).rejects.toThrow('NOT_FOUND');

    expect(listDirections).not.toHaveBeenCalled();
    expect(getDealActivity).not.toHaveBeenCalled();
  });

  it('renders the order detail view with a /manager/orders back link, using org-scoped students when organizationId is present', async () => {
    requireManager.mockResolvedValue(SESSION);
    loadManagerOrderDetail.mockResolvedValue(BASE_DATA);
    listDirections.mockResolvedValue({ ok: true, directions: [{ id: 'd1', name: 'Направление' }] });
    studentFindMany.mockResolvedValue([{ id: 's1', name: 'Студент', email: 's@x.com' }]);
    getValuesForEntity.mockResolvedValue({
      ok: true,
      fields: [{ definition: { id: 'f1', key: 'k1', label: 'Поле', fieldType: 'text', options: null, required: false, sortOrder: 0 }, value: 'v' }]
    });
    getDealActivity.mockResolvedValue({
      ok: true,
      items: [{ kind: 'event', id: 'e1', at: new Date('2026-01-01T00:00:00Z'), label: 'Смена статуса заказа' }]
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
    expect(studentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } })
    );
    expect(getValuesForEntity).toHaveBeenCalledWith(
      expect.objectContaining({ student: expect.anything() }),
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
      order: { ...BASE_DATA.order, organizationId: null }
    });
    listDirections.mockResolvedValue({ ok: false, error: 'forbidden' });
    studentFindMany.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: false, error: 'not_found' });
    getDealActivity.mockResolvedValue({ ok: false, error: 'not_found' });
    isFeatureEnabled.mockReturnValue(false);

    const { container } = await renderServerComponent(
      ManagerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) })
    );

    expect(studentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: undefined } })
    );
    expect(container.textContent).toContain('[]falsefalse');
  });
});
