import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

export type OrgPaymentReceivedProps = {
  organizationName: string;
  orderNumber: string | null;
  orderTitle: string;
  amount: string;
  paidAt: Date;
  orderUrl: string;
};

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

export function OrgPaymentReceivedTemplate(props: OrgPaymentReceivedProps) {
  const orderLabel = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;

  return (
    <EmailLayout title='Получена оплата'>
      <p style={emailStyles.paragraph}>
        Получена оплата <strong>{fmtMoney(props.amount)}</strong> по заказу{' '}
        <strong>{orderLabel}</strong> ({props.organizationName}) от{' '}
        {fmtDate(props.paidAt)}.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={props.orderUrl} style={emailStyles.button}>
          Открыть заказ
        </a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{props.orderUrl}</span>
      </p>
    </EmailLayout>
  );
}

export function orgPaymentReceivedSubject(props: OrgPaymentReceivedProps): string {
  const label = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;
  return `Оплата ${fmtMoney(props.amount)} по заказу ${label}`;
}

export function orgPaymentReceivedText(props: OrgPaymentReceivedProps): string {
  const orderLabel = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;
  return [
    `Получена оплата ${fmtMoney(props.amount)} по заказу ${orderLabel} (${props.organizationName}) от ${fmtDate(props.paidAt)}.`,
    '',
    `Открыть заказ: ${props.orderUrl}`
  ].join('\n');
}
