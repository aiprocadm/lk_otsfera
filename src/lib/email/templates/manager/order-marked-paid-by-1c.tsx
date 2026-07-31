import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

export type ManagerOrderMarkedPaidBy1CProps = {
  orderNumber: string;
  amount: number;
  paidAt: Date;
  orderUrl: string;
};

function fmtMoney(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function ManagerOrderMarkedPaidBy1C(props: ManagerOrderMarkedPaidBy1CProps) {
  return (
    <EmailLayout title="Получена оплата (1С)">
      <p style={emailStyles.paragraph}>
        По заказу <strong>№ {props.orderNumber}</strong> получена оплата{' '}
        <strong>{fmtMoney(props.amount)}</strong> от {fmtDate(props.paidAt)} (отметка 1С).
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

export function managerOrderMarkedPaidBy1CSubject(props: ManagerOrderMarkedPaidBy1CProps): string {
  return `Получена оплата ${fmtMoney(props.amount)} по заказу № ${props.orderNumber}`;
}

export function managerOrderMarkedPaidBy1CText(props: ManagerOrderMarkedPaidBy1CProps): string {
  return [
    `По заказу № ${props.orderNumber} получена оплата ${fmtMoney(props.amount)} от ${fmtDate(props.paidAt)} (отметка 1С).`,
    '',
    `Открыть заказ: ${props.orderUrl}`,
  ].join('\n');
}
