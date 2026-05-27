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

export type ManagerDocumentUploadedByOrgProps = {
  orgName: string;
  orderNumber: string;
  documentName: string;
  documentType: string;
  orderUrl: string;
};

export function ManagerDocumentUploadedByOrg(props: ManagerDocumentUploadedByOrgProps) {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';

  return (
    <EmailLayout title='Документ от организации'>
      <p style={emailStyles.paragraph}>
        Организация <strong>{props.orgName}</strong> загрузила {typeLabel}{' '}
        <strong>«{props.documentName}»</strong> к заказу{' '}
        <strong>№ {props.orderNumber}</strong>.
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

export function managerDocumentUploadedByOrgSubject(
  props: ManagerDocumentUploadedByOrgProps
): string {
  return `${props.orgName} загрузил документ ${props.documentName} к заказу № ${props.orderNumber}`;
}

export function managerDocumentUploadedByOrgText(
  props: ManagerDocumentUploadedByOrgProps
): string {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return [
    `Организация ${props.orgName} загрузила ${typeLabel} «${props.documentName}» к заказу № ${props.orderNumber}.`,
    '',
    `Открыть заказ: ${props.orderUrl}`
  ].join('\n');
}
