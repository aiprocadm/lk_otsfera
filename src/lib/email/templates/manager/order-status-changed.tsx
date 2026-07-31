import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

export type ManagerOrderStatusChangedProps = {
  orderNumber: string;
  actorName: string;
  oldStatus: string;
  newStatus: string;
  orderUrl: string;
};

export function ManagerOrderStatusChanged(props: ManagerOrderStatusChangedProps) {
  return (
    <EmailLayout title="Статус заказа изменён">
      <p style={emailStyles.paragraph}>
        Менеджер <strong>{props.actorName}</strong> перевёл заказ{' '}
        <strong>№ {props.orderNumber}</strong>:
        <br />
        <strong>{props.oldStatus}</strong> → <strong>{props.newStatus}</strong>.
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

export function managerOrderStatusChangedSubject(props: ManagerOrderStatusChangedProps): string {
  return `Менеджер ${props.actorName} перевёл заказ № ${props.orderNumber} в ${props.newStatus}`;
}

export function managerOrderStatusChangedText(props: ManagerOrderStatusChangedProps): string {
  return [
    `Менеджер ${props.actorName} перевёл заказ № ${props.orderNumber}:`,
    `${props.oldStatus} → ${props.newStatus}.`,
    '',
    `Открыть заказ: ${props.orderUrl}`,
  ].join('\n');
}
