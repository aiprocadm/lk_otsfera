// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerDocumentsPage from '@/app/manager/documents/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDocuments, listManagerOrderLessDocuments } = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listManagerOrderLessDocuments: vi.fn(),
}));
vi.mock('@/lib/services/manager/documents', () => ({
  listDocuments,
  listManagerOrderLessDocuments,
}));

const { listManagerCounterparties } = vi.hoisted(() => ({ listManagerCounterparties: vi.fn() }));
vi.mock('@/lib/services/manager/counterparties', () => ({ listManagerCounterparties }));

// `У-169`: список сотрудников — клиентская обёртка с массовой выгрузкой в 1С
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

vi.mock('@/components/manager/manager-order-less-upload-form', () => ({
  ManagerOrderLessUploadForm: (props: { organizations: unknown[]; partners: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'upload-form' },
      JSON.stringify(props.organizations),
      JSON.stringify(props.partners)
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};

describe('ManagerDocumentsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listDocuments.mockReset();
    listManagerOrderLessDocuments.mockReset();
    listManagerCounterparties.mockReset();
  });

  describe('orders tab (default)', () => {
    it('lists order documents with filters and shows the "next" link preserving filters when nextCursor is present', async () => {
      requireManager.mockResolvedValue(SESSION);
      listDocuments.mockResolvedValue({
        rows: [
          {
            id: 'd1',
            name: 'Договор.pdf',
            type: 'contract',
            direction: 'incoming',
            signedAt: null,
            createdAt: new Date('2024-01-01'),
            size: 100,
            orderId: 'o1',
            order: { orderNumber: '2024-001', title: 'Заказ 1' },
          },
        ],
        nextCursor: 'cur-2',
      });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({
          searchParams: Promise.resolve({ search: 'дог', type: 'contract', orderId: 'o1' }),
        })
      );

      expect(listDocuments).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          session: SESSION,
          search: 'дог',
          type: 'contract',
          orderId: 'o1',
          cursor: undefined,
        })
      );
      expect(container.textContent).toContain('Документы');
      expect(container.textContent).toContain('Договор.pdf');
      const link = Array.from(container.querySelectorAll('a')).find((a) =>
        a.textContent?.includes('Дальше')
      );
      expect(link).toBeDefined();
      expect(link?.getAttribute('href')).toContain('cursor=cur-2');
      expect(link?.getAttribute('href')).toContain('search=');
      expect(link?.getAttribute('href')).toContain('type=contract');
      expect(link?.getAttribute('href')).toContain('orderId=o1');
    });

    it('falls back orderId/orderTitle to null and type to undefined when absent, no "next" link when nextCursor is null', async () => {
      requireManager.mockResolvedValue(SESSION);
      listDocuments.mockResolvedValue({
        rows: [
          {
            id: 'd2',
            name: 'Прочее.pdf',
            type: 'other',
            direction: 'outgoing',
            signedAt: new Date('2024-02-01'),
            createdAt: new Date('2024-02-01'),
            size: null,
            orderId: null,
            order: null,
          },
        ],
        nextCursor: null,
      });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({ searchParams: Promise.resolve({}) })
      );

      expect(listDocuments).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ search: undefined, type: undefined, orderId: undefined })
      );
      expect(container.querySelector('a[href^="/manager/documents?cursor"]')).toBeNull();
    });

    it('does not render the hidden orderId input when sp.orderId is absent', async () => {
      requireManager.mockResolvedValue(SESSION);
      listDocuments.mockResolvedValue({ rows: [], nextCursor: null });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({ searchParams: Promise.resolve({}) })
      );

      expect(container.querySelector('input[name="orderId"]')).toBeNull();
    });

    it('renders the hidden orderId input when sp.orderId is present', async () => {
      requireManager.mockResolvedValue(SESSION);
      listDocuments.mockResolvedValue({ rows: [], nextCursor: null });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({ searchParams: Promise.resolve({ orderId: 'o9' }) })
      );

      expect(container.querySelector('input[name="orderId"][value="o9"]')).not.toBeNull();
    });

    it('builds the "general" tab chip href with filters preserved via ordersTabHref for the "orders" chip', async () => {
      requireManager.mockResolvedValue(SESSION);
      listDocuments.mockResolvedValue({ rows: [], nextCursor: null });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({ searchParams: Promise.resolve({ search: 'x' }) })
      );

      const ordersChip = Array.from(container.querySelectorAll('a')).find((a) =>
        a.textContent?.includes('По заказам')
      );
      expect(ordersChip?.getAttribute('href')).toBe('/manager/documents?search=x');
    });
  });

  describe('general tab (?tab=general)', () => {
    it('lists order-less documents and renders the upload form with counterparties', async () => {
      requireManager.mockResolvedValue(SESSION);
      listManagerOrderLessDocuments.mockResolvedValue({
        rows: [
          {
            id: 'd3',
            name: 'Общий.pdf',
            type: 'report',
            direction: 'incoming',
            signedAt: null,
            createdAt: new Date('2024-03-01'),
            size: 200,
          },
        ],
      });
      listManagerCounterparties.mockResolvedValue({
        organizations: [{ id: 'org1', name: 'Org' }],
        partners: [{ id: 'p1', name: 'Partner' }],
      });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({ searchParams: Promise.resolve({ tab: 'general' }) })
      );

      expect(listManagerOrderLessDocuments).toHaveBeenCalledWith({}, SESSION, {
        oneCPushStatus: undefined,
      });
      // Третий аргумент — охват (`У-110`). У рядового менеджера его нет:
      // он видит своих контрагентов, а не всех контрагентов компании.
      expect(listManagerCounterparties).toHaveBeenCalledWith({}, SESSION, undefined);
      expect(listDocuments).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Общие документы');
      expect(container.textContent).toContain('Org');
      expect(container.textContent).toContain('Partner');
      // `У-169`: фильтр «Выгрузка в 1С» и на общих документах, с сохранением вкладки.
      expect(container.querySelector('select[name="oneCPushStatus"]')).not.toBeNull();
      expect(container.querySelector('input[name="tab"][value="general"]')).not.toBeNull();
      expect(
        container.querySelector('[data-testid="documents-list"]')?.getAttribute('data-reset-href')
      ).toBe('');
    });

    it('У-169: активный фильтр уходит в сервис, а обёртка получает адрес сброса', async () => {
      requireManager.mockResolvedValue(SESSION);
      listManagerOrderLessDocuments.mockResolvedValue({ rows: [] });
      listManagerCounterparties.mockResolvedValue({ organizations: [], partners: [] });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({
          searchParams: Promise.resolve({ tab: 'general', oneCPushStatus: 'failed' }),
        })
      );

      expect(listManagerOrderLessDocuments).toHaveBeenCalledWith({}, SESSION, {
        oneCPushStatus: 'failed',
      });
      expect(
        container.querySelector('[data-testid="documents-list"]')?.getAttribute('data-reset-href')
      ).toBe('/manager/documents?tab=general');
    });
  });

  describe('У-169: фильтр «Выгрузка в 1С» на вкладке «По заказам»', () => {
    it('уходит в сервис разобранным, живёт в ссылке «Дальше» и не попадает в адрес сброса', async () => {
      requireManager.mockResolvedValue(SESSION);
      listDocuments.mockResolvedValue({ rows: [], nextCursor: 'cur-2' });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({
          searchParams: Promise.resolve({ type: 'invoice', oneCPushStatus: 'failed' }),
        })
      );

      expect(listDocuments).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ type: 'invoice', oneCPushStatus: 'failed' })
      );
      const select = container.querySelector('select[name="oneCPushStatus"]');
      expect(select).not.toBeNull();
      expect(select?.textContent).toContain('Выгрузка в 1С: все');
      expect(select?.textContent).toContain('Ошибка выгрузки');

      const next = Array.from(container.querySelectorAll('a')).find((a) =>
        a.textContent?.includes('Дальше')
      );
      expect(next?.getAttribute('href')).toContain('oneCPushStatus=failed');
      expect(next?.getAttribute('href')).toContain('type=invoice');

      expect(
        container.querySelector('[data-testid="documents-list"]')?.getAttribute('data-reset-href')
      ).toBe('/manager/documents?type=invoice');
    });

    it('чужое слово в адресе — «без фильтра»: в сервис уходит undefined, сброса нет', async () => {
      requireManager.mockResolvedValue(SESSION);
      listDocuments.mockResolvedValue({ rows: [], nextCursor: null });

      const { container } = await renderServerComponent(
        ManagerDocumentsPage({ searchParams: Promise.resolve({ oneCPushStatus: 'nope' }) })
      );

      expect(listDocuments).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ oneCPushStatus: undefined })
      );
      expect(
        container.querySelector('[data-testid="documents-list"]')?.getAttribute('data-reset-href')
      ).toBe('');
    });
  });
});
