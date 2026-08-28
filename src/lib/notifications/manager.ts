import { type Prisma, type PrismaClient } from '@prisma/client';
import {
  managerCommentFromOrgSubject,
  managerCommentFromOrgText,
  managerDocumentUploadedByOrgSubject,
  managerDocumentUploadedByOrgText,
  managerDocumentUploadedByPartnerSubject,
  managerDocumentUploadedByPartnerText,
  managerOrderMarkedPaidBy1CSubject,
  managerOrderMarkedPaidBy1CText,
  managerOrderStatusChangedSubject,
  managerOrderStatusChangedText,
} from '@/lib/email/templates';
import { log } from '@/lib/logging';
import { dispatchToRecipient } from './channels/dispatch';
import {
  CHANNEL_RECIPIENT_SELECT,
  type ChannelPayload,
  type ChannelRecipient,
  type EmailContentRef,
} from './channels/types';
import { getAppBaseUrl, orderLabel } from './shared';
import { allowedChannels } from './routing';

type NotifyManagersType =
  | 'comment_from_org'
  | 'document_uploaded_by_org'
  | 'document_uploaded_by_partner'
  | 'order_marked_paid_by_1c'
  | 'order_status_changed_by_manager'
  | 'chat_message'
  | 'document_accepted';

export type NotifyManagersInput =
  | {
      orderId: string;
      type: 'comment_from_org';
      payload: {
        orgName: string;
        commentExcerpt: string;
      };
    }
  | {
      orderId: string;
      type: 'document_uploaded_by_org';
      payload: {
        orgName: string;
        documentName: string;
        documentType: string;
      };
    }
  | {
      orderId: string;
      type: 'document_uploaded_by_partner';
      payload: {
        partnerName: string;
        documentName: string;
        documentType: string;
      };
    }
  | {
      orderId: string;
      type: 'order_marked_paid_by_1c';
      payload: {
        amount: number;
        paidAt: Date;
      };
    }
  | {
      orderId: string;
      type: 'order_status_changed_by_manager';
      payload: {
        actorName: string;
        oldStatus: string;
        newStatus: string;
      };
    }
  | {
      orderId: string;
      type: 'chat_message';
      payload: {
        excerpt: string;
        side: string;
      };
    }
  | {
      // `У-150`: заказчик принял акт или договор — менеджер должен узнать
      // об этом сам, а не обнаружить при следующем открытии карточки.
      orderId: string;
      type: 'document_accepted';
      payload: {
        documentId: string;
        documentType: string;
        documentNumber: string | null;
        orderNumber: string | null;
      };
    };

/** Русские названия типов документов — те же слова, что в интерфейсе. */
const DOC_LABELS: Record<string, string> = {
  act: 'Акт',
  contract: 'Договор',
  extra_agreement: 'Доп. соглашение',
};

export type NotifyManagersOptions = { excludeUserId?: string };

export type NotifyManagersSummary = {
  recipientsNotified: number;
  emailsSent: number;
  emailsSkipped: number;
  /** D5: email-каналы, поставленные в очередь (только при notif_queue). */
  emailsQueued?: number;
};

/** Получатель фан-аута — узкий select канального слоя (D1). */
export type ManagerRecipient = ChannelRecipient;

/**
 * Resolve the set of manager users who should be notified about activity on
 * an order. Mirrors `managerOrderScopeFilter` — three OR paths, dedup'd,
 * filtered by `User.isActive`, with optional `excludeUserId` for actor.
 *
 *   a) per-order: `Order.managerId`
 *   b) per-org:   active `OrganizationManager` rows for `Order.organizationId`
 *   c) historical: distinct users with `role='manager'` who have ever
 *      commented on this order
 *
 * Returning empty array is a valid result (e.g. unassigned order with no
 * comments yet — nobody to notify).
 */
export async function resolveManagerRecipients(
  db: PrismaClient,
  orderId: string,
  opts?: NotifyManagersOptions
): Promise<ManagerRecipient[]> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { managerId: true, organizationId: true },
  });
  if (!order) return [];

  const ids = new Set<string>();

  // a) per-order direct assignment
  if (order.managerId) ids.add(order.managerId);

  // b) per-org via active OrganizationManager rows
  if (order.organizationId) {
    const orgAssigned = await db.organizationManager.findMany({
      where: { organizationId: order.organizationId, isActive: true },
      select: { userId: true },
    });
    for (const a of orgAssigned) ids.add(a.userId);
  }

  // c) historical: any manager who commented on this order
  const historical = await db.comment.findMany({
    where: { orderId, author: { role: { in: ['manager', 'leader'] } } },
    select: { authorId: true },
    distinct: ['authorId'],
  });
  for (const c of historical) ids.add(c.authorId);

  if (opts?.excludeUserId) ids.delete(opts.excludeUserId);
  if (ids.size === 0) return [];

  // Filter by User.isActive — deactivated managers stay out of recipient list
  // even if they were left on OrganizationManager.
  return db.user.findMany({
    where: { id: { in: Array.from(ids) }, isActive: true },
    select: CHANNEL_RECIPIENT_SELECT,
  });
}

type OrderContext = {
  orderId: string;
  orderNumber: string | null;
  orderTitle: string;
  orderUrl: string;
};

type ManagerNotificationOutput = {
  subject: string;
  shortBody: string;
  email: EmailContentRef;
};

/**
 * MANAGER_TEMPLATES — keyed by notification type. Each builder receives
 * the structured input and the resolved order context and returns the
 * `{ subject, shortBody, email }` triple used to (a) fill in the in-app
 * Notification row and (b) reference the matching Resend email template
 * (отправку делает email-канал — D1).
 */
const MANAGER_TEMPLATES: Record<
  NotifyManagersType,
  (input: NotifyManagersInput, ctx: OrderContext) => ManagerNotificationOutput
> = {
  comment_from_org: (input, ctx) => {
    /* v8 ignore next -- defensive guard: MANAGER_TEMPLATES is keyed by input.type so mismatch is structurally impossible via the typed API */
    if (input.type !== 'comment_from_org') throw new Error('type mismatch');
    const props = {
      orgName: input.payload.orgName,
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      commentExcerpt: input.payload.commentExcerpt,
      orderUrl: ctx.orderUrl,
    };
    return {
      subject: managerCommentFromOrgSubject(props),
      shortBody: managerCommentFromOrgText(props),
      email: { template: 'managerCommentFromOrg', props },
    };
  },
  document_uploaded_by_org: (input, ctx) => {
    /* v8 ignore next -- defensive guard: structurally unreachable via typed API (see comment_from_org above) */
    if (input.type !== 'document_uploaded_by_org') throw new Error('type mismatch');
    const props = {
      orgName: input.payload.orgName,
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      documentName: input.payload.documentName,
      documentType: input.payload.documentType,
      orderUrl: ctx.orderUrl,
    };
    return {
      subject: managerDocumentUploadedByOrgSubject(props),
      shortBody: managerDocumentUploadedByOrgText(props),
      email: { template: 'managerDocumentUploadedByOrg', props },
    };
  },
  document_uploaded_by_partner: (input, ctx) => {
    /* v8 ignore next -- defensive guard: structurally unreachable via typed API (see comment_from_org above) */
    if (input.type !== 'document_uploaded_by_partner') throw new Error('type mismatch');
    const props = {
      partnerName: input.payload.partnerName,
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      documentName: input.payload.documentName,
      documentType: input.payload.documentType,
      orderUrl: ctx.orderUrl,
    };
    return {
      subject: managerDocumentUploadedByPartnerSubject(props),
      shortBody: managerDocumentUploadedByPartnerText(props),
      email: { template: 'managerDocumentUploadedByPartner', props },
    };
  },
  order_marked_paid_by_1c: (input, ctx) => {
    /* v8 ignore next -- defensive guard: structurally unreachable via typed API (see comment_from_org above) */
    if (input.type !== 'order_marked_paid_by_1c') throw new Error('type mismatch');
    const props = {
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      amount: input.payload.amount,
      paidAt: input.payload.paidAt,
      orderUrl: ctx.orderUrl,
    };
    return {
      subject: managerOrderMarkedPaidBy1CSubject(props),
      shortBody: managerOrderMarkedPaidBy1CText(props),
      email: { template: 'managerOrderMarkedPaidBy1C', props },
    };
  },
  order_status_changed_by_manager: (input, ctx) => {
    /* v8 ignore next -- defensive guard: structurally unreachable via typed API (see comment_from_org above) */
    if (input.type !== 'order_status_changed_by_manager') throw new Error('type mismatch');
    const props = {
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      actorName: input.payload.actorName,
      oldStatus: input.payload.oldStatus,
      newStatus: input.payload.newStatus,
      orderUrl: ctx.orderUrl,
    };
    return {
      subject: managerOrderStatusChangedSubject(props),
      shortBody: managerOrderStatusChangedText(props),
      email: { template: 'managerOrderStatusChanged', props },
    };
  },
  document_accepted: (input, ctx) => {
    /* v8 ignore next -- defensive guard: structurally unreachable via typed API */
    if (input.type !== 'document_accepted') throw new Error('type mismatch');
    const orderRef = orderLabel(ctx.orderNumber, ctx.orderTitle);
    const what = DOC_LABELS[input.payload.documentType] ?? 'Документ';
    const number = input.payload.documentNumber ? ` № ${input.payload.documentNumber}` : '';
    const subject = `${what}${number} принят заказчиком`;
    const shortBody = `Заказчик принял документ по заказу ${orderRef}.`;
    return {
      subject,
      shortBody,
      email: {
        template: 'notification',
        props: { title: subject, body: shortBody, recipientName: 'менеджер', url: ctx.orderUrl },
      },
    };
  },
  chat_message: (input, ctx) => {
    /* v8 ignore next -- defensive guard: structurally unreachable via typed API (see comment_from_org above) */
    if (input.type !== 'chat_message') throw new Error('type mismatch');
    const orderRef = orderLabel(ctx.orderNumber, ctx.orderTitle);
    const subject = `Новое сообщение по заказу ${orderRef}`;
    const shortBody = input.payload.excerpt;
    return {
      subject,
      shortBody,
      email: {
        template: 'notification',
        props: {
          title: subject,
          body: shortBody,
          recipientName: 'менеджер',
          url: ctx.orderUrl,
        },
      },
    };
  },
};

/**
 * Recipients for an order-less org→managers upload. No order exists, so the
 * order-centric `resolveManagerRecipients` cannot apply — we target the active
 * OrganizationManager set for the organization (the per-org branch (b), which
 * needs no order). Scoped by organization: only managers assigned to this org
 * via OrganizationManager are returned.
 */
export async function resolveOrgManagerRecipients(
  db: PrismaClient,
  organizationId: string,
  opts?: NotifyManagersOptions
): Promise<ManagerRecipient[]> {
  const assigned = await db.organizationManager.findMany({
    where: { organizationId, isActive: true },
    select: { userId: true },
  });
  const ids = new Set(assigned.map((a) => a.userId));
  if (opts?.excludeUserId) ids.delete(opts.excludeUserId);
  if (ids.size === 0) return [];
  return db.user.findMany({
    where: { id: { in: Array.from(ids) }, role: { in: ['manager', 'leader'] }, isActive: true },
    select: CHANNEL_RECIPIENT_SELECT,
  });
}

export async function notifyManagersOrderLess(
  db: PrismaClient,
  input: { organizationId: string; orgName: string; documentName: string; documentType: string },
  opts?: NotifyManagersOptions
): Promise<NotifyManagersSummary> {
  const recipients = await resolveOrgManagerRecipients(db, input.organizationId, opts);
  if (recipients.length === 0) return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };

  const props = {
    orgName: input.orgName,
    orderNumber: 'Общий документ',
    documentName: input.documentName,
    documentType: input.documentType,
    orderUrl: `${getAppBaseUrl()}/manager/documents?tab=general`,
  };
  const subject = managerDocumentUploadedByOrgSubject(props);
  const shortBody = managerDocumentUploadedByOrgText(props);
  const meta = { ...input, orderId: null } as Prisma.InputJsonValue;
  const channelPayload: ChannelPayload = {
    type: 'document_uploaded_by_org',
    title: subject,
    body: shortBody,
    url: props.orderUrl,
    email: { template: 'managerDocumentUploadedByOrg', props },
  };

  // `У-127`: маршрутизация — один запрос на рассылку, а не на получателя.
  const routed = await allowedChannels(db, {
    eventType: channelPayload.type,
    audience: 'manager',
  });
  let emailsSent = 0,
    emailsSkipped = 0,
    emailsQueued = 0,
    recipientsNotified = 0;
  for (const r of recipients) {
    const row = await db.notification.create({
      data: {
        userId: r.id,
        type: 'document_uploaded_by_org',
        title: subject,
        body: shortBody,
        meta,
      },
    });
    recipientsNotified += 1;

    const outcome = await dispatchToRecipient(r, channelPayload, {
      dedupKey: row.id,
      ...(routed ? { channels: routed } : {}),
    });
    if (outcome.mode === 'queued') {
      if (outcome.channels.includes('email')) emailsQueued += 1;
      else emailsSkipped += 1;
      continue;
    }
    if (outcome.results.email?.status === 'sent') emailsSent += 1;
    else emailsSkipped += 1;
  }
  return {
    recipientsNotified,
    emailsSent,
    emailsSkipped,
    ...(emailsQueued > 0 ? { emailsQueued } : {}),
  };
}

/**
 * Получатели для документа партнёра **без заказа** (`У-115`).
 *
 * Заказа нет, значит `resolveManagerRecipients` (он весь построен вокруг
 * заказа) неприменим — как и у заказчика. Целимся в менеджеров организаций
 * этого партнёра: это ровно те люди, которые с ним работают. Партнёр без
 * единой организации в портфеле не получит адресата — рассылка просто пустая,
 * загрузка от этого не падает (§3, degrade gracefully).
 */
export async function resolvePartnerManagerRecipients(
  db: PrismaClient,
  partnerId: string,
  opts?: NotifyManagersOptions
): Promise<ManagerRecipient[]> {
  const orgs = await db.organization.findMany({ where: { partnerId }, select: { id: true } });
  if (orgs.length === 0) return [];
  const assigned = await db.organizationManager.findMany({
    where: { organizationId: { in: orgs.map((o) => o.id) }, isActive: true },
    select: { userId: true },
  });
  const ids = new Set(assigned.map((a) => a.userId));
  if (opts?.excludeUserId) ids.delete(opts.excludeUserId);
  if (ids.size === 0) return [];
  return db.user.findMany({
    where: { id: { in: Array.from(ids) }, role: { in: ['manager', 'leader'] }, isActive: true },
    select: CHANNEL_RECIPIENT_SELECT,
  });
}

/**
 * Документ партнёра без заказа → менеджерам (`У-115`). Зеркало
 * `notifyManagersOrderLess`: та же форма письма, тот же «Общий документ»
 * вместо номера заказа, та же вкладка «Общие» в адресе.
 */
export async function notifyManagersPartnerOrderLess(
  db: PrismaClient,
  input: { partnerId: string; partnerName: string; documentName: string; documentType: string },
  opts?: NotifyManagersOptions
): Promise<NotifyManagersSummary> {
  const recipients = await resolvePartnerManagerRecipients(db, input.partnerId, opts);
  if (recipients.length === 0) return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };

  const props = {
    partnerName: input.partnerName,
    orderNumber: 'Общий документ',
    documentName: input.documentName,
    documentType: input.documentType,
    orderUrl: `${getAppBaseUrl()}/manager/documents?tab=general`,
  };
  const subject = managerDocumentUploadedByPartnerSubject(props);
  const shortBody = managerDocumentUploadedByPartnerText(props);
  const meta = { ...input, orderId: null } as Prisma.InputJsonValue;
  const channelPayload: ChannelPayload = {
    type: 'document_uploaded_by_partner',
    title: subject,
    body: shortBody,
    url: props.orderUrl,
    email: { template: 'managerDocumentUploadedByPartner', props },
  };

  // `У-127`: маршрутизация — один запрос на рассылку, а не на получателя.
  const routed = await allowedChannels(db, {
    eventType: channelPayload.type,
    audience: 'manager',
  });
  let emailsSent = 0,
    emailsSkipped = 0,
    emailsQueued = 0,
    recipientsNotified = 0;
  for (const r of recipients) {
    const row = await db.notification.create({
      data: {
        userId: r.id,
        type: 'document_uploaded_by_partner',
        title: subject,
        body: shortBody,
        meta,
      },
    });
    recipientsNotified += 1;

    const outcome = await dispatchToRecipient(r, channelPayload, {
      dedupKey: row.id,
      ...(routed ? { channels: routed } : {}),
    });
    if (outcome.mode === 'queued') {
      if (outcome.channels.includes('email')) emailsQueued += 1;
      else emailsSkipped += 1;
      continue;
    }
    if (outcome.results.email?.status === 'sent') emailsSent += 1;
    else emailsSkipped += 1;
  }
  return {
    recipientsNotified,
    emailsSent,
    emailsSkipped,
    ...(emailsQueued > 0 ? { emailsQueued } : {}),
  };
}

function getManagerOrderUrl(orderId: string): string {
  return `${getAppBaseUrl()}/manager/orders/${orderId}`;
}

function metaFromInput(input: NotifyManagersInput): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...input.payload, orderId: input.orderId };
  // Dates aren't JSON-serializable in a stable way for the Prisma JSON column —
  // store as ISO string when present.
  if ('paidAt' in input.payload && input.payload.paidAt instanceof Date) {
    meta.paidAt = input.payload.paidAt.toISOString();
  }
  return meta;
}

/**
 * Fan-out notification to all managers in scope of an order.
 *
 * Resolves recipients via `resolveManagerRecipients` (three-way OR matching
 * `managerOrderScopeFilter`), then creates an in-app Notification row per
 * recipient and best-effort dispatches the enabled channels via the channel
 * layer (D1). When the email pipeline is disabled, the email channel returns
 * `skipped` and the Notification rows are still created — the bell counter is
 * the source of truth, not the inbox (matching `notifyOrgUsers` semantics).
 *
 * Invariant: the set of users notified for an order equals
 * `{ m : managerOrderScopeFilter(session(m)) sees order }`. Covered by
 * `notifications.invariant.test.ts`.
 */
export async function notifyManagers(
  db: PrismaClient,
  input: NotifyManagersInput,
  opts?: NotifyManagersOptions
): Promise<NotifyManagersSummary> {
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, orderNumber: true, title: true },
  });
  if (!order) {
    return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };
  }

  const recipients = await resolveManagerRecipients(db, input.orderId, opts);
  if (recipients.length === 0) {
    return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };
  }

  const ctx: OrderContext = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderTitle: order.title,
    orderUrl: getManagerOrderUrl(order.id),
  };

  const build = MANAGER_TEMPLATES[input.type];
  const { subject, shortBody, email } = build(input, ctx);
  const meta = metaFromInput(input);
  const channelPayload: ChannelPayload = {
    type: input.type,
    title: subject,
    body: shortBody,
    url: ctx.orderUrl,
    email,
  };

  // `У-127`: маршрутизация — один запрос на рассылку, а не на получателя.
  const routed = await allowedChannels(db, { eventType: input.type, audience: 'manager' });

  let emailsSent = 0;
  let emailsSkipped = 0;
  let emailsQueued = 0;
  let recipientsNotified = 0;

  for (const r of recipients) {
    const row = await db.notification.create({
      data: {
        userId: r.id,
        type: input.type,
        title: subject,
        body: shortBody,
        meta: meta as Prisma.InputJsonValue,
      },
    });
    recipientsNotified += 1;

    // Best-effort: канальный слой изолирует ошибки per-channel — сбой одного
    // получателя/канала не прерывает fan-out.
    const outcome = await dispatchToRecipient(r, channelPayload, {
      dedupKey: row.id,
      ...(routed ? { channels: routed } : {}),
    });
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
      log.warn('[notifyManagers] email dispatch failed', {
        orderId: input.orderId,
        error: outcome.results.email.reason,
      });
    }
  }

  return {
    recipientsNotified,
    emailsSent,
    emailsSkipped,
    ...(emailsQueued > 0 ? { emailsQueued } : {}),
  };
}
