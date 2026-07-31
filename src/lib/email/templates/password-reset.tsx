import * as React from 'react';
import { EmailLayout, emailStyles } from './layout';

export type PasswordResetProps = {
  name: string;
  resetUrl: string;
};

export function PasswordResetTemplate({ name, resetUrl }: PasswordResetProps) {
  return (
    <EmailLayout title="Восстановление пароля">
      <p style={emailStyles.paragraph}>Здравствуйте, {name}!</p>
      <p style={emailStyles.paragraph}>
        Мы получили запрос на восстановление пароля для вашего аккаунта. Перейдите по ссылке ниже,
        чтобы установить новый пароль:
      </p>
      <p style={emailStyles.paragraph}>
        <a href={resetUrl} style={emailStyles.button}>
          Установить пароль
        </a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{resetUrl}</span>
      </p>
      <p style={emailStyles.muted}>
        Если вы не запрашивали восстановление пароля — просто проигнорируйте это письмо. Ваш пароль
        не изменится.
      </p>
    </EmailLayout>
  );
}

export function passwordResetSubject(): string {
  return 'Восстановление пароля';
}

export function passwordResetText({ name, resetUrl }: PasswordResetProps): string {
  return [
    `Здравствуйте, ${name}!`,
    '',
    'Мы получили запрос на восстановление пароля для вашего аккаунта.',
    'Перейдите по ссылке, чтобы установить новый пароль:',
    '',
    resetUrl,
    '',
    'Если вы не запрашивали восстановление пароля — просто проигнорируйте это письмо.',
  ].join('\n');
}
