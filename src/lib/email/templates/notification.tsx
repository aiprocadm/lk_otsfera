import * as React from 'react';
import { EmailLayout, emailStyles } from './layout';

export type NotificationProps = {
  recipientName: string;
  title: string;
  body: string;
  url?: string;
};

/**
 * Generic fallback for `triggerNotificationEmail({ title, body })` call sites
 * that don't yet carry structured data. Keeps the email pipeline useful even
 * without per-event templates.
 */
export function NotificationTemplate({ recipientName, title, body, url }: NotificationProps) {
  return (
    <EmailLayout title={title}>
      <p style={emailStyles.paragraph}>Здравствуйте, {recipientName}!</p>
      <p style={emailStyles.paragraph}>{body}</p>
      {url ? (
        <p style={emailStyles.paragraph}>
          <a href={url} style={emailStyles.button}>
            Открыть кабинет
          </a>
        </p>
      ) : null}
      {url ? (
        <p style={emailStyles.muted}>
          <span style={emailStyles.mono}>{url}</span>
        </p>
      ) : null}
    </EmailLayout>
  );
}

export function notificationText({ recipientName, body, url }: NotificationProps): string {
  const lines = [`Здравствуйте, ${recipientName}!`, '', body];
  if (url) lines.push('', `Открыть: ${url}`);
  return lines.join('\n');
}
