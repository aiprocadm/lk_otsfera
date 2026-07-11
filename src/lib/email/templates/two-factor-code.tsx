import * as React from 'react';
import { EmailLayout, emailStyles } from './layout';

export type TwoFactorCodeProps = {
  name: string;
  code: string;
};

// Код НЕ выносится в subject: тема письма видна на лок-скрине уведомления.
export function TwoFactorCodeTemplate({ name, code }: TwoFactorCodeProps) {
  return (
    <EmailLayout title="Код подтверждения входа">
      <p style={emailStyles.paragraph}>Здравствуйте, {name}!</p>
      <p style={emailStyles.paragraph}>Ваш код подтверждения входа в кабинет:</p>
      <p style={{ ...emailStyles.paragraph, fontSize: 28, fontWeight: 700, letterSpacing: 6 }}>
        <span style={emailStyles.mono}>{code}</span>
      </p>
      <p style={emailStyles.muted}>
        Код действует 10 минут. Если вы не входили в кабинет — смените пароль:
        запрос кода означает, что ваш пароль знает кто-то ещё.
      </p>
    </EmailLayout>
  );
}

export function twoFactorCodeSubject(): string {
  return 'Код подтверждения входа';
}

export function twoFactorCodeText({ name, code }: TwoFactorCodeProps): string {
  return [
    `Здравствуйте, ${name}!`,
    '',
    `Ваш код подтверждения входа: ${code}`,
    '',
    'Код действует 10 минут. Если вы не входили в кабинет — смените пароль.'
  ].join('\n');
}
