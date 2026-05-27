import * as React from 'react';
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
  OrgDocumentPublishedTemplate,
  orgDocumentPublishedSubject,
  orgDocumentPublishedText,
  OrgInviteTemplate,
  orgInviteSubject,
  orgInviteText,
  OrgOrderStatusChangedTemplate,
  orgOrderStatusChangedSubject,
  orgOrderStatusChangedText,
  OrgPaymentReceivedTemplate,
  orgPaymentReceivedSubject,
  orgPaymentReceivedText,
  OrgManagerRepliedTemplate,
  orgManagerRepliedSubject,
  orgManagerRepliedText,
  ManagerCommentFromOrg,
  managerCommentFromOrgSubject,
  managerCommentFromOrgText,
  ManagerDocumentUploadedByOrg,
  managerDocumentUploadedByOrgSubject,
  managerDocumentUploadedByOrgText,
  ManagerOrderMarkedPaidBy1C,
  managerOrderMarkedPaidBy1CSubject,
  managerOrderMarkedPaidBy1CText,
  ManagerOrderStatusChanged,
  managerOrderStatusChangedSubject,
  managerOrderStatusChangedText,
  ManagerInviteTemplate,
  managerInviteSubject,
  managerInviteText,
  type CommissionReadyProps,
  type DocumentUploadedProps,
  type LeadPromotedProps,
  type NotificationProps,
  type OrgDocumentPublishedProps,
  type OrgInviteProps,
  type OrgOrderStatusChangedProps,
  type OrgPaymentReceivedProps,
  type OrgManagerRepliedProps,
  type ManagerCommentFromOrgProps,
  type ManagerDocumentUploadedByOrgProps,
  type ManagerOrderMarkedPaidBy1CProps,
  type ManagerOrderStatusChangedProps,
  type ManagerInviteProps,
} from './templates';

export type SendOptions = {
  /** Override the configured transport — primarily for tests. */
  transport?: EmailTransport | null;
};

export type SendResult =
  | { status: 'sent'; id: string | null }
  | { status: 'skipped'; reason: 'disabled' | 'no-api-key' | 'no-recipient' };

/**
 * Dynamic import keeps `react-dom/server` out of the static module graph.
 * Next.js disallows importing it from non-RSC server modules at build time,
 * so we defer the resolve until first send.
 */
async function renderHtml(element: React.ReactElement): Promise<string> {
  const mod = await import('react-dom/server');
  return `<!DOCTYPE html>\n${mod.renderToStaticMarkup(element)}`;
}

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
      html: await renderHtml(<NotificationTemplate {...props} />),
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
      html: await renderHtml(<CommissionReadyTemplate {...props} />),
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
      html: await renderHtml(<LeadPromotedTemplate {...props} />),
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
      html: await renderHtml(<DocumentUploadedTemplate {...props} />),
      text: documentUploadedText(props),
    },
    options,
  );
}

export async function sendOrgInviteEmail(
  args: { to: string } & OrgInviteProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: orgInviteSubject(props.organizationName),
      html: await renderHtml(<OrgInviteTemplate {...props} />),
      text: orgInviteText(props),
    },
    options,
  );
}

export async function sendOrgDocumentPublishedEmail(
  args: { to: string } & OrgDocumentPublishedProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: orgDocumentPublishedSubject(props),
      html: await renderHtml(<OrgDocumentPublishedTemplate {...props} />),
      text: orgDocumentPublishedText(props),
    },
    options,
  );
}

export async function sendOrgPaymentReceivedEmail(
  args: { to: string } & OrgPaymentReceivedProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: orgPaymentReceivedSubject(props),
      html: await renderHtml(<OrgPaymentReceivedTemplate {...props} />),
      text: orgPaymentReceivedText(props),
    },
    options,
  );
}

export async function sendOrgOrderStatusChangedEmail(
  args: { to: string } & OrgOrderStatusChangedProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: orgOrderStatusChangedSubject(props),
      html: await renderHtml(<OrgOrderStatusChangedTemplate {...props} />),
      text: orgOrderStatusChangedText(props),
    },
    options,
  );
}

export async function sendOrgManagerRepliedEmail(
  args: { to: string } & OrgManagerRepliedProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: orgManagerRepliedSubject(props),
      html: await renderHtml(<OrgManagerRepliedTemplate {...props} />),
      text: orgManagerRepliedText(props),
    },
    options,
  );
}

export async function sendManagerCommentFromOrgEmail(
  args: { to: string } & ManagerCommentFromOrgProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: managerCommentFromOrgSubject(props),
      html: await renderHtml(<ManagerCommentFromOrg {...props} />),
      text: managerCommentFromOrgText(props),
    },
    options,
  );
}

export async function sendManagerDocumentUploadedByOrgEmail(
  args: { to: string } & ManagerDocumentUploadedByOrgProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: managerDocumentUploadedByOrgSubject(props),
      html: await renderHtml(<ManagerDocumentUploadedByOrg {...props} />),
      text: managerDocumentUploadedByOrgText(props),
    },
    options,
  );
}

export async function sendManagerOrderMarkedPaidBy1CEmail(
  args: { to: string } & ManagerOrderMarkedPaidBy1CProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: managerOrderMarkedPaidBy1CSubject(props),
      html: await renderHtml(<ManagerOrderMarkedPaidBy1C {...props} />),
      text: managerOrderMarkedPaidBy1CText(props),
    },
    options,
  );
}

export async function sendManagerOrderStatusChangedEmail(
  args: { to: string } & ManagerOrderStatusChangedProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: managerOrderStatusChangedSubject(props),
      html: await renderHtml(<ManagerOrderStatusChanged {...props} />),
      text: managerOrderStatusChangedText(props),
    },
    options,
  );
}

export async function sendManagerInviteEmail(
  args: { to: string } & ManagerInviteProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: managerInviteSubject(props.organizationName),
      html: await renderHtml(<ManagerInviteTemplate {...props} />),
      text: managerInviteText(props),
    },
    options,
  );
}
