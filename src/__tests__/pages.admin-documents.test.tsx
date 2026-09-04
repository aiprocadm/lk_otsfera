// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

// Запросы уехали в сервис (аудит A1): страница мокает сервис, а проверка
// формы самого запроса живёт в services.documents.generalList.test.ts.
const { listGeneralDocuments } = vi.hoisted(() => ({ listGeneralDocuments: vi.fn() }));
vi.mock('@/lib/services/documents/generalList', () => ({ listGeneralDocuments }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// `У-169`: общие документы — клиентская обёртка с массовой выгрузкой в 1С
// (ей нужен app-router); страница проверяется по тому, что она ей передаёт.
vi.mock('@/components/documents/staff-documents-push-list', () => ({
  StaffDocumentsPushList: (props: {
    rows: unknown[];
    downloadEndpointBase?: string;
    resetHref?: string;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'documents-list', 'data-reset-href': props.resetHref ?? '' },
      props.downloadEndpointBase,
      JSON.stringify(props.rows)
    ),
}));

vi.mock('@/components/documents/documents-panel', () => ({
  DocumentsPanel: () => React.createElement('div', { 'data-testid': 'documents-panel' }),
}));

import AdminDocumentsPage from '@/app/admin/documents/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminDocumentsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listGeneralDocuments.mockReset();
  });

  it('renders the orders tab (default) with DocumentsPanel and the "orders" chip active', async () => {
    requireAdmin.mockResolvedValue(SESSION);

    const { container } = await renderServerComponent(
      AdminDocumentsPage({ searchParams: Promise.resolve({}) })
    );

    expect(requireAdmin).toHaveBeenCalled();
    expect(listGeneralDocuments).not.toHaveBeenCalled();
    // `У-73`: обе вкладки отвечают на «где я» и «что здесь делают» по-русски.
    expect(container.querySelector('h1')?.textContent).toBe('Документы');
    expect(container.textContent).toContain('привязанные к заказам клиентов');
    expect(container.querySelector('[data-testid="documents-panel"]')).not.toBeNull();
    const ordersChip = Array.from(container.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('По заказам')
    );
    expect(ordersChip?.className).toContain('bg-[#F97316]');
  });

  it('renders the general tab (?tab=general) with order-less documents mapped to OrgDocumentRow', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listGeneralDocuments.mockResolvedValue([
      {
        id: 'd1',
        name: 'Общий.pdf',
        type: 'report',
        direction: 'incoming',
        signedAt: null,
        createdAt: new Date('2024-01-01'),
        size: 100,
        orderId: null,
        orderNumber: null,
        orderTitle: null,
      },
    ]);

    const { container } = await renderServerComponent(
      AdminDocumentsPage({ searchParams: Promise.resolve({ tab: 'general' }) })
    );

    expect(listGeneralDocuments).toHaveBeenCalledWith(expect.anything(), {
      oneCPushStatus: undefined,
    });
    expect(container.textContent).toContain('Документы');
    expect(container.textContent).toContain('Общий.pdf');
    expect(container.textContent).toContain('/api/documents');
    // Без фильтра кнопки «Сбросить фильтр» быть не должно.
    expect(
      container.querySelector('[data-testid="documents-list"]')?.getAttribute('data-reset-href')
    ).toBe('');
  });

  it('У-169: фильтр «Выгрузка в 1С» на вкладке общих документов — select, сервис и сброс', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listGeneralDocuments.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminDocumentsPage({ searchParams: Promise.resolve({ tab: 'general', oneCPushStatus: 'failed' }) })
    );

    expect(listGeneralDocuments).toHaveBeenCalledWith(expect.anything(), {
      oneCPushStatus: 'failed',
    });
    const select = container.querySelector('select[name="oneCPushStatus"]');
    expect(select).not.toBeNull();
    expect(container.querySelector('input[name="tab"][value="general"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="documents-list"]')?.getAttribute('data-reset-href')
    ).toBe('/admin/documents?tab=general');
  });

  it('У-169: чужое слово в адресе — «без фильтра», а не ошибка', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listGeneralDocuments.mockResolvedValue([]);

    await renderServerComponent(
      AdminDocumentsPage({ searchParams: Promise.resolve({ tab: 'general', oneCPushStatus: 'nope' }) })
    );

    expect(listGeneralDocuments).toHaveBeenCalledWith(expect.anything(), {
      oneCPushStatus: undefined,
    });
  });
});
