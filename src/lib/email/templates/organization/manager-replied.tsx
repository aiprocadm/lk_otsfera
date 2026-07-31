import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

export type OrgManagerRepliedProps = {
  organizationName: string;
  orderNumber: string | null;
  orderTitle: string;
  commentExcerpt: string;
  orderUrl: string;
};

export function OrgManagerRepliedTemplate(props: OrgManagerRepliedProps) {
  const orderLabel = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;

  return (
    <EmailLayout title="Менеджер ответил по заказу">
      <p style={emailStyles.paragraph}>
        Менеджер оставил сообщение по заказу <strong>{orderLabel}</strong> ({props.organizationName}
        ):
      </p>
      <p style={emailStyles.paragraph}>
        <em>«{props.commentExcerpt}»</em>
      </p>
      <p style={emailStyles.paragraph}>
        <a href={props.orderUrl} style={emailStyles.button}>
          Открыть заказ
        </a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{props.orderUrl}</span>
      </p>
    </EmailLayout>
  );
}

export function orgManagerRepliedSubject(props: OrgManagerRepliedProps): string {
  const label = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;
  return `Менеджер ответил по заказу ${label}`;
}

export function orgManagerRepliedText(props: OrgManagerRepliedProps): string {
  const orderLabel = props.orderNumber ? `№ ${props.orderNumber}` : `«${props.orderTitle}»`;
  return [
    `Менеджер оставил сообщение по заказу ${orderLabel} (${props.organizationName}):`,
    `«${props.commentExcerpt}»`,
    '',
    `Открыть заказ: ${props.orderUrl}`,
  ].join('\n');
}
