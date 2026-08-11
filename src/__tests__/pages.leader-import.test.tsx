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

const { listQueue, listQueueOrgNames } = vi.hoisted(() => ({
  listQueue: vi.fn(),
  listQueueOrgNames: vi.fn(),
}));
vi.mock('@/lib/services/import/oneCAccountCard', () => ({ listQueue, listQueueOrgNames }));
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

const LEADER = { sub: 'l1', role: 'manager' as const, managerRole: 'leader' as const };

beforeEach(() => {
  requireSettingsSection.mockReset().mockResolvedValue(LEADER);
  listQueue.mockReset().mockResolvedValue([]);
  listQueueOrgNames.mockReset().mockResolvedValue(new Map());
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

describe('вкладка «Выписка (сч. 51)» руководителя', () => {
  it('leader-гард, форма выписки и очередь разбора', async () => {
    listQueue.mockResolvedValue([
      {
        id: 'q1',
        externalId: 'p-1',
        paidAt: new Date('2026-08-01T00:00:00Z'),
        amount: 100,
        isRefund: false,
        purpose: 'оплата',
        counterpartyName: 'ООО Ромашка',
        counterpartyInn: '7707083893',
        accountCandidates: null,
        candidateOrgId: 'org-1',
        matchMethod: 'inn',
        batch: { companyId: 'co-1' },
      },
      {
        // Кандидат есть, но имени в карте нет — ветка `?? null`.
        id: 'q3',
        externalId: 'p-3',
        paidAt: new Date('2026-08-03T00:00:00Z'),
        amount: 75,
        isRefund: false,
        purpose: 'оплата без имени',
        counterpartyName: 'ООО Безымянное',
        counterpartyInn: null,
        accountCandidates: null,
        candidateOrgId: 'org-ghost',
        matchMethod: 'account',
        batch: { companyId: 'co-1' },
      },
      {
        // Строка без кандидата — вторая ветка маппинга (candidateOrgName: null).
        id: 'q2',
        externalId: 'p-2',
        paidAt: new Date('2026-08-02T00:00:00Z'),
        amount: 50,
        isRefund: false,
        purpose: 'неопознанная оплата',
        counterpartyName: 'ИП Незнакомец',
        counterpartyInn: null,
        accountCandidates: ['40702810000000000001'],
        candidateOrgId: null,
        matchMethod: null,
        batch: { companyId: 'co-1' },
      },
    ]);
    listQueueOrgNames.mockResolvedValue(new Map([['org-1', 'ООО Ромашка']]));
    const { container } = await renderServerComponent(LeaderPaymentsImportPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', 'leader');
    expect(container.querySelector('[data-testid="payment-import-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="queue"]')?.getAttribute('data-rows')).toBe('3');
  });
});

describe('оболочка подраздела руководителя', () => {
  it('layout рисует вкладки leader-кабинета над содержимым', () => {
    const { container } = render(
      LeaderOneCLayout({ children: <div data-testid="tab">ВКЛАДКА</div> }) as React.ReactElement
    );
    const links = [...container.querySelectorAll('a')];
    // `У-45` (этап 7): вкладок четыре — добавились автообмен и общая история.
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/leader/settings/integrations/1c/excel',
      '/leader/settings/integrations/1c/payments',
      '/leader/settings/integrations/1c/auto',
      '/leader/settings/integrations/1c/history',
    ]);
    expect(links[0]?.getAttribute('data-active')).toBe('true');
    expect(container.querySelector('[data-testid="tab"]')).not.toBeNull();
  });

  it('корень подраздела открывает первую вкладку', () => {
    expect(() => LeaderOneCIndexPage()).toThrow('REDIRECT');
    expect(nav.redirect).toHaveBeenCalledWith('/leader/settings/integrations/1c/excel');
  });
});
