// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// Граница видимости участника (`У-236`) читается из базы отдельным запросом;
// здесь prisma — пустышка, а сама граница проверяется своим стражем.
vi.mock('@/lib/services/organization/memberScope', () => ({
  orgOrderScope: vi.fn(async () => null),
}));

const { getOrgFinanceKpis, listOrgPayments } = vi.hoisted(() => ({
  getOrgFinanceKpis: vi.fn(),
  listOrgPayments: vi.fn(),
}));
vi.mock('@/lib/services/organization/finance', () => ({ getOrgFinanceKpis, listOrgPayments }));
// Этап 6 (`У-235`): счета — свой сервис; разбор параметров берём настоящий.
const { listOrgInvoices } = vi.hoisted(() => ({ listOrgInvoices: vi.fn() }));
vi.mock('@/lib/services/organization/invoices', async () => ({
  ...(await vi.importActual<typeof import('@/lib/services/organization/invoices')>(
    '@/lib/services/organization/invoices'
  )),
  listOrgInvoices,
}));
vi.mock('@/components/organization/org-invoice-download-button', () => ({
  OrgInvoiceDownloadButton: () => null,
}));
const EMPTY_INVOICES = {
  rows: [],
  total: 0,
  toPay: '0.00',
  counts: { unpaid: 0, partially_paid: 0, paid: 0, unknown: 0 },
};

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

import OrganizationFinancePage from '@/app/organization/finance/page';

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

describe('OrganizationFinancePage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    getOrgFinanceKpis.mockReset();
    listOrgPayments.mockReset();
    listOrgInvoices.mockReset().mockResolvedValue(EMPTY_INVOICES);
  });

  it('fetches KPIs and payments scoped to the active org and renders the finance sections', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgFinanceKpis.mockResolvedValue({ billed: '1000', paid: '500', outstanding: '500' });
    listOrgPayments.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      OrganizationFinancePage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );

    expect(getOrgPageContext).toHaveBeenCalledWith({ org: 'org-1' });
    expect(getOrgFinanceKpis).toHaveBeenCalledWith({}, 'org-1', null);
    expect(listOrgPayments).toHaveBeenCalledWith({}, { organizationId: 'org-1', scope: null });
    expect(listOrgInvoices).toHaveBeenCalledWith({}, { organizationId: 'org-1', scope: null });
    expect(container.textContent).toContain('Счета');
    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('ООО Ромашка');
  });

  it('renders with empty searchParams', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgFinanceKpis.mockResolvedValue({ billed: '0', paid: '0', outstanding: '0' });
    listOrgPayments.mockResolvedValue([]);

    await renderServerComponent(OrganizationFinancePage({ searchParams: Promise.resolve({}) }));

    expect(getOrgPageContext).toHaveBeenCalledWith({});
  });
});

// ─── Этап 9 PR-3 (ФТ-12.2): кнопка выгрузки платежей клиентом ────────────────

describe('OrganizationFinancePage — выгрузка в Excel', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    getOrgFinanceKpis.mockReset();
    listOrgPayments.mockReset();
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgFinanceKpis.mockResolvedValue({ billed: '1000', paid: '500', outstanding: '500' });
    listOrgPayments.mockResolvedValue([]);
  });

  it('ссылка ведёт на клиентский роут и несёт активную организацию', async () => {
    const { container } = await renderServerComponent(
      OrganizationFinancePage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );
    const href = container
      .querySelector('a[href*="/api/organization/finance/export"]')!
      .getAttribute('href')!;
    expect(href).toContain('org=org-1');
  });
});

describe('OrganizationFinancePage — фильтры счетов (этап 6, У-235)', () => {
  it('период и состояние из адреса передаются сервису разобранными; мусор отбрасывается', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgFinanceKpis.mockResolvedValue({ billed: '0', paid: '0', outstanding: '0' });
    listOrgPayments.mockResolvedValue([]);
    await renderServerComponent(
      OrganizationFinancePage({
        searchParams: Promise.resolve({
          org: 'org-1',
          from: '2026-09-01',
          to: 'мусор',
          state: 'paid',
        }),
      })
    );
    expect(listOrgInvoices).toHaveBeenCalledWith(
      {},
      {
        organizationId: 'org-1',
        // Прогон №36: «с 01.09» — московская полночь 01.09.
        from: new Date('2026-08-31T21:00:00.000Z'),
        to: undefined,
        state: 'paid',
        scope: null,
      }
    );
  });

  it('обе границы периода доезжают и до сервиса, и до подписи фильтра на экране', async () => {
    // Верхнюю границу легко потерять: сервис её получает, а экран показывает
    // «с 01.09», и человек уверен, что смотрит до сегодня.
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgFinanceKpis.mockResolvedValue({ billed: '0', paid: '0', outstanding: '0' });
    listOrgPayments.mockResolvedValue([]);
    const { container } = await renderServerComponent(
      OrganizationFinancePage({
        searchParams: Promise.resolve({ from: '2026-09-01', to: '2026-09-30' }),
      })
    );
    // Верхняя граница — полночь ПОСЛЕ дня «по» по Москве (сервис берёт `lt`):
    // иначе счёт, выставленный 30-го, в отбор «по 30-е» не попал бы. Прогон
    // №36: раньше здесь стоял конец дня по Гринвичу — 01.10 02:59 по Москве.
    expect(listOrgInvoices.mock.calls.at(-1)![1]).toMatchObject({
      from: new Date('2026-08-31T21:00:00.000Z'),
      to: new Date('2026-09-30T21:00:00.000Z'),
    });
    // И в самой форме фильтра: поле «по» обязано остаться заполненным, иначе
    // человек, поправив «с», случайно сбросит верхнюю границу.
    const to = container.querySelector(
      '[data-testid="org-invoices-filter"] input[name="to"]'
    ) as HTMLInputElement | null;
    expect(to?.getAttribute('value')).toBe('2026-09-30');
  });
});
