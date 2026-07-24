// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

const { viewedDocumentIds } = vi.hoisted(() => ({ viewedDocumentIds: vi.fn(async () => new Set<string>()) }));
vi.mock('@/lib/services/documents/viewMarks', () => ({ viewedDocumentIds }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listPartnerDocuments } = vi.hoisted(() => ({ listPartnerDocuments: vi.fn() }));
vi.mock('@/lib/services/partner/documentsList', () => ({ listPartnerDocuments }));

// DocumentsSearch ('use client') calls useRouter()/useSearchParams() -- stub next/navigation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

import PartnerDocumentsPage from '@/app/partner/documents/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

describe('PartnerDocumentsPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    listPartnerDocuments.mockReset();
  });

  it('defaults to the "orders" tab, DEFAULT_TAKE/skip 0, and undefined type filter for unrecognized values', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listPartnerDocuments.mockResolvedValue({ rows: [], total: 0, countsByType: {} });

    const { container } = await renderServerComponent(
      PartnerDocumentsPage({ searchParams: Promise.resolve({ type: 'bogus' }) })
    );

    expect(listPartnerDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        partnerId: 'p1',
        scopeOrgIds: ['org-1'],
        type: undefined,
        orderLess: false,
        take: 50,
        skip: 0
      })
    );
    expect(container.textContent).toContain('Документы');
    // grandTotal 0 -> TypeFilter renders null
    expect(container.querySelector('nav.flex.flex-wrap')).toBeNull();
  });

  it('этап 3 (ФТ-6.6): «новый» у непросмотренных документов партнёра', async () => {
    requirePartner.mockResolvedValue(SESSION);
    const doc = (id: string, name: string) => ({
      id,
      name,
      type: 'act',
      direction: 'outgoing' as const,
      signedAt: null,
      createdAt: new Date('2026-07-01'),
      size: 100,
      orderId: null,
      orderNumber: null,
      orderTitle: null
    });
    listPartnerDocuments.mockResolvedValue({
      rows: [doc('dA', 'Свежий.pdf'), doc('dB', 'Скачанный.pdf')],
      total: 2,
      countsByType: { act: 2 }
    });
    viewedDocumentIds.mockResolvedValueOnce(new Set(['dB']));

    const { container } = await renderServerComponent(
      PartnerDocumentsPage({ searchParams: Promise.resolve({}) })
    );

    expect(viewedDocumentIds).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      documentIds: ['dA', 'dB']
    });
    const items = Array.from(container.querySelectorAll('li'));
    expect(items.find((li) => li.textContent?.includes('Свежий.pdf'))?.textContent).toContain('новый');
    expect(items.find((li) => li.textContent?.includes('Скачанный.pdf'))?.textContent).not.toContain('новый');
  });

  it('switches to the "general" tab, clamps take to MAX_TAKE, no org scope when assignedOrgIds empty, and shows the search-query hint', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, assignedOrgIds: [] });
    listPartnerDocuments.mockResolvedValue({
      rows: [],
      total: 3,
      // `invoice: undefined` exercises the `n ?? 0` fallback in the grandTotal
      // reduce; countsByType is a Partial<Record<...>> so a present key can
      // still be undefined.
      countsByType: { contract: 2, invoice: undefined }
    });

    const { container } = await renderServerComponent(
      PartnerDocumentsPage({
        searchParams: Promise.resolve({ tab: 'general', take: '5000', skip: '20', search: 'дог' })
      })
    );

    expect(listPartnerDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scopeOrgIds: undefined,
        orderLess: true,
        take: 200,
        skip: 20,
        search: 'дог'
      })
    );
    expect(container.textContent).toContain('по запросу «дог»');
    expect(container.textContent).toContain('Договоры');
    // 'invoice' has an undefined count -- filtered out of `present`, exercising
    // the `n ?? 0` fallback in the grandTotal reduce without being chip-rendered.
    expect(container.textContent).not.toContain('Счета');
    // TypeFilter renders when grandTotal > 0
    expect(container.querySelector('nav.flex.flex-wrap')).not.toBeNull();
  });

  it('parses a valid type filter and falls back to skip:0/take default on non-numeric values', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listPartnerDocuments.mockResolvedValue({ rows: [], total: 1, countsByType: { act: 1 } });

    await renderServerComponent(
      PartnerDocumentsPage({
        searchParams: Promise.resolve({ type: 'act', take: 'nope', skip: 'nope' })
      })
    );

    expect(listPartnerDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'act', take: 50, skip: 0 })
    );
  });
});
