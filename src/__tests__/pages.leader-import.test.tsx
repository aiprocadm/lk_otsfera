// @vitest-environment jsdom
/**
 * Зеркальные страницы «Обмен с 1С» в хабе руководителя (этап 7 ТЗ импорта,
 * Т-27): leader-гард, excel БЕЗ селекта компаний (компанию задаёт скоуп, Т-41),
 * выписка с очередью своей компании, вкладки и index-redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

const { loadQueuePage } = vi.hoisted(() => ({
  loadQueuePage: vi.fn(),
}));
vi.mock('@/lib/services/import/oneCAccountCard/queue-view', () => ({ loadQueuePage }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// Этап 9 (Т-39): история импортов на excel-вкладке.
const { listImportBatches } = vi.hoisted(() => ({ listImportBatches: vi.fn() }));
vi.mock('@/lib/services/import/rollback', () => ({ listImportBatches }));
vi.mock('@/components/import/import-history', () => ({
  ImportHistory: (props: { batches: unknown[] }) =>
    React.createElement('div', {
      'data-testid': 'import-history',
      'data-batches': String(props.batches.length),
    }),
}));

const nav = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  pathname: '/leader/settings/integrations/1c/excel',
}));
vi.mock('next/navigation', () => ({
  redirect: nav.redirect,
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/components/import/import-form', () => ({
  ImportForm: (props: { companies?: unknown }) =>
    React.createElement('div', {
      'data-testid': 'import-form',
      'data-has-companies': String('companies' in props && props.companies !== undefined),
    }),
}));
vi.mock('@/components/import/payment-import-form', () => ({
  PaymentImportForm: () => React.createElement('div', { 'data-testid': 'payment-import-form' }),
}));
vi.mock('@/components/import/payment-queue-table', () => ({
  PaymentQueueTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'queue', 'data-rows': String(props.rows.length) }),
}));

import LeaderImportPage from '@/app/leader/settings/integrations/1c/excel/page';
import LeaderPaymentsImportPage from '@/app/leader/settings/integrations/1c/payments/page';
import LeaderOneCLayout from '@/app/leader/settings/integrations/1c/layout';
import LeaderOneCIndexPage from '@/app/leader/settings/integrations/1c/page';

const LEADER = { sub: 'l1', role: 'leader' as const };

beforeEach(() => {
  requireSettingsSection.mockReset().mockResolvedValue(LEADER);
  loadQueuePage.mockReset().mockResolvedValue({ rows: [], total: 0, take: 50, skip: 0 });
  listImportBatches.mockReset().mockResolvedValue({ ok: true, batches: [{ id: 'b1' }] });
  nav.redirect.mockClear();
});

describe('вкладка «Загрузка Excel» руководителя', () => {
  it('leader-гард раздела и форма БЕЗ селекта компаний (Т-41: компанию задаёт скоуп)', async () => {
    const { container } = await renderServerComponent(LeaderImportPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', 'leader');
    const form = container.querySelector('[data-testid="import-form"]');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('data-has-companies')).toBe('false');
    expect(container.textContent).toContain('Новые организации попадут в вашу компанию');
    // Этап 9 (Т-39): история импортов и у руководителя.
    expect(container.textContent).toContain('История импортов');
    expect(
      container.querySelector('[data-testid="import-history"]')?.getAttribute('data-batches')
    ).toBe('1');
  });
});

describe('вкладка «Загрузка Excel» — отказ истории', () => {
  it('отказ сервиса истории не роняет страницу — таблица пустая', async () => {
    listImportBatches.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(LeaderImportPage());
    expect(
      container.querySelector('[data-testid="import-history"]')?.getAttribute('data-batches')
    ).toBe('0');
  });
});

describe('вкладка «Выписка по счёту 51» руководителя', () => {
  it('leader-гард, форма выписки и страница очереди из адреса', async () => {
    // `У-90`: страница тонкая — маппинг строк живёт в сервисе; экран отвечает
    // за гард, параметры адреса и проброс счётчика в таблицу.
    loadQueuePage.mockResolvedValue({
      rows: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
      total: 120,
      take: 50,
      skip: 50,
    });
    const { container } = await renderServerComponent(
      LeaderPaymentsImportPage({ searchParams: Promise.resolve({ skip: '50' }) })
    );
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', 'leader');
    expect(loadQueuePage).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      skip: '50',
    });
    expect(container.querySelector('[data-testid="payment-import-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="queue"]')?.getAttribute('data-rows')).toBe('3');
  });

  it('без параметров адреса — первая страница очереди', async () => {
    await renderServerComponent(LeaderPaymentsImportPage({}));
    expect(loadQueuePage).toHaveBeenCalledWith(expect.anything(), expect.anything(), {});
  });
});

describe('оболочка подраздела руководителя', () => {
  it('layout рисует вкладки leader-кабинета над содержимым', () => {
    const { container } = render(
      LeaderOneCLayout({ children: <div data-testid="tab">ВКЛАДКА</div> }) as React.ReactElement
    );
    const links = [...container.querySelectorAll('a')];
    // `У-45` (этап 7): вкладок стало четыре — добавились автообмен и общая
    // история; `У-173` (этап 8) — пятая, «Выгрузка документов», перед историей.
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/leader/settings/integrations/1c/excel',
      '/leader/settings/integrations/1c/payments',
      '/leader/settings/integrations/1c/auto',
      '/leader/settings/integrations/1c/documents',
      '/leader/settings/integrations/1c/history',
    ]);
    expect(links[0]?.getAttribute('data-active')).toBe('true');
    expect(container.querySelector('[data-testid="tab"]')).not.toBeNull();
  });

  it('`У-118`: корень подраздела спрашивает, что делать, а не бросает в форму', async () => {
    // Раньше здесь стоял молчаливый редирект на загрузку Excel — человек
    // оказывался в форме, не поняв, туда ли пришёл. Теперь, как у админа
    // (`У-47`), первым делом навигатор задачи.
    const { container } = await renderServerComponent(LeaderOneCIndexPage());
    expect(nav.redirect).not.toHaveBeenCalled();
    expect(container.querySelector('h1')?.textContent).toBe('Обмен с 1С');
    expect(container.textContent).toContain('Что вы хотите сделать?');
  });
});
