import { Prisma, type PrismaClient } from '@prisma/client';
import { dispatchToRecipient } from './channels/dispatch';
import { CHANNEL_RECIPIENT_SELECT, type ChannelPayload, type EmailContentRef } from './channels/types';
import { getAppBaseUrl, orderLabel } from './shared';

type OrgNotifyInput =
  | {
      organizationId: string;
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
      organizationId: string;
      type: 'payment_received';
      payload: {
        orderId: string;
        orderNumber: string | null;
        orderTitle: string;
        amount: string;
        paidAt: Date;
      };
    }
  | {
      organizationId: string;
      type: 'order_status_changed';
      payload: {
        orderId: string;
        orderNumber: string | null;
        orderTitle: string;
        dimension: 'execution' | 'financial';
        oldStatus: string;
        newStatus: string;
      };
    }
  | {
      organizationId: string;
      type: 'manager_replied';
      payload: {
        orderId: string;
        orderNumber: string | null;
        orderTitle: string;
        commentExcerpt: string;
      };
    }
  | {
      organizationId: string;
      type: 'chat_message';
      payload: {
        orderId: string;
        orderNumber: string | null;
        orderTitle: string;
        excerpt: string;
      };
    };

export type NotifyOrgUsersSummary = {
  recipientsNotified: number;
  emailsSent: number;
  emailsSkipped: number;
  /** D5: email-каналы, поставленные в очередь (только при notif_queue). */
  emailsQueued?: number;
};

function buildOrgNotification(
  input: OrgNotifyInput,
  organizationName: string,
  orderUrl: string
): { title: string; body: string; meta: Record<string, unknown> } {
  if (input.type === 'document_published') {
    const { orderId: docOrderId, orderNumber, orderTitle, documentName, documentType } = input.payload;
    const title = docOrderId === null
      ? 'Новый общий документ'
      : `Новый документ по заказу ${orderLabel(orderNumber, orderTitle)}`;
    return {
      title,
      body: `Загружен документ «${documentName}» (${documentType}).`,
      meta: {
        orderId: docOrderId,
        orderNumber,
        documentName,
        documentType,
        organizationName,
        url: orderUrl
      }
    };
  }
  if (input.type === 'payment_received') {
    const { orderNumber, orderTitle, amount, paidAt } = input.payload;
    return {
      title: `Оплата по заказу ${orderLabel(orderNumber, orderTitle)}`,
      body: `Получена оплата ${amount} ₽.`,
      meta: {
        orderId: input.payload.orderId,
        orderNumber,
        amount,
        paidAt: paidAt.toISOString(),
        organizationName,
        url: orderUrl
      }
    };
  }
  if (input.type === 'manager_replied') {
    const { orderNumber, orderTitle, commentExcerpt } = input.payload;
    return {
      title: `Менеджер ответил по заказу ${orderLabel(orderNumber, orderTitle)}`,
      body: commentExcerpt,
      meta: {
        orderId: input.payload.orderId,
        orderNumber,
        commentExcerpt,
        organizationName,
        url: orderUrl
      }
    };
  }
  if (input.type === 'chat_message') {
    const { orderNumber, orderTitle, excerpt } = input.payload;
    return {
      title: `Новое сообщение по заказу ${orderLabel(orderNumber, orderTitle)}`,
      body: excerpt,
      meta: {
        orderId: input.payload.orderId,
        orderNumber,
        excerpt,
        organizationName,
        url: orderUrl
      }
    };
  }
  // order_status_changed
  const { orderNumber, orderTitle, dimension, oldStatus, newStatus } = input.payload;
  const dimLabel = dimension === 'execution' ? 'Статус' : 'Финансы';
  return {
    title: `${dimLabel} заказа ${orderLabel(orderNumber, orderTitle)} изменён`,
    body: `${oldStatus} → ${newStatus}.`,
    meta: {
      orderId: input.payload.orderId,
      orderNumber,
      dimension,
      oldStatus,
      newStatus,
      organizationName,
      url: orderUrl
    }
  };
}

/**
 * Сериализуемая ссылка на email-шаблон события (D1). Раньше здесь была
 * функция-отправитель (`dispatchOrgEmail`) — теперь только выбор шаблона и
 * props, а отправку делает email-канал (те же sender-функции send.tsx).
 */
function buildOrgEmailRef(
  input: OrgNotifyInput,
  organizationName: string,
  orderUrl: string
): EmailContentRef {
  if (input.type === 'document_published') {
    return {
      template: 'orgDocumentPublished',
      props: {
        organizationName,
        orderNumber: input.payload.orderNumber,
        orderTitle: input.payload.orderTitle,
        documentName: input.payload.documentName,
        documentType: input.payload.documentType,
        orderUrl
      }
    };
  }
  if (input.type === 'payment_received') {
    return {
      template: 'orgPaymentReceived',
      props: {
        organizationName,
        orderNumber: input.payload.orderNumber,
        orderTitle: input.payload.orderTitle,
        amount: input.payload.amount,
        paidAt: input.payload.paidAt,
        orderUrl
      }
    };
  }
  if (input.type === 'manager_replied') {
    return {
      template: 'orgManagerReplied',
      props: {
        organizationName,
        orderNumber: input.payload.orderNumber,
        orderTitle: input.payload.orderTitle,
        commentExcerpt: input.payload.commentExcerpt,
        orderUrl
      }
    };
  }
  if (input.type === 'chat_message') {
    const { orderNumber, orderTitle, excerpt } = input.payload;
    const label = orderLabel(orderNumber, orderTitle);
    return {
      template: 'notification',
      props: {
        title: `Новое сообщение по заказу ${label}`,
        body: excerpt,
        recipientName: organizationName,
        url: orderUrl
      }
    };
  }
  return {
    template: 'orgOrderStatusChanged',
    props: {
      organizationName,
      orderNumber: input.payload.orderNumber,
      orderTitle: input.payload.orderTitle,
      dimension: input.payload.dimension,
      oldStatus: input.payload.oldStatus,
      newStatus: input.payload.newStatus,
      orderUrl
    }
  };
}

/**
 * Fan-out notification to all active members of an organization.
 *
 * Always creates in-app Notification rows. Доставка по внешним каналам —
 * через канальный слой (`deliverToRecipient`, D1): email best-effort (когда
 * Resend-пайплайн выключен, канал возвращает `skipped`), Telegram — при
 * привязке. Функция по-прежнему считает recipients notified по in-app
 * строкам (bell counter — источник истины, не inbox).
 */
export async function notifyOrgUsers(
  db: PrismaClient,
  input: OrgNotifyInput
): Promise<NotifyOrgUsersSummary> {
  const org = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: {
      id: true,
      name: true,
      organizationUsers: {
        where: { isActive: true, user: { isActive: true } },
        select: {
          user: { select: CHANNEL_RECIPIENT_SELECT }
        }
      }
    }
  });

  if (!org) {
    return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };
  }

  const orderUrl = input.payload.orderId === null
    ? `${getAppBaseUrl()}/organization/documents?tab=general`
    : `${getAppBaseUrl()}/organization/orders/${input.payload.orderId}`;
  const { title, body, meta } = buildOrgNotification(input, org.name, orderUrl);
  const channelPayload: ChannelPayload = {
    type: input.type,
    title,
    body,
    url: orderUrl,
    email: buildOrgEmailRef(input, org.name, orderUrl)
  };

  let emailsSent = 0;
  let emailsSkipped = 0;
  let emailsQueued = 0;
  let recipientsNotified = 0;

  for (const member of org.organizationUsers) {
    const row = await db.notification.create({
      data: {
        userId: member.user.id,
        organizationId: org.id,
        type: input.type,
        title,
        body,
        meta: meta as Prisma.InputJsonValue
      }
    });
    recipientsNotified += 1;

    // Best-effort: канальный слой изолирует ошибки per-channel — сбой одного
    // получателя/канала не прерывает fan-out (in-app строки — источник истины).
    const outcome = await dispatchToRecipient(member.user, channelPayload, { dedupKey: row.id });
    if (outcome.mode === 'queued') {
      if (outcome.channels.includes('email')) emailsQueued += 1;
      else emailsSkipped += 1;
      continue;
    }
    if (outcome.results.email?.status === 'sent') {
      emailsSent += 1;
    } else {
      emailsSkipped += 1;
    }
    if (outcome.results.email?.status === 'failed') {
      console.warn('[notifyOrgUsers] email dispatch failed', {
        organizationId: org.id,
        error: outcome.results.email.reason,
      });
    }
  }

  return {
    recipientsNotified,
    emailsSent,
    emailsSkipped,
    ...(emailsQueued > 0 ? { emailsQueued } : {})
  };
}
