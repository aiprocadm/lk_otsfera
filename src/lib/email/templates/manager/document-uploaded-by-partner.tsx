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
  other: 'документ',
};

export type ManagerDocumentUploadedByPartnerProps = {
  partnerName: string;
  orderNumber: string;
  documentName: string;
  documentType: string;
  orderUrl: string;
};

export function ManagerDocumentUploadedByPartner(props: ManagerDocumentUploadedByPartnerProps) {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return (
    <EmailLayout title="Документ от партнёра">
      <p style={emailStyles.paragraph}>
        Партнёр <strong>{props.partnerName}</strong> загрузил {typeLabel}{' '}
        <strong>«{props.documentName}»</strong> к заказу <strong>№ {props.orderNumber}</strong>.
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

export function managerDocumentUploadedByPartnerSubject(
  props: ManagerDocumentUploadedByPartnerProps
): string {
  return `${props.partnerName} загрузил документ ${props.documentName} к заказу № ${props.orderNumber}`;
}

export function managerDocumentUploadedByPartnerText(
  props: ManagerDocumentUploadedByPartnerProps
): string {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return [
    `Партнёр ${props.partnerName} загрузил ${typeLabel} «${props.documentName}» к заказу № ${props.orderNumber}.`,
    '',
    `Открыть заказ: ${props.orderUrl}`,
  ].join('\n');
}
