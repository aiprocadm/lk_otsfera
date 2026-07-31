// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationDocumentsPage from '@/app/organization/documents/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { viewedDocumentIds } = vi.hoisted(() => ({
  viewedDocumentIds: vi.fn(async () => new Set<string>()),
}));
vi.mock('@/lib/services/documents/viewMarks', () => ({ viewedDocumentIds }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrgDocuments } = vi.hoisted(() => ({ listOrgDocuments: vi.fn() }));
vi.mock('@/lib/services/organization/documents', () => ({ listOrgDocuments }));

// OrgDocumentsSearch ('use client') calls useRouter()/useSearchParams() which
// require a mounted Next app-router context that jsdom + @testing-library/react
// does not provide. Stub next/navigation for this page's client-side children.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

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

describe('OrganizationDocumentsPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    listOrgDocuments.mockReset();
  });

  it('renders the "orders" tab by default with type-filter chips when documents exist', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgDocuments.mockResolvedValue({
      rows: [],
      total: 2,
      countsByType: { contract: 1, act: 1 },
    });

    const { container } = await renderServerComponent(
      OrganizationDocumentsPage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );

    expect(listOrgDocuments).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        organizationId: 'org-1',
        orderLess: false,
        take: 50,
        skip: 0,
      })
    );
    expect(container.textContent).toContain('Документы');
    expect(container.textContent).toContain('По заказам');
    expect(container.textContent).toContain('Договоры');
    expect(container.textContent).toContain('Акты');
    expect(container.textContent).toContain('Все');
  });

  it('этап 3 (ФТ-6.6): «новый» у непросмотренных, просмотренные без бейджа; группировка по заказу на вкладке orders', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    const doc = (id: string, name: string) => ({
      id,
      name,
      type: 'contract',
      direction: 'outgoing' as const,
      signedAt: null,
      createdAt: new Date('2026-07-01'),
      size: 100,
      orderId: 'ord1',
      orderNumber: '42',
      orderTitle: 'Обучение',
    });
    listOrgDocuments.mockResolvedValue({
      rows: [doc('dA', 'Новый.pdf'), doc('dB', 'Старый.pdf')],
      total: 2,
      countsByType: { contract: 2 },
    });
    viewedDocumentIds.mockResolvedValue(new Set(['dB']));

    const { container } = await renderServerComponent(
      OrganizationDocumentsPage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );

    expect(viewedDocumentIds).toHaveBeenCalledWith({}, { userId: 'u1', documentIds: ['dA', 'dB'] });
    const items = Array.from(container.querySelectorAll('li'));
    const rowA = items.find((li) => li.textContent?.includes('Новый.pdf'));
    const rowB = items.find((li) => li.textContent?.includes('Старый.pdf'));
    expect(rowA?.textContent).toContain('новый');
    expect(rowB?.textContent).not.toContain('новый');
    // Вкладка orders → секция «Заказ № 42».
    expect(Array.from(container.querySelectorAll('h3')).map((h) => h.textContent)).toContain(
      'Заказ № 42'
    );
  });

  it('renders the "general" tab, applies a valid type filter, and shows the order-less upload form', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgDocuments.mockResolvedValue({
      rows: [],
      total: 1,
      countsByType: { invoice: 1 },
    });

    const { container } = await renderServerComponent(
      OrganizationDocumentsPage({
        searchParams: Promise.resolve({ tab: 'general', type: 'invoice', search: 'счёт' }),
      })
    );

    expect(listOrgDocuments).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: 'invoice',
        search: 'счёт',
        orderLess: true,
      })
    );
    expect(container.textContent).toContain('Общие документы');
    expect(container.textContent).toContain('по запросу «счёт»');
  });

  it('ignores an invalid type filter and clamps take to MAX_TAKE, hides TypeFilter when grandTotal is 0', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgDocuments.mockResolvedValue({ rows: [], total: 0, countsByType: {} });

    await renderServerComponent(
      OrganizationDocumentsPage({
        searchParams: Promise.resolve({ type: 'not-a-real-type', take: '99999', skip: 'abc' }),
      })
    );

    expect(listOrgDocuments).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: undefined,
        take: 200,
        skip: 0,
      })
    );
  });

  it('accepts a finite skip param, and renders the "Все" chip (no org/search/type/tab) when no filters are set', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    // countsByType has an explicit `undefined` entry for a present type — exercises
    // the `(n ?? 0)` fallback in the grandTotal reduce and in the per-chip count.
    listOrgDocuments.mockResolvedValue({
      rows: [],
      total: 3,
      countsByType: { contract: undefined, act: 3 },
    });

    const { container } = await renderServerComponent(
      OrganizationDocumentsPage({ searchParams: Promise.resolve({ skip: '10' }) })
    );

    expect(listOrgDocuments).toHaveBeenCalledWith({}, expect.objectContaining({ skip: 10 }));
    // "Все" chip's href() has no org/tab/search/type set -> the bare '/organization/documents' branch.
    const allChip = Array.from(container.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Все')
    );
    expect(allChip?.getAttribute('href')).toBe('/organization/documents');
  });
});
