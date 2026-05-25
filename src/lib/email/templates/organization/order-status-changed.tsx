import * as React from 'react';
import type { ExecutionStatus, FinancialStatus } from '@prisma/client';
import { EmailLayout, emailStyles } from '../layout';

const EXECUTION_LABELS: Record<ExecutionStatus, string> = {
  pending: 'Ожидает старта',
  in_progress: 'В работе',
  on_hold: 'На паузе',
  completed: 'Завершён',
  cancelled: 'Отменён'
};

const FINANCIAL_LABELS: Record<FinancialStatus, string> = {
  not_billed: 'Счёт не выставлен',
  billed: 'Счёт выставлен',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  refunded: 'Возврат'
};

export type OrgOrderStatusChangedProps = {
  organizationName: string;
  orderNumber: string | null;
  orderTitle: string;
  dimension: 'execution' | 'financial';
  oldStatus: string;
  newStatus: string;
  orderUrl: string;
};

function statusLabel(dimension: 'execution' | 'financial', status: string): string {
  if (dimension === 'execution') {
    return EXECUTION_LABELS[status as ExecutionStatus] ?? status;
  }
  return FINANCIAL_LABELS[status as FinancialStatus] ?? status;
}

export function OrgOrderStatusChangedTemplate(props: OrgOrderStatusChangedProps) {
  const orderLabel = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;
  const dimensionLabel = props.dimension === 'execution' ? 'Статус заказа' : 'Финансовый статус';
  const oldLabel = statusLabel(props.dimension, props.oldStatus);
  const newLabel = statusLabel(props.dimension, props.newStatus);

  return (
    <EmailLayout title={`${dimensionLabel} изменён`}>
      <p style={emailStyles.paragraph}>
        По заказу <strong>{orderLabel}</strong> ({props.organizationName}){' '}
        {dimensionLabel.toLowerCase()} изменён:
        <br />
        <strong>{oldLabel}</strong> → <strong>{newLabel}</strong>.
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

export function orgOrderStatusChangedSubject(props: OrgOrderStatusChangedProps): string {
  const label = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;
  const dim = props.dimension === 'execution' ? 'Статус' : 'Финансы';
  return `${dim} заказа ${label}: ${statusLabel(props.dimension, props.newStatus)}`;
}

export function orgOrderStatusChangedText(props: OrgOrderStatusChangedProps): string {
  const orderLabel = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;
  const dimensionLabel =
    props.dimension === 'execution' ? 'Статус заказа' : 'Финансовый статус';
  const oldLabel = statusLabel(props.dimension, props.oldStatus);
  const newLabel = statusLabel(props.dimension, props.newStatus);
  return [
    `По заказу ${orderLabel} (${props.organizationName}) ${dimensionLabel.toLowerCase()} изменён:`,
    `${oldLabel} → ${newLabel}.`,
    '',
    `Открыть заказ: ${props.orderUrl}`
  ].join('\n');
}
