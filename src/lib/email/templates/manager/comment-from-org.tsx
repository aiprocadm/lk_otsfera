import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

export type ManagerCommentFromOrgProps = {
  orgName: string;
  orderNumber: string;
  commentExcerpt: string;
  orderUrl: string;
};

export function ManagerCommentFromOrg(props: ManagerCommentFromOrgProps) {
  return (
    <EmailLayout title='Новое сообщение по заказу'>
      <p style={emailStyles.paragraph}>
        Организация <strong>{props.orgName}</strong> оставила сообщение по
        заказу <strong>№ {props.orderNumber}</strong>:
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

export function managerCommentFromOrgSubject(props: ManagerCommentFromOrgProps): string {
  return `Новое сообщение от ${props.orgName} по заказу № ${props.orderNumber}`;
}

export function managerCommentFromOrgText(props: ManagerCommentFromOrgProps): string {
  return [
    `Организация ${props.orgName} оставила сообщение по заказу № ${props.orderNumber}:`,
    `«${props.commentExcerpt}»`,
    '',
    `Открыть заказ: ${props.orderUrl}`
  ].join('\n');
}
