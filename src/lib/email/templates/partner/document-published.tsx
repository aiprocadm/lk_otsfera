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

export type PartnerDocumentPublishedProps = {
  partnerName: string;
  orderNumber: string | null;
  orderTitle: string | null;
  documentName: string;
  documentType: string;
  orderUrl: string;
};

export function PartnerDocumentPublished(props: PartnerDocumentPublishedProps) {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  const orderRef = props.orderNumber ? `№ ${props.orderNumber}` : props.orderTitle ? `«${props.orderTitle}»` : '(без заказа)';
  return (
    <EmailLayout title='Новый документ'>
      <p style={emailStyles.paragraph}>
        По заказу <strong>{orderRef}</strong> загружен {typeLabel}{' '}
        <strong>«{props.documentName}»</strong>.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={props.orderUrl} style={emailStyles.button}>Открыть портфолио</a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{props.orderUrl}</span>
      </p>
    </EmailLayout>
  );
}

export function partnerDocumentPublishedSubject(props: PartnerDocumentPublishedProps): string {
  const orderRef = props.orderNumber ? `№ ${props.orderNumber}` : props.orderTitle ? `«${props.orderTitle}»` : '(без заказа)';
  return `Новый документ ${props.documentName} по заказу ${orderRef}`;
}

export function partnerDocumentPublishedText(props: PartnerDocumentPublishedProps): string {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  const orderRef = props.orderNumber ? `№ ${props.orderNumber}` : props.orderTitle ? `«${props.orderTitle}»` : '(без заказа)';
  return [
    `По заказу ${orderRef} загружен ${typeLabel} «${props.documentName}».`,
    '',
    `Открыть портфолио: ${props.orderUrl}`
  ].join('\n');
}
