import { Prisma, type PrismaClient } from '@prisma/client';
import { sendPartnerDocumentPublishedEmail } from '@/lib/email/send';
import { getAppBaseUrl, orderLabel } from './shared';

/**
 * Fan-out to all active users of a partner (in-app + best-effort email).
 * Mirrors notifyOrgUsers; the Notification row carries `partnerId` (the
 * Partner.notifications relation already exists). Partner has no per-order
 * route, so the deep link targets the portfolio.
 */

export type PartnerNotifyInput = {
  partnerId: string;
  type: 'document_published';
  payload: {
    orderId: string;
    orderNumber: string | null;
    orderTitle: string;
    documentName: string;
    documentType: string;
  };
};

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
      users: { where: { isActive: true }, select: { id: true, email: true } }
    }
  });
  if (!partner) return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };

  const orderUrl = `${getAppBaseUrl()}/partner/portfolio`;
  const label = orderLabel(input.payload.orderNumber, input.payload.orderTitle);
  const title = `Новый документ по заказу ${label}`;
  const body = `Загружен документ «${input.payload.documentName}» (${input.payload.documentType}).`;
  const meta = { ...input.payload, partnerName: partner.name, url: orderUrl };

  let emailsSent = 0;
  let emailsSkipped = 0;
  let recipientsNotified = 0;

  for (const u of partner.users) {
    await db.notification.create({
      data: {
        userId: u.id,
        partnerId: partner.id,
        type: input.type,
        title,
        body,
        meta: meta as Prisma.InputJsonValue
      }
    });
    recipientsNotified += 1;

    if (u.email) {
      try {
        const r = await sendPartnerDocumentPublishedEmail({
          to: u.email,
          partnerName: partner.name,
          orderNumber: input.payload.orderNumber ?? input.payload.orderTitle,
          orderTitle: input.payload.orderTitle,
          documentName: input.payload.documentName,
          documentType: input.payload.documentType,
          orderUrl
        });
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
