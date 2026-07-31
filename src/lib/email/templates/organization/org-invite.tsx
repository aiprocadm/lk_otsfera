import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

export type OrgInviteProps = {
  organizationName: string;
  inviteUrl: string;
  invitedByName?: string;
};

export function OrgInviteTemplate({ organizationName, inviteUrl, invitedByName }: OrgInviteProps) {
  return (
    <EmailLayout title="Приглашение в кабинет организации">
      <p style={emailStyles.paragraph}>Здравствуйте!</p>
      <p style={emailStyles.paragraph}>
        {invitedByName ? <>{invitedByName} приглашает вас </> : 'Вас приглашают '}в личный кабинет
        организации <strong>{organizationName}</strong> на платформе «Промтехносфера».
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

export function orgInviteSubject(organizationName: string): string {
  return `Приглашение в кабинет «${organizationName}»`;
}

export function orgInviteText({
  organizationName,
  inviteUrl,
  invitedByName,
}: OrgInviteProps): string {
  const intro = invitedByName ? `${invitedByName} приглашает вас` : 'Вас приглашают';
  return [
    'Здравствуйте!',
    '',
    `${intro} в кабинет организации «${organizationName}» на платформе Промтехносфера.`,
    '',
    `Установить пароль: ${inviteUrl}`,
  ].join('\n');
}
