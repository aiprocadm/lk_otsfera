import { Prisma, type PrismaClient } from '@prisma/client';
import {
  sendPartnerDocumentPublishedEmail,
  sendCommissionReadyEmail,
  type SendResult
} from '@/lib/email/send';
import { getAppBaseUrl, orderLabel } from './shared';

/**
 * Fan-out to all active users of a partner (in-app + best-effort email).
 * Mirrors notifyOrgUsers; the Notification row carries `partnerId` (the
 * Partner.notifications relation already exists). Partner has no per-order
 * route, so the deep link targets the portfolio.
 */

export type PartnerNotifyInput =
  | {
      partnerId: string;
      type: 'document_published';
      payload: {
        orderId: string | null;
        orderNumber: string | null;
        orderTitle: string | null;
        documentName: string;
        documentType: string;
      };
    }
  | {
      partnerId: string;
      type: 'commission_statement_ready';
      payload: {
        statementId: string;
        period: string; // e.g. "май 2026"
        amount: string; // already formatted, e.g. "125 000 ₽"
      };
    }
  | {
      partnerId: string;
      type: 'lead_status_changed';
      payload: {
        leadId: string;
        clientCompanyName: string;
        subject: string;
        status: string; // human-readable RU status label
      };
    };

/**
 * Per-type presentation: in-app title/body, deep link, persisted meta, and an
 * optional email dispatcher. Keeps the fan-out loop type-agnostic; adding a new
 * partner notification type means adding a branch here only. `sendEmail` is
 * optional — some types are in-app only (no email template).
 */
type PartnerNotificationView = {
  title: string;
  body: string;
  url: string;
  meta: Prisma.InputJsonValue;
  sendEmail?: (to: string, partnerName: string) => Promise<SendResult>;
};

function partnerNotificationView(
  input: PartnerNotifyInput,
  partnerName: string
): PartnerNotificationView {
  if (input.type === 'lead_status_changed') {
    // S5: lead status transparency — in-app only (no email template).
    const url = `${getAppBaseUrl()}/partner/leads/${input.payload.leadId}`;
    return {
      title: 'Статус заявки изменён',
      body: `Заявка «${input.payload.clientCompanyName} — ${input.payload.subject}»: ${input.payload.status}.`,
      url,
      meta: { ...input.payload, partnerName, url }
    };
  }

  if (input.type === 'commission_statement_ready') {
    const url = `${getAppBaseUrl()}/partner/finance`;
    return {
      title: 'Отчёт по комиссии готов',
      body: `Ваш отчёт по комиссии за ${input.payload.period} готов к просмотру. Итог: ${input.payload.amount}.`,
      url,
      meta: { ...input.payload, partnerName, url },
      sendEmail: (to) =>
        sendCommissionReadyEmail({
          to,
          partnerName,
          period: input.payload.period,
          amount: input.payload.amount,
          url
        })
    };
  }

  // document_published
  const url =
    input.payload.orderId === null
      ? `${getAppBaseUrl()}/partner/documents?tab=general`
      : `${getAppBaseUrl()}/partner/portfolio`;
  const label = orderLabel(input.payload.orderNumber, input.payload.orderTitle);
  const title =
    input.payload.orderId === null
      ? 'Новый общий документ'
      : `Новый документ по заказу ${label}`;
  const body = `Загружен документ «${input.payload.documentName}» (${input.payload.documentType}).`;
  const docPayload = input.payload;
  return {
    title,
    body,
    url,
    meta: { ...input.payload, partnerName, url },
    sendEmail: (to) =>
      sendPartnerDocumentPublishedEmail({
        to,
        partnerName,
        orderNumber: docPayload.orderNumber,
        orderTitle: docPayload.orderTitle,
        documentName: docPayload.documentName,
        documentType: docPayload.documentType,
        orderUrl: url
      })
  };
}

export type NotifyPartnerSummary = {
  recipientsNotified: number;
  emailsSent: number;
  emailsSkipped: number;
};

export async function notifyPartnerUsers(
  db: PrismaClient,
  input: PartnerNotifyInput
): Promise<NotifyPartnerSummary> {
  const partner = await db.partner.findUnique({
    where: { id: input.partnerId },
    select: {
      id: true,
      name: true,
      partnerUsers: {
        where: { isActive: true, user: { isActive: true } },
        select: { user: { select: { id: true, email: true } } }
      }
    }
  });
  if (!partner) return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };

  const view = partnerNotificationView(input, partner.name);

  let emailsSent = 0;
  let emailsSkipped = 0;
  let recipientsNotified = 0;

  for (const pu of partner.partnerUsers) {
    const u = pu.user;
    await db.notification.create({
      data: {
        userId: u.id,
        partnerId: partner.id,
        type: input.type,
        title: view.title,
        body: view.body,
        meta: view.meta
      }
    });
    recipientsNotified += 1;

    if (u.email && view.sendEmail) {
      try {
        const r = await view.sendEmail(u.email, partner.name);
        if (r.status === 'sent') emailsSent += 1;
        else emailsSkipped += 1;
      } catch (err) {
        emailsSkipped += 1;
        console.warn('[notifyPartnerUsers] email dispatch failed', {
          partnerId: partner.id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    } else {
      emailsSkipped += 1;
    }
  }

  return { recipientsNotified, emailsSent, emailsSkipped };
}
