// @vitest-environment jsdom
/**
 * Импорт из 1С в кабинете менеджера.
 *
 * **Решение заказчика 11.08.2026:** импорт доступен администратору,
 * руководителю И обычному менеджеру. Прежнее правило `Т-25` («обычного
 * менеджера отбивать в /forbidden») отменено — стражи переписаны под новое.
 *
 * Одна страница обслуживает две роли, и это главное, что здесь проверяется:
 * руководителя уводим в его хаб настроек, обычному менеджеру рисуем страницу
 * на месте (хаба у него нет).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { redirectToSettingsHub } = vi.hoisted(() => ({ redirectToSettingsHub: vi.fn() }));
vi.mock('@/lib/navigation/settingsRedirect', () => ({ redirectToSettingsHub }));

// Право подменяем, а `isManagerLeader` берём настоящий: разделение ролей на
// странице должно проверяться боевым предикатом.
const { mayImportOneC } = vi.hoisted(() => ({ mayImportOneC: vi.fn(() => true) }));
vi.mock('@/lib/auth/managerPolicy', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  mayImportOneC,
}));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));
vi.mock('next/navigation', () => ({ redirect }));

vi.mock('@/app/leader/settings/integrations/1c/excel/page', () => ({
  default: () => React.createElement('div', null, 'ЛИДЕРСКАЯ:excel'),
}));
vi.mock('@/app/leader/settings/integrations/1c/payments/page', () => ({
  default: () => React.createElement('div', null, 'ЛИДЕРСКАЯ:payments'),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listImportBatches } = vi.hoisted(() => ({ listImportBatches: vi.fn() }));
vi.mock('@/lib/services/import/rollback', () => ({ listImportBatches }));

const { listQueue, listQueueOrgNames } = vi.hoisted(() => ({
  listQueue: vi.fn(),
  listQueueOrgNames: vi.fn(),
}));
vi.mock('@/lib/services/import/oneCAccountCard', () => ({ listQueue, listQueueOrgNames }));

vi.mock('@/components/import/import-form', () => ({
  ImportForm: () => React.createElement('div', { 'data-testid': 'import-form' }),
}));
vi.mock('@/components/import/import-history', () => ({
  ImportHistory: (p: { batches: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'history', 'data-n': String(p.batches.length) }),
}));
vi.mock('@/components/import/payment-import-form', () => ({
  PaymentImportForm: () => React.createElement('div', { 'data-testid': 'payment-form' }),
}));
vi.mock('@/components/import/payment-queue-table', () => ({
  PaymentQueueTable: (p: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'queue', 'data-n': String(p.rows.length) }),
}));

import ManagerImportPage from '@/app/manager/import/page';
import ManagerPaymentsImportPage from '@/app/manager/payments-import/page';

const PLAIN = { sub: 'm1', role: 'manager' as const, managedOrgIds: ['o1'] };
const LEADER = { sub: 'l1', role: 'leader' as const };

beforeEach(() => {
  requireManager.mockReset().mockResolvedValue(PLAIN);
  mayImportOneC.mockReset().mockReturnValue(true);
  redirectToSettingsHub.mockReset();
  redirect.mockClear();
  listImportBatches.mockReset().mockResolvedValue({ ok: true, batches: [{ id: 'b1' }] });
  listQueue.mockReset().mockResolvedValue([]);
  listQueueOrgNames.mockReset().mockResolvedValue(new Map());
});

describe('«Загрузка из 1С» в кабинете менеджера', () => {
  it('обычный менеджер получает страницу, а не /forbidden', async () => {
    const { container } = await renderServerComponent(ManagerImportPage());
    expect(redirect).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="import-form"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Загрузка Excel из 1С');
    // Честно предупреждаем о границе: новых организаций менеджер не заводит.
    expect(container.textContent).toContain('новую карточку не заводят');
    expect(container.querySelector('[data-testid="history"]')?.getAttribute('data-n')).toBe('1');
  });

  it('руководителя уводит в его хаб и рисует прежнюю страницу при выключенном флаге', async () => {
    requireManager.mockResolvedValue(LEADER);
    const { container } = await renderServerComponent(ManagerImportPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/manager/import');
    expect(container.textContent).toContain('ЛИДЕРСКАЯ:excel');
  });

  it('право проверяется на странице: без него — /forbidden, а не пустой экран', async () => {
    // Сегодня предикат пускает всех менеджеров, но страница обязана следовать
    // за ним: поменяется правило — поменяется и доступ (§4, defense-in-depth).
    mayImportOneC.mockReturnValue(false);
    await expect(renderServerComponent(ManagerImportPage())).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('отказ сервиса истории не роняет страницу', async () => {
    listImportBatches.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(ManagerImportPage());
    expect(container.querySelector('[data-testid="history"]')?.getAttribute('data-n')).toBe('0');
  });
});

describe('«Импорт оплат» в кабинете менеджера', () => {
  it('обычный менеджер получает форму и очередь своих строк', async () => {
    listQueue.mockResolvedValue([
      {
        id: 'q1',
        externalId: 'p-1',
        paidAt: new Date('2026-08-01T00:00:00Z'),
        amount: 100,
        isRefund: false,
        purpose: 'оплата по счёту',
        counterpartyName: 'ООО Ромашка',
        counterpartyInn: null,
        accountCandidates: null,
        candidateOrgId: 'o1',
        matchMethod: 'name_fuzzy',
        batch: { companyId: 'co-1' },
      },
      {
        // Кандидата нет — вторая ветка маппинга имени организации.
        id: 'q2',
        externalId: 'p-2',
        paidAt: new Date('2026-08-02T00:00:00Z'),
        amount: 50,
        isRefund: true,
        purpose: null,
        counterpartyName: null,
        counterpartyInn: null,
        accountCandidates: ['260509-1905'],
        candidateOrgId: null,
        matchMethod: null,
        batch: { companyId: 'co-1' },
      },
      {
        // Кандидат есть, а имени в карте нет — ветка `?? null`.
        id: 'q3',
        externalId: 'p-3',
        paidAt: new Date('2026-08-03T00:00:00Z'),
        amount: 70,
        isRefund: false,
        purpose: null,
        counterpartyName: null,
        counterpartyInn: null,
        accountCandidates: null,
        candidateOrgId: 'o-ghost',
        matchMethod: 'name_fuzzy',
        batch: { companyId: 'co-1' },
      },
    ]);
    listQueueOrgNames.mockResolvedValue(new Map([['o1', 'ООО Ромашка']]));

    const { container } = await renderServerComponent(ManagerPaymentsImportPage());
    expect(redirect).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="payment-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="queue"]')?.getAttribute('data-n')).toBe('3');
  });

  it('право проверяется и на выписке', async () => {
    mayImportOneC.mockReturnValue(false);
    await expect(renderServerComponent(ManagerPaymentsImportPage())).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('руководителя уводит в его хаб', async () => {
    requireManager.mockResolvedValue(LEADER);
    const { container } = await renderServerComponent(ManagerPaymentsImportPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/manager/payments-import');
    expect(container.textContent).toContain('ЛИДЕРСКАЯ:payments');
  });
});
