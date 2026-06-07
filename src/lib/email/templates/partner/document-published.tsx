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
  orderNumber: string;
  orderTitle: string;
  documentName: string;
  documentType: string;
  orderUrl: string;
};

export function PartnerDocumentPublished(props: PartnerDocumentPublishedProps) {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return (
    <EmailLayout title='Новый документ'>
      <p style={emailStyles.paragraph}>
        По заказу <strong>№ {props.orderNumber}</strong> загружен {typeLabel}{' '}
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
  return `Новый документ ${props.documentName} по заказу № ${props.orderNumber}`;
}

export function partnerDocumentPublishedText(props: PartnerDocumentPublishedProps): string {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return [
    `По заказу № ${props.orderNumber} загружен ${typeLabel} «${props.documentName}».`,
    '',
    `Открыть портфолио: ${props.orderUrl}`
  ].join('\n');
}
