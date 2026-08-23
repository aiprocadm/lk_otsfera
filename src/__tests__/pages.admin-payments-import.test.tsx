// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminPaymentsImportPage from '@/app/admin/settings/integrations/1c/payments/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

const { companyFindMany } = vi.hoisted(() => ({
  companyFindMany: vi.fn().mockResolvedValue([{ id: 'co-1', name: 'Альфа' }]),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { company: { findMany: companyFindMany } } }));

// `У-90`: страница стала тонкой — разбор адреса и приведение строк живут в
// сервисе (форма запроса пиннится в import.card51.queue-view.test.ts).
const { loadQueuePage } = vi.hoisted(() => ({ loadQueuePage: vi.fn() }));
vi.mock('@/lib/services/import/oneCAccountCard/queue-view', () => ({ loadQueuePage }));

vi.mock('@/components/import/payment-import-form', () => ({
  PaymentImportForm: () => React.createElement('div', { 'data-testid': 'payment-import-form' }),
}));

vi.mock('@/components/import/payment-queue-table', () => ({
  PaymentQueueTable: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'payment-queue-table' }, JSON.stringify(props)),
}));

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminPaymentsImportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSettingsSection.mockResolvedValue(SESSION);
    companyFindMany.mockResolvedValue([{ id: 'co-1', name: 'Альфа' }]);
    loadQueuePage.mockResolvedValue({ rows: [], total: 0, take: 50, skip: 0 });
  });

  it('проверяет право на раздел и грузит страницу очереди по параметрам адреса', async () => {
    await renderServerComponent(
      AdminPaymentsImportPage({ searchParams: Promise.resolve({ inn: 'without', skip: '50' }) })
    );

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', 'admin');
    expect(loadQueuePage).toHaveBeenCalledWith(expect.anything(), SESSION, {
      inn: 'without',
      skip: '50',
    });
  });

  it('без параметров адреса открывает первую страницу очереди', async () => {
    await renderServerComponent(AdminPaymentsImportPage({}));
    expect(loadQueuePage).toHaveBeenCalledWith(expect.anything(), SESSION, {});
  });

  it('передаёт таблице счётчик, страницу и адрес для фильтров', async () => {
    loadQueuePage.mockResolvedValue({ rows: [{ id: 'q1' }], total: 250, take: 50, skip: 100 });

    const { container } = await renderServerComponent(
      AdminPaymentsImportPage({ searchParams: Promise.resolve({ sort: 'amount' }) })
    );

    const props = JSON.parse(
      container.querySelector('[data-testid="payment-queue-table"]')!.textContent!
    );
    expect(props).toMatchObject({
      total: 250,
      take: 50,
      skip: 100,
      basePath: '/admin/settings/integrations/1c/payments',
      searchParams: { sort: 'amount' },
      rows: [{ id: 'q1' }],
    });
    // Т-30/Т-41: админу нужен выбор компании для новой организации.
    expect(props.companies).toEqual([{ id: 'co-1', name: 'Альфа' }]);
  });

  it('название экрана и подзаголовок — единые (§15, У-76)', async () => {
    const { container } = await renderServerComponent(AdminPaymentsImportPage({}));
    expect(container.querySelector('h1')?.textContent).toBe('Импорт оплат');
    expect(container.textContent).toContain('Карточка счёта 51');
  });
});
