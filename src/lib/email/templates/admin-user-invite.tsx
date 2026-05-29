import * as React from 'react';
import { EmailLayout, emailStyles } from './layout';

export type AdminUserInviteProps = {
  inviteUrl: string;
  name: string;
  role: 'organization' | 'partner' | 'manager' | 'student';
  invitedByName?: string;
};

const ROLE_LABELS: Record<AdminUserInviteProps['role'], string> = {
  organization: 'кабинету организации',
  partner: 'партнёрскому кабинету',
  manager: 'кабинету менеджера',
  student: 'учебному порталу',
};

export function AdminUserInviteTemplate({
  inviteUrl,
  name,
  role,
  invitedByName,
}: AdminUserInviteProps) {
  const roleLabel = ROLE_LABELS[role];
  return (
    <EmailLayout title='Приглашение в кабинет Промтехносферы'>
      <p style={emailStyles.paragraph}>Здравствуйте, {name}!</p>
      <p style={emailStyles.paragraph}>
        {invitedByName ? `${invitedByName} пригласил вас` : 'Вас пригласили'} к {roleLabel} Промтехносферы.
      </p>
      <p style={emailStyles.paragraph}>Установите пароль, чтобы войти:</p>
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
      <p style={emailStyles.muted}>Ссылка действительна 7 дней.</p>
    </EmailLayout>
  );
}

export function adminUserInviteSubject(): string {
  return 'Приглашение в кабинет Промтехносферы';
}

export function adminUserInviteText({
  name,
  role,
  inviteUrl,
  invitedByName,
}: AdminUserInviteProps): string {
  const roleLabel = ROLE_LABELS[role];
  const intro = invitedByName
    ? `${invitedByName} пригласил вас`
    : 'Вас пригласили';
  return [
    `Здравствуйте, ${name}!`,
    '',
    `${intro} к ${roleLabel} Промтехносферы.`,
    '',
    `Установить пароль: ${inviteUrl}`,
    '',
    'Ссылка действительна 7 дней.',
  ].join('\n');
}
