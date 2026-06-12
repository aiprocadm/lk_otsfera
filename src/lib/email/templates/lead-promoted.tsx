import * as React from 'react';
import { EmailLayout, emailStyles } from './layout';

export type LeadPromotedProps = {
  partnerName: string;
  leadSubject: string;
  orderNumber: string;
  url: string;
};

export function LeadPromotedTemplate({ partnerName, leadSubject, orderNumber, url }: LeadPromotedProps) {
  return (
    <EmailLayout title="Заявка стала заказом">
      <p style={emailStyles.paragraph}>Здравствуйте, {partnerName}!</p>
      <p style={emailStyles.paragraph}>
        Ваша заявка <strong>«{leadSubject}»</strong> стала заказом{' '}
        <strong>{orderNumber}</strong>. Можно отслеживать прогресс в кабинете.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={url} style={emailStyles.button}>
          Открыть заказ
        </a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{url}</span>
      </p>
    </EmailLayout>
  );
}

export function leadPromotedSubject(orderNumber: string): string {
  return `Заявка стала заказом ${orderNumber}`;
}

export function leadPromotedText({ partnerName, leadSubject, orderNumber, url }: LeadPromotedProps): string {
  return [
    `Здравствуйте, ${partnerName}!`,
    '',
    `Ваша заявка «${leadSubject}» стала заказом ${orderNumber}.`,
    '',
    `Открыть: ${url}`,
  ].join('\n');
}
