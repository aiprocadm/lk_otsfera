import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

/**
 * `У-149` — сотрудник отправляет готовый документ заказчику письмом.
 *
 * Отличается от `document-published` не оформлением, а поводом: то письмо
 * сообщает «в кабинете появился документ» и уходит само при выпуске, это —
 * осознанное действие сотрудника, к которому **приложен сам PDF**. Поэтому и
 * шаблон отдельный: администратор правит два повода по отдельности (`У-128`),
 * а не один текст на оба случая.
 */

const DOC_TYPE_LABELS: Record<string, string> = {
  contract: 'договор',
  extra_agreement: 'доп. соглашение',
  invoice: 'счёт',
  act: 'акт',
  commercial_proposal: 'коммерческое предложение',
  waybill: 'накладная',
  certificate: 'сертификат',
  report: 'отчёт',
  commission_statement: 'расчёт комиссии',
  other: 'документ',
};

export type OrgDocumentSentProps = {
  organizationName: string;
  documentType: string;
  documentNumber: string | null;
  documentName: string;
  /** Ссылка на карточку документа в кабинете заказчика. */
  documentUrl: string;
  orderNumber: string | null;
  orderTitle: string | null;
};

/** «Счёт № С-2026-17» или, если номера нет, название файла. */
function docLabel(props: OrgDocumentSentProps): string {
  const type = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  const capitalized = type.charAt(0).toUpperCase() + type.slice(1);
  return props.documentNumber ? `${capitalized} № ${props.documentNumber}` : capitalized;
}

function orderLabel(props: OrgDocumentSentProps): string | null {
  if (props.orderNumber) return `№ ${props.orderNumber}`;
  if (props.orderTitle) return `«${props.orderTitle}»`;
  return null;
}

export function OrgDocumentSentTemplate(props: OrgDocumentSentProps) {
  const label = docLabel(props);
  const order = orderLabel(props);

  return (
    <EmailLayout title={label}>
      <p style={emailStyles.paragraph}>
        Здравствуйте! Направляем вам <strong>{label.toLowerCase()}</strong>
        {order ? (
          <>
            {' '}
            по заказу <strong>{order}</strong>
          </>
        ) : null}{' '}
        для «{props.organizationName}». Файл приложен к письму.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={props.documentUrl} style={emailStyles.button}>
          Открыть в личном кабинете
        </a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{props.documentUrl}</span>
      </p>
    </EmailLayout>
  );
}

export function orgDocumentSentSubject(props: OrgDocumentSentProps): string {
  const order = orderLabel(props);
  return order ? `${docLabel(props)} по заказу ${order}` : docLabel(props);
}

export function orgDocumentSentText(props: OrgDocumentSentProps): string {
  const order = orderLabel(props);
  return [
    `Здравствуйте! Направляем вам ${docLabel(props).toLowerCase()}${
      order ? ` по заказу ${order}` : ''
    } для «${props.organizationName}». Файл приложен к письму.`,
    '',
    `Открыть в личном кабинете: ${props.documentUrl}`,
  ].join('\n');
}
