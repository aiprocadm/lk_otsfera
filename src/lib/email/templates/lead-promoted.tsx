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
    <EmailLayout title="Заявка превратилась в сделку">
      <p style={emailStyles.paragraph}>Здравствуйте, {partnerName}!</p>
      <p style={emailStyles.paragraph}>
        Ваша заявка <strong>«{leadSubject}»</strong> превратилась в сделку{' '}
        <strong>{orderNumber}</strong>. Можно отслеживать прогресс в кабинете.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={url} style={emailStyles.button}>
          Открыть сделку
        </a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{url}</span>
      </p>
    </EmailLayout>
  );
}

export function leadPromotedSubject(orderNumber: string): string {
  return `Заявка стала сделкой ${orderNumber}`;
}

export function leadPromotedText({ partnerName, leadSubject, orderNumber, url }: LeadPromotedProps): string {
  return [
    `Здравствуйте, ${partnerName}!`,
    '',
    `Ваша заявка «${leadSubject}» превратилась в сделку ${orderNumber}.`,
    '',
    `Открыть: ${url}`,
  ].join('\n');
}
