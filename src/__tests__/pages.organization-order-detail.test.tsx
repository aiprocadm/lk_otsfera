// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationOrderDetailPage from '@/app/organization/orders/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { canSeeOrder } = vi.hoisted(() => ({ canSeeOrder: vi.fn() }));
vi.mock('@/lib/auth/organizationPolicy', () => ({ canSeeOrder }));

const { getOrgOrder } = vi.hoisted(() => ({ getOrgOrder: vi.fn() }));
vi.mock('@/lib/services/organization/orders', () => ({ getOrgOrder }));

const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));

const { commentFindMany } = vi.hoisted(() => ({ commentFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { comment: { findMany: commentFindMany } },
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

// order-items-section and order-custom-fields are 'use client' components that
// call useRouter() -- stub next/navigation above covers that (no router methods
// are invoked during initial render, only on user interaction).

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

const BASE_ORDER = {
  id: 'order-1',
  organizationId: 'org-1',
  orderNumber: '2024-001',
  title: 'Обучение по ОТ',
  stage: 'in_progress' as const,
  executionStatus: 'in_progress' as const,
  financialStatus: 'not_billed' as const,
  totalAmount: '1000.00',
  paidAmount: '0.00',
  debt: '1000.00',
  vatIncluded: false,
  vatRate: null,
  productMix: [],
  createdAt: new Date('2024-01-01'),
  deadline: null,
  contractSignedAt: null,
  completedAt: null,
  closedAt: null,
  paidAt: null,
  lastSyncedAt: null,
  managerName: 'Менеджер М.',
  documents: [],
  payments: [],
  commentsCount: 0,
  items: [],
};

describe('OrganizationOrderDetailPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    canSeeOrder.mockReset();
    getOrgOrder.mockReset();
    getValuesForEntity.mockReset();
    commentFindMany.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when getOrgOrder returns null', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        OrganizationOrderDetailPage({
          params: Promise.resolve({ id: 'missing' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NOT_FOUND');

    expect(canSeeOrder).not.toHaveBeenCalled();
  });

  it('calls notFound() when canSeeOrder denies access (defense-in-depth re-check)', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue(BASE_ORDER);
    canSeeOrder.mockReturnValue(false);

    await expect(
      renderServerComponent(
        OrganizationOrderDetailPage({
          params: Promise.resolve({ id: 'order-1' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NOT_FOUND');

    expect(canSeeOrder).toHaveBeenCalledWith(CTX.session, { organizationId: 'org-1' });
  });

  it('renders the full order detail with comments, custom fields, an org-scoped back link, and a document count badge', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue({
      ...BASE_ORDER,
      documents: [
        {
          id: 'd1',
          name: 'Договор.pdf',
          type: 'contract' as const,
          direction: 'incoming' as const,
          signedAt: null,
          createdAt: new Date('2024-01-02'),
          size: 1024,
        },
      ],
    });
    canSeeOrder.mockReturnValue(true);
    commentFindMany.mockResolvedValue([
      {
        id: 'c1',
        body: 'Комментарий',
        createdAt: new Date('2024-01-01'),
        author: { name: 'Менеджер М.' },
      },
    ]);
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
          value: 'значение',
        },
      ],
    });

    const { container } = await renderServerComponent(
      OrganizationOrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
        searchParams: Promise.resolve({ org: 'org-1' }),
      })
    );

    expect(commentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'order-1' } })
    );
    expect(getValuesForEntity).toHaveBeenCalledWith(
      expect.objectContaining({ comment: expect.anything() }),
      expect.anything(), // сессия: этап 1 ТЗ v0.5 фильтрует поля по ролям на сервере
      'order',
      'order-1'
    );
    expect(container.textContent).toContain('Все заказы');
    expect(container.textContent).toContain('Комментарий');
    expect(container.textContent).toContain('Документы');
    expect(container.textContent).toContain('(1)');

    const backLink = container.querySelector('a[href*="/organization/orders"]');
    expect(backLink?.getAttribute('href')).toBe('/organization/orders?org=org-1');
  });

  it('falls back to an empty custom-fields list when getValuesForEntity returns ok:false, and uses the plain back link without an org param', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue(BASE_ORDER);
    canSeeOrder.mockReturnValue(true);
    commentFindMany.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: false, error: 'not_found' });

    const { container } = await renderServerComponent(
      OrganizationOrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    const backLink = container.querySelector('a[href*="/organization/orders"]');
    expect(backLink?.getAttribute('href')).toBe('/organization/orders');
  });
});
