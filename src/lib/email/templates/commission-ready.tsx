import * as React from 'react';
import { EmailLayout, emailStyles } from './layout';

export type CommissionReadyProps = {
  partnerName: string;
  period: string;
  amount: string;
  url: string;
};

export function CommissionReadyTemplate({ partnerName, period, amount, url }: CommissionReadyProps) {
  return (
    <EmailLayout title="Отчёт по комиссии готов">
      <p style={emailStyles.paragraph}>Здравствуйте, {partnerName}!</p>
      <p style={emailStyles.paragraph}>
        Ваш отчёт по комиссии за <strong>{period}</strong> готов к просмотру.
        Итоговая сумма к выплате — <strong>{amount}</strong>.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={url} style={emailStyles.button}>
          Открыть отчёт
        </a>
      </p>
      <p style={emailStyles.muted}>
        Если кнопка не работает, скопируйте ссылку в браузер:
        <br />
        <span style={emailStyles.mono}>{url}</span>
      </p>
    </EmailLayout>
  );
}

export function commissionReadySubject(period: string): string {
  return `Отчёт по комиссии за ${period} готов`;
}

export function commissionReadyText({ partnerName, period, amount, url }: CommissionReadyProps): string {
  return [
    `Здравствуйте, ${partnerName}!`,
    '',
    `Ваш отчёт по комиссии за ${period} готов. Итог: ${amount}.`,
    '',
    `Открыть: ${url}`,
  ].join('\n');
}
