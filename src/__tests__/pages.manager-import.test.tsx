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

const { loadQueuePage } = vi.hoisted(() => ({
  loadQueuePage: vi.fn(),
}));
vi.mock('@/lib/services/import/oneCAccountCard/queue-view', () => ({ loadQueuePage }));

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

import ManagerExcelTab from '@/app/manager/exchange/excel/page';
import ManagerPaymentsTab from '@/app/manager/exchange/payments/page';

const PLAIN = { sub: 'm1', role: 'manager' as const, managedOrgIds: ['o1'] };
const LEADER = { sub: 'l1', role: 'leader' as const };

beforeEach(() => {
  requireManager.mockReset().mockResolvedValue(PLAIN);
  mayImportOneC.mockReset().mockReturnValue(true);
  redirect.mockClear();
  listImportBatches.mockReset().mockResolvedValue({ ok: true, batches: [{ id: 'b1' }] });
  loadQueuePage.mockReset().mockResolvedValue({ rows: [], total: 0, take: 50, skip: 0 });
});

/**
 * `У-113`: обмен с 1С стал ОДНИМ разделом с вкладками. Экраны те же, адреса
 * новые; старые остались шлюзами — по ним ходят из закладок и инструкций.
 */
describe('вкладка «Загрузка Excel» раздела «Обмен с 1С»', () => {
  it('обычный менеджер получает страницу, а не /forbidden', async () => {
    const { container } = await renderServerComponent(ManagerExcelTab());
    expect(redirect).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="import-form"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Загрузка Excel из 1С');
    // Честно предупреждаем о границе: новых организаций менеджер не заводит.
    expect(container.textContent).toContain('новую карточку не заводят');
    // `У-113`: история переехала на свою вкладку — двух историй на экране быть
    // не должно.
    expect(container.querySelector('[data-testid="history"]')).toBeNull();
  });

  it('руководителю показываем его же экран из хаба, а не второй такой же', async () => {
    requireManager.mockResolvedValue(LEADER);
    const { container } = await renderServerComponent(ManagerExcelTab());
    expect(container.textContent).toContain('ЛИДЕРСКАЯ:excel');
  });

  it('право проверяется на странице: без него — /forbidden, а не пустой экран', async () => {
    // Сегодня предикат пускает всех менеджеров, но страница обязана следовать
    // за ним: поменяется правило — поменяется и доступ (§4, defense-in-depth).
    mayImportOneC.mockReturnValue(false);
    await expect(renderServerComponent(ManagerExcelTab())).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('история загрузок живёт на своей вкладке, а не на этой', () => {
    // Сервис истории вкладке загрузки больше не нужен: она о загрузке.
    expect(listImportBatches).not.toHaveBeenCalled();
  });
});

describe('вкладка «Выписка по счёту 51» раздела «Обмен с 1С»', () => {
  it('обычный менеджер получает форму и страницу очереди своих строк', async () => {
    // `У-90`: строки уже приведены сервисом; экран отвечает за гарды, адрес и
    // проброс счётчика.
    loadQueuePage.mockResolvedValue({
      rows: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
      total: 3,
      take: 50,
      skip: 0,
    });

    const { container } = await renderServerComponent(
      ManagerPaymentsTab({ searchParams: Promise.resolve({ inn: 'without' }) })
    );
    expect(redirect).not.toHaveBeenCalled();
    expect(loadQueuePage).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      inn: 'without',
    });
    expect(container.querySelector('[data-testid="payment-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="queue"]')?.getAttribute('data-n')).toBe('3');
  });

  it('страница открыта без единого параметра адреса — очередь всё равно строится', async () => {
    // На экран заходят и по ссылке из меню, где параметров нет вовсе. Без
    // запасного пустого набора разбор фильтров упал бы на `undefined`, и
    // раздел открывался бы только «через фильтр».
    loadQueuePage.mockResolvedValue({ rows: [], total: 0, take: 50, skip: 0 });
    await renderServerComponent(ManagerPaymentsTab({}));
    expect(loadQueuePage).toHaveBeenCalledWith(expect.anything(), expect.anything(), {});
  });

  it('право проверяется и на выписке', async () => {
    mayImportOneC.mockReturnValue(false);
    await expect(renderServerComponent(ManagerPaymentsTab({}))).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('руководителю показываем его же экран из хаба', async () => {
    requireManager.mockResolvedValue(LEADER);
    const { container } = await renderServerComponent(ManagerPaymentsTab({}));
    expect(container.textContent).toContain('ЛИДЕРСКАЯ:payments');
  });
});
