import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

export type PartnerInviteProps = {
  partnerName: string;
  /** Русская подпись роли в команде («администратор» | «менеджер»). */
  roleLabel: string;
  inviteUrl: string;
  invitedByName?: string;
  /** Срок действия ссылки в днях (ФТ-10.1); дефолт — TTL инвайт-токена. */
  expiresInDays?: number;
};

export function PartnerInviteTemplate({
  partnerName,
  roleLabel,
  inviteUrl,
  invitedByName,
  expiresInDays = 7
}: PartnerInviteProps) {
  return (
    <EmailLayout title='Приглашение в кабинет партнёра'>
      <p style={emailStyles.paragraph}>Здравствуйте!</p>
      <p style={emailStyles.paragraph}>
        {invitedByName ? <>{invitedByName} приглашает вас </> : 'Вас приглашают '}
        в команду партнёра <strong>{partnerName}</strong> на платформе
        «Промтехносфера» (роль: {roleLabel}).
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
        Ссылка действует {expiresInDays} дн. Если кнопка не работает, скопируйте
        ссылку в адресную строку браузера:
        <br />
        <span style={emailStyles.mono}>{inviteUrl}</span>
      </p>
    </EmailLayout>
  );
}

export function partnerInviteSubject(partnerName: string): string {
  return `Приглашение в команду «${partnerName}»`;
}

export function partnerInviteText({
  partnerName,
  roleLabel,
  inviteUrl,
  invitedByName,
  expiresInDays = 7
}: PartnerInviteProps): string {
  const intro = invitedByName ? `${invitedByName} приглашает вас` : 'Вас приглашают';
  return [
    'Здравствуйте!',
    '',
    `${intro} в команду партнёра «${partnerName}» на платформе Промтехносфера (роль: ${roleLabel}).`,
    '',
    `Установить пароль: ${inviteUrl}`,
    `Ссылка действует ${expiresInDays} дн.`
  ].join('\n');
}
