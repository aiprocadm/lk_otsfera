import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  defaultTransport,
  getEmailFrom,
  isEmailEnabled,
  type EmailTransport,
} from './transport';
import {
  CommissionReadyTemplate,
  commissionReadySubject,
  commissionReadyText,
  DocumentUploadedTemplate,
  documentUploadedSubject,
  documentUploadedText,
  LeadPromotedTemplate,
  leadPromotedSubject,
  leadPromotedText,
  NotificationTemplate,
  notificationText,
  type CommissionReadyProps,
  type DocumentUploadedProps,
  type LeadPromotedProps,
  type NotificationProps,
} from './templates';

export type SendOptions = {
  /** Override the configured transport — primarily for tests. */
  transport?: EmailTransport | null;
};

export type SendResult =
  | { status: 'sent'; id: string | null }
  | { status: 'skipped'; reason: 'disabled' | 'no-api-key' | 'no-recipient' };

/**
 * Send a pre-rendered email. Returns `skipped` rather than throwing when the
 * pipeline is intentionally disabled — call sites already treat the email as
 * a best-effort side effect, so a thrown error would be a regression.
 */
export async function send(
  input: { to: string; subject: string; html: string; text?: string },
  options: SendOptions = {},
): Promise<SendResult> {
  if (!input.to) return { status: 'skipped', reason: 'no-recipient' };
  if (!isEmailEnabled()) return { status: 'skipped', reason: 'disabled' };

  const transport = options.transport ?? (await defaultTransport());
  if (!transport) {
    if (process.env.EMAIL_ENABLED?.trim().toLowerCase() === 'true') {
      console.warn('[email] EMAIL_ENABLED=true but RESEND_API_KEY is missing — skipping send');
    }
    return { status: 'skipped', reason: 'no-api-key' };
  }

  const result = await transport.send({
    from: getEmailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  return { status: 'sent', id: result.id };
}

export async function sendNotificationEmail(
  args: { to: string } & NotificationProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: props.title,
      html: renderHtml(<NotificationTemplate {...props} />),
      text: notificationText(props),
    },
    options,
  );
}

export async function sendCommissionReadyEmail(
  args: { to: string } & CommissionReadyProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: commissionReadySubject(props.period),
      html: renderHtml(<CommissionReadyTemplate {...props} />),
      text: commissionReadyText(props),
    },
    options,
  );
}

export async function sendLeadPromotedEmail(
  args: { to: string } & LeadPromotedProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: leadPromotedSubject(props.orderNumber),
      html: renderHtml(<LeadPromotedTemplate {...props} />),
      text: leadPromotedText(props),
    },
    options,
  );
}

export async function sendDocumentUploadedEmail(
  args: { to: string } & DocumentUploadedProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: documentUploadedSubject(props.orderNumber),
      html: renderHtml(<DocumentUploadedTemplate {...props} />),
      text: documentUploadedText(props),
    },
    options,
  );
}

function renderHtml(element: React.ReactElement): string {
  return `<!DOCTYPE html>\n${renderToStaticMarkup(element)}`;
}
