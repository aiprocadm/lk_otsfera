// @vitest-environment jsdom
/**
 * §11 ТЗ v0.5 (этап 1 PR-4) — страницы карточки документа в четырёх кабинетах.
 *
 * Руководителю отдельной страницы нет намеренно: у него роль `manager`,
 * префикс `/manager` ему открыт (§4 CLAUDE.md), список документов живёт там же.
 *
 * Проверяем три вещи: сработал гард своего кабинета, отказ сервиса даёт 404
 * (а не пустую страницу), ссылки ведут в СВОЙ кабинет, а не в чужой.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

const { requireAdmin, requireManager, requirePartner } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManager: vi.fn(),
  requirePartner: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin, requireManager, requirePartner }));

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getDocumentDetail } = vi.hoisted(() => ({ getDocumentDetail: vi.fn() }));
vi.mock('@/lib/services/documents/detail', () => ({ getDocumentDetail }));

vi.mock('@/lib/services/customFields', () => ({
  getFieldsForEntity: async () => [],
}));

vi.mock('@/components/documents/document-detail-view', () => ({
  DocumentDetailView: (props: {
    backHref: string;
    orderHrefBase?: string;
    document: { name: string };
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'doc-card' },
      JSON.stringify({
        name: props.document.name,
        backHref: props.backHref,
        orderHrefBase: props.orderHrefBase,
      })
    ),
}));

vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: () => React.createElement('div', { 'data-testid': 'fields' }),
}));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-shell' }, children),
}));

import AdminDocumentPage from '@/app/admin/documents/[id]/page';
import ManagerDocumentPage from '@/app/manager/documents/[id]/page';
import PartnerDocumentPage from '@/app/partner/documents/[id]/page';
import OrganizationDocumentPage from '@/app/organization/documents/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const DOC = { ok: true, document: { name: 'Счёт №5' } };

const ORG_CTX = {
  session: { sub: 'org1', role: 'organization', email: 'o@t.local' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin',
};

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ sub: 'a1', role: 'admin' });
  requireManager.mockReset().mockResolvedValue({ sub: 'm1', role: 'manager' });
  requirePartner.mockReset().mockResolvedValue({ sub: 'p1', role: 'partner', partnerId: 'pp1' });
  getOrgPageContext.mockReset().mockResolvedValue(ORG_CTX);
  getDocumentDetail.mockReset().mockResolvedValue(DOC);
  notFound.mockClear();
});

describe('Карточка документа — кабинет администратора', () => {
  it('гард админа, ссылки в свой кабинет', async () => {
    const { container } = await renderServerComponent(
      AdminDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(requireAdmin).toHaveBeenCalled();
    expect(container.textContent).toContain('"backHref":"/admin/documents"');
    expect(container.textContent).toContain('"orderHrefBase":"/admin/orders"');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(AdminDocumentPage({ params: Promise.resolve({ id: 'nope' }) }))
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});

describe('Карточка документа — кабинет менеджера', () => {
  it('гард менеджера, ссылки в свой кабинет', async () => {
    const { container } = await renderServerComponent(
      ManagerDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(requireManager).toHaveBeenCalled();
    expect(container.textContent).toContain('"backHref":"/manager/documents"');
    expect(container.textContent).toContain('"orderHrefBase":"/manager/orders"');
    expect(container.textContent).not.toContain('/admin/');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(ManagerDocumentPage({ params: Promise.resolve({ id: 'x' }) }))
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Карточка документа — кабинет партнёра', () => {
  it('гард партнёра, заказы ведут в «Сделки» его кабинета', async () => {
    const { container } = await renderServerComponent(
      PartnerDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(requirePartner).toHaveBeenCalled();
    expect(container.textContent).toContain('"backHref":"/partner/documents"');
    expect(container.textContent).toContain('"orderHrefBase":"/partner/deals"');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(PartnerDocumentPage({ params: Promise.resolve({ id: 'x' }) }))
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Карточка документа — кабинет организации', () => {
  it('рендерится внутри оболочки организации, сессия берётся из контекста', async () => {
    const { container } = await renderServerComponent(
      OrganizationDocumentPage({
        params: Promise.resolve({ id: 'd1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(getOrgPageContext).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="org-shell"]')).toBeTruthy();
    expect(getDocumentDetail).toHaveBeenCalledWith({}, ORG_CTX.session, 'd1');
    expect(container.textContent).toContain('"backHref":"/organization/documents"');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(
        OrganizationDocumentPage({
          params: Promise.resolve({ id: 'x' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
