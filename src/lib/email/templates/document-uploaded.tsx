import * as React from 'react';
import { EmailLayout, emailStyles } from './layout';

export type DocumentUploadedProps = {
  partnerName: string;
  orderNumber: string;
  filename: string;
  url: string;
};

export function DocumentUploadedTemplate({ partnerName, orderNumber, filename, url }: DocumentUploadedProps) {
  return (
    <EmailLayout title="Новый документ по сделке">
      <p style={emailStyles.paragraph}>Здравствуйте, {partnerName}!</p>
      <p style={emailStyles.paragraph}>
        На сделку <strong>{orderNumber}</strong> загружен документ{' '}
        <strong>«{filename}»</strong>.
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

export function documentUploadedSubject(orderNumber: string): string {
  return `Новый документ по сделке ${orderNumber}`;
}

export function documentUploadedText({ partnerName, orderNumber, filename, url }: DocumentUploadedProps): string {
  return [
    `Здравствуйте, ${partnerName}!`,
    '',
    `На сделку ${orderNumber} загружен документ «${filename}».`,
    '',
    `Открыть: ${url}`,
  ].join('\n');
}
