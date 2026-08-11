import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import type { Payment } from '@prisma/client';
import { ManagerPaymentsList } from '@/components/manager/manager-payments-list';

function makePayment(overrides: Partial<Payment>): Payment {
  return {
    id: 'p1',
    amount: '100.00' as unknown as Payment['amount'],
    paidAt: new Date('2026-05-01'),
    method: 'bank',
    isRefund: false,
    note: null,
    orderId: 'o1',
    ...overrides,
  } as Payment;
}

describe('ManagerPaymentsList', () => {
  it('показывает назначение платежа и № платёжного поручения из выписки', () => {
    // Жалоба 11.08.2026: менеджер видел сумму и дату, а за что платили — нет.
    const html = renderToString(
      React.createElement(ManagerPaymentsList, {
        payments: [
          makePayment({
            purpose: 'ОПЛАТА ПО ДОГОВОРУ 260509-1905 ЗА ОБУЧЕНИЕ',
            paymentOrderNumber: '0000-001471',
          }),
        ],
      })
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('ЗА ОБУЧЕНИЕ');
    expect(html).toContain('п/п № 0000-001471');
  });

  it('платёж без назначения не рисует пустую строку', () => {
    const html = renderToString(
      React.createElement(ManagerPaymentsList, {
        payments: [makePayment({ purpose: null, paymentOrderNumber: null, note: 'Аванс' })],
      })
    );
    expect(html).toContain('Аванс');
    expect(html).not.toContain('п/п №');
  });

  it('empty: shows count-free header and "no payments" message', () => {
    const html = renderToString(React.createElement(ManagerPaymentsList, { payments: [] }));
    expect(html).toContain('Оплаты');
    expect(html).toContain('Оплат по заказу пока нет');
    expect(html).not.toContain('(0)');
  });

  it('shows the count when payments exist', () => {
    const payments = [makePayment({})];
    const html = renderToString(React.createElement(ManagerPaymentsList, { payments }));
    expect(html).toContain('(<!-- -->1<!-- -->)');
  });

  it('renders a regular payment (non-refund): no "Возврат" prefix/badge', () => {
    const payments = [makePayment({ isRefund: false, method: 'card', note: 'Заметка' })];
    const html = renderToString(React.createElement(ManagerPaymentsList, { payments }));
    expect(html).toContain('Карта');
    expect(html).toContain('Заметка');
    expect(html).not.toContain('Возврат');
  });

  it('renders a refund payment: prefix text + badge', () => {
    const payments = [makePayment({ isRefund: true, method: 'cash' })];
    const html = renderToString(React.createElement(ManagerPaymentsList, { payments }));
    expect(html).toContain('Возврат ');
    expect(html).toContain('Наличные');
    // badge span
    expect(html).toContain('text-red-700');
  });

  it('falls back to the raw method string when not in METHOD_LABELS', () => {
    const payments = [makePayment({ method: 'crypto' })];
    const html = renderToString(React.createElement(ManagerPaymentsList, { payments }));
    expect(html).toContain('crypto');
  });

  it('omits the method suffix entirely when method is null', () => {
    const payments = [makePayment({ method: null })];
    const html = renderToString(React.createElement(ManagerPaymentsList, { payments }));
    expect(html).not.toContain(' · null');
  });

  it('omits the note line when note is null', () => {
    const payments = [makePayment({ note: null })];
    const html = renderToString(React.createElement(ManagerPaymentsList, { payments }));
    // No stray "null" text rendered for the optional note
    expect(html).not.toContain('>null<');
  });
});
