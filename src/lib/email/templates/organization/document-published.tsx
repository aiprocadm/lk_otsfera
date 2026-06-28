import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

const DOC_TYPE_LABELS: Record<string, string> = {
  contract: 'договор',
  extra_agreement: 'доп. соглашение',
  invoice: 'счёт',
  act: 'акт',
  waybill: 'накладную',
  certificate: 'сертификат',
  report: 'отчёт',
  commission_statement: 'расчёт комиссии',
  other: 'документ'
};

export type OrgDocumentPublishedProps = {
  organizationName: string;
  orderNumber: string | null;
  orderTitle: string | null;
  documentName: string;
  documentType: string;
  orderUrl: string;
};

export function OrgDocumentPublishedTemplate(props: OrgDocumentPublishedProps) {
  const { organizationName, orderNumber, orderTitle, documentName, documentType, orderUrl } = props;
  const typeLabel = DOC_TYPE_LABELS[documentType] ?? 'документ';
  const orderLabel = orderNumber ? `№ ${orderNumber}` : orderTitle ? `«${orderTitle}»` : '(без заказа)';

  return (
    <EmailLayout title='Новый документ по заказу'>
      <p style={emailStyles.paragraph}>
        По заказу <strong>{orderLabel}</strong> ({organizationName}) загружен{' '}
        {typeLabel}: <strong>«{documentName}»</strong>.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={orderUrl} style={emailStyles.button}>
          Открыть заказ
        </a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{orderUrl}</span>
      </p>
    </EmailLayout>
  );
}

export function orgDocumentPublishedSubject(props: OrgDocumentPublishedProps): string {
  const label = props.orderNumber ? `№ ${props.orderNumber}` : props.orderTitle ? `«${props.orderTitle}»` : '(без заказа)';
  return `Новый документ по заказу ${label}`;
}

export function orgDocumentPublishedText(props: OrgDocumentPublishedProps): string {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  const orderLabel = props.orderNumber ? `№ ${props.orderNumber}` : props.orderTitle ? `«${props.orderTitle}»` : '(без заказа)';
  return [
    `По заказу ${orderLabel} (${props.organizationName}) загружен ${typeLabel}: «${props.documentName}».`,
    '',
    `Открыть заказ: ${props.orderUrl}`
  ].join('\n');
}
