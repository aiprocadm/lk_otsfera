import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OrgInvoiceRow, OrgInvoicesResult } from '@/lib/services/organization/invoices';

vi.mock('@/components/organization/org-invoice-download-button', () => ({
  OrgInvoiceDownloadButton: ({ documentId }: { documentId: string }) =>
    React.createElement('button', { 'data-testid': `dl-${documentId}` }, 'Скачать'),
}));

import { OrgFinanceInvoices } from '@/components/organization/org-finance-invoices';

/** Блок «Счета» в «Финансах» заказчика (`У-235`). */

function row(over: Partial<OrgInvoiceRow> = {}): OrgInvoiceRow {
  return {
    id: 'd1',
    number: 'С-2026-17',
    name: 'Счёт С-2026-17',
    issuedAt: new Date('2026-09-01T10:00:00Z'),
    orderId: 'o1',
    orderNumber: 'З-1',
    orderTitle: 'Обучение',
    amountGross: '1000.00',
    paid: '400.00',
    due: '600.00',
    state: 'partially_paid',
    matched: true,
    ambiguous: false,
    hasFile: true,
    ...over,
  };
}

function result(rows: OrgInvoiceRow[], over: Partial<OrgInvoicesResult> = {}): OrgInvoicesResult {
  return {
    rows,
    total: rows.length,
    toPay: '600.00',
    counts: { unpaid: 0, partially_paid: 1, paid: 0, unknown: 0 },
    ...over,
  };
}

function html(res: OrgInvoicesResult, filter = {}) {
  return renderToStaticMarkup(
    React.createElement(OrgFinanceInvoices, { result: res, orgId: 'org1', filter })
  );
}

describe('OrgFinanceInvoices', () => {
  it('заголовок, подзаголовок, «к оплате», фильтр со счётчиками, таблица и карточки', () => {
    const out = html(result([row()]));
    expect(out).toContain('Счета');
    expect(out).toContain('оплата определяется по назначению платежа');
    expect(out).toContain('К оплате');
    expect(out).toContain('text-red-700');
    expect(out).toContain('name="org" value="org1"');
    expect(out).toContain('Все (1)');
    expect(out).toContain('Оплачен частично (1)');
    expect(out).toContain('data-testid="invoice-row-d1"');
    expect(out).toContain('href="/organization/orders/o1?org=org1"');
    expect(out).toContain('data-testid="dl-d1"');
    // Карточки на телефоне — те же данные (`У-18`).
    expect(out).toContain('md:hidden');
    expect(out).toContain('hidden md:block');
    expect(out).not.toContain('Сбросить');
  });

  // `У-329`: строка «счёт по заказу» без файла — ссылка на заказ есть,
  // кнопки скачивания нет, вместо неё — «файл в 1С».
  it('строка заказа без файла: ссылка на заказ, «файл в 1С», без кнопки скачивания', () => {
    const out = html(
      result([
        row({
          id: 'order:o9',
          number: null,
          name: 'Счёт по заказу DEMO-1',
          orderId: 'o9',
          hasFile: false,
        }),
      ])
    );
    expect(out).toContain('Счёт по заказу DEMO-1');
    expect(out).toContain('href="/organization/orders/o9?org=org1"');
    expect(out).toContain('файл в 1С');
    expect(out).not.toContain('data-testid="dl-order:o9"');
  });

  it('у заказа нет номера — в ссылке название, а без названия — слово «Заказ»', () => {
    // Номер заказу присваивает 1С: до обмена его нет, и ссылка не должна
    // превращаться в пустое место.
    const noNumber = html(result([row({ orderNumber: null })]));
    expect(noNumber).toContain('>Обучение</a>');
    const noTitle = html(result([row({ orderNumber: null, orderTitle: null })]));
    expect(noTitle).toContain('>Заказ</a>');
  });

  it('состояния: подписи, подсказки про сопоставление и «не определено» без остатка', () => {
    const out = html(
      result([
        row({ id: 'a', state: 'unpaid', matched: false, paid: '0.00', due: '1000.00' }),
        row({ id: 'b', state: 'unpaid', ambiguous: true }),
        row({ id: 'c', state: 'paid', due: '0.00' }),
        row({ id: 'd', state: 'unknown', paid: null, due: null, orderId: null, number: null }),
      ])
    );
    expect(out).toContain('Ни один платёж не сослался на этот счёт');
    expect(out).toContain('Платёж назвал несколько счетов сразу');
    expect(out).toContain('Оплачен</span>');
    expect(out).toContain('Не определено');
    // Без номера показываем имя файла; без заказа — прочерк.
    expect(out).toContain('Счёт С-2026-17');
  });

  it('пустой список: без фильтров — объяснение, с фильтрами — другая подсказка и «Сбросить»', () => {
    const empty = result([], {
      toPay: '0.00',
      counts: { unpaid: 0, partially_paid: 0, paid: 0, unknown: 0 },
    });
    expect(html(empty)).toContain('Счетов пока нет');
    const filtered = html(empty, { state: 'paid' });
    expect(filtered).toContain('По выбранным фильтрам счетов нет');
    expect(filtered).toContain('Сбросить');
    expect(filtered).toContain('href="/organization/finance?org=org1"');
  });

  it('значения фильтра подставляются в форму', () => {
    const out = html(result([row()]), {
      from: '2026-09-01',
      to: '2026-09-30',
      state: 'partially_paid',
    });
    expect(out).toContain('name="from" value="2026-09-01"');
    expect(out).toContain('name="to" value="2026-09-30"');
    expect(out).toContain('selected=""');
  });
});
