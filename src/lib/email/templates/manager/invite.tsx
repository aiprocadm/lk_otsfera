import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

export type ManagerInviteProps = {
  organizationName: string;
  inviteUrl: string;
  invitedByName?: string | undefined;
};

export function ManagerInviteTemplate({
  organizationName,
  inviteUrl,
  invitedByName,
}: ManagerInviteProps) {
  return (
    <EmailLayout title="Приглашение в кабинет менеджера">
      <p style={emailStyles.paragraph}>Здравствуйте!</p>
      <p style={emailStyles.paragraph}>
        {invitedByName ? <>{invitedByName} приглашает вас </> : 'Вас приглашают '}в кабинет
        менеджера платформы «Промтехносфера». Вам назначена организация{' '}
        <strong>{organizationName}</strong>.
      </p>
      <p style={emailStyles.paragraph}>
        Чтобы установить пароль и начать работу, перейдите по ссылке ниже:
      </p>
      <p style={emailStyles.paragraph}>
        <a href={inviteUrl} style={emailStyles.button}>
          Установить пароль
        </a>
      </p>
      <p style={emailStyles.muted}>
        Если кнопка не работает, скопируйте ссылку в адресную строку браузера:
        <br />
        <span style={emailStyles.mono}>{inviteUrl}</span>
      </p>
    </EmailLayout>
  );
}

export function managerInviteSubject(organizationName: string): string {
  return `Приглашение в кабинет менеджера «${organizationName}»`;
}

export function managerInviteText({
  organizationName,
  inviteUrl,
  invitedByName,
}: ManagerInviteProps): string {
  const intro = invitedByName ? `${invitedByName} приглашает вас` : 'Вас приглашают';
  return [
    'Здравствуйте!',
    '',
    `${intro} в кабинет менеджера платформы «Промтехносфера». Назначена организация «${organizationName}».`,
    '',
    `Установить пароль: ${inviteUrl}`,
  ].join('\n');
}
