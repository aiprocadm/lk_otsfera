import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScope } from '@/lib/auth/managerPolicy';
import { auditActionLabel } from '@/lib/audit/labels';
import { recordPiiAccess } from '@/lib/pii/record';
import { MESSENGER_LABELS, isMessengerChannel } from '@/lib/services/messengers/channels';
import { isUserOwnedChannel } from './channels';
import type { ContactChannelView } from './list';
import { canUseContacts, isContactInScope } from './scope';

/**
 * Карточка контакта (`У-179`): шапка, каналы, счётчики по вкладкам; сами
 * вкладки грузятся отдельно по ключу (`listContactTab`) — не тянуть шесть
 * списков ради шапки. Чужой и несуществующий контакт неразличимы снаружи
 * (`not_found`); открытие карточки — чтение ПДн (`У-186`, контекст
 * `contact_card`).
 */

// Типы карточки станут экспортом вместе с экранами (PR-2): knip не терпит
// экспорта без потребителя, а тесты потребителем не считаются осмысленно.
type ContactCardChannel = ContactChannelView & {
  /** Канал пользователя кабинета: правится в его профиле, не здесь (`contact_channel_locked`). */
  locked: boolean;
};

type ContactCounts = {
  dialogs: number;
  calls: number;
  inbound: number;
  deals: number;
  orders: number;
};

type ContactView = {
  id: string;
  name: string;
  position: string | null;
  note: string | null;
  isArchived: boolean;
  /** Не null — контакт объединён: страница редиректит на главного (`У-181`). */
  mergedIntoId: string | null;
  createdAt: Date;
  updatedAt: Date;
  organization: { id: string; name: string } | null;
  user: { id: string; name: string | null; email: string } | null;
  channels: ContactCardChannel[];
  /** Есть канал мессенджера — кнопка «Написать» имеет смысл (`Р-М-8`). */
  messengerChannels: string[];
  counts: ContactCounts;
};

export type GetContactResult =
  { ok: true; contact: ContactView } | { ok: false; error: 'not_found' | 'forbidden' };

const CARD_SELECT = {
  id: true,
  companyId: true,
  organizationId: true,
  name: true,
  position: true,
  note: true,
  isArchived: true,
  mergedIntoId: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, name: true } },
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      telegramChatId: true,
      maxChatId: true,
      whatsappPhone: true,
    },
  },
  channels: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, type: true, value: true, normalizedValue: true, isPrimary: true },
  },
  _count: {
    select: { messengerDialogs: true, calls: true, inboundMessages: true, ordersAsPrimary: true },
  },
} satisfies Prisma.ContactSelect;

export async function getContact(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  id: string
): Promise<GetContactResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const row = await prisma.contact.findUnique({ where: { id }, select: CARD_SELECT });
  if (!row || !isContactInScope(session, teamMode, row)) return { ok: false, error: 'not_found' };

  // Сделки ссылаются на контакт строкой без relation — счётчик отдельным запросом.
  const deals = await prisma.deal.count({ where: { contactId: row.id, companyId: row.companyId } });

  const channels: ContactCardChannel[] = row.channels.map((ch) => ({
    id: ch.id,
    type: ch.type,
    value: ch.value,
    isPrimary: ch.isPrimary,
    locked: isUserOwnedChannel(row.user, ch),
  }));

  await recordPiiAccess(prisma, { session, context: 'contact_card', subjectIds: [row.id] });

  return {
    ok: true,
    contact: {
      id: row.id,
      name: row.name,
      position: row.position,
      note: row.note,
      isArchived: row.isArchived,
      mergedIntoId: row.mergedIntoId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      organization: row.organization,
      user: row.user ? { id: row.user.id, name: row.user.name, email: row.user.email } : null,
      channels,
      messengerChannels: [
        ...new Set(row.channels.map((ch) => ch.type as string).filter(isMessengerChannel)),
      ],
      counts: {
        dialogs: row._count.messengerDialogs,
        calls: row._count.calls,
        inbound: row._count.inboundMessages,
        deals,
        orders: row._count.ordersAsPrimary,
      },
    },
  };
}

/** Вкладки карточки; «Задачи» появятся в этапе 4 вместе с `Task.linkedContactId`. */
const CONTACT_TABS = ['dialogs', 'calls', 'inbound', 'deals', 'orders', 'history'] as const;
export type ContactTabKey = (typeof CONTACT_TABS)[number];

export function isContactTabKey(value: string): value is ContactTabKey {
  return (CONTACT_TABS as readonly string[]).includes(value);
}

/** Одна строка любой вкладки — форма общая, чтобы компонент не знал шесть доменов. */
type ContactTabItem = {
  kind: ContactTabKey;
  id: string;
  at: Date;
  title: string;
  subtitle: string | null;
  status: string | null;
};

export type ContactTabResult =
  | { ok: true; items: ContactTabItem[]; total: number }
  | { ok: false; error: 'not_found' | 'forbidden' };

/** Строк на странице вкладки; полный счётчик — в `total` («Показаны N из M»). */
export const CONTACT_TAB_PAGE = 20;

function snippet(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function channelTitle(channel: string): string {
  return isMessengerChannel(channel) ? MESSENGER_LABELS[channel] : channel;
}

/**
 * Содержимое вкладки карточки: 20 строк со сдвигом и полный счётчик. Скоуп
 * заказов — тот же, что у списков заказов сотрудника (`managerOrderScope`);
 * остальные связи живут внутри компании контакта.
 */
export async function listContactTab(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: { contactId: string; tab: ContactTabKey; skip?: number | undefined }
): Promise<ContactTabResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const contact = await prisma.contact.findUnique({
    where: { id: args.contactId },
    select: { id: true, companyId: true, organizationId: true },
  });
  if (!contact || !isContactInScope(session, teamMode, contact)) {
    return { ok: false, error: 'not_found' };
  }
  const skip = Math.max(0, Math.floor(args.skip ?? 0));
  const page = { skip, take: CONTACT_TAB_PAGE } as const;

  switch (args.tab) {
    case 'dialogs': {
      const where = { contactId: contact.id };
      const [rows, total] = await Promise.all([
        prisma.messengerDialog.findMany({
          where,
          select: {
            id: true,
            channel: true,
            lastMessageAt: true,
            lastMessagePreview: true,
            status: true,
          },
          orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
          ...page,
        }),
        prisma.messengerDialog.count({ where }),
      ]);
      return {
        ok: true,
        total,
        items: rows.map((r) => ({
          kind: 'dialogs',
          id: r.id,
          at: r.lastMessageAt,
          title: `Диалог в ${channelTitle(r.channel)}`,
          subtitle: r.lastMessagePreview ? snippet(r.lastMessagePreview) : null,
          status: r.status,
        })),
      };
    }
    case 'calls': {
      const where = { contactId: contact.id };
      const [rows, total] = await Promise.all([
        prisma.call.findMany({
          where,
          select: {
            id: true,
            direction: true,
            callerNumber: true,
            startedAt: true,
            createdAt: true,
            durationSec: true,
            status: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...page,
        }),
        prisma.call.count({ where }),
      ]);
      return {
        ok: true,
        total,
        items: rows.map((r) => ({
          kind: 'calls',
          id: r.id,
          at: r.startedAt ?? r.createdAt,
          title: r.direction === 'out' ? 'Исходящий звонок' : 'Входящий звонок',
          subtitle:
            r.durationSec !== null ? `${r.callerNumber} · ${r.durationSec} с` : r.callerNumber,
          status: r.status,
        })),
      };
    }
    case 'inbound': {
      const where = { contactId: contact.id };
      const [rows, total] = await Promise.all([
        prisma.inboundMessage.findMany({
          where,
          select: {
            id: true,
            channel: true,
            subject: true,
            body: true,
            createdAt: true,
            status: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...page,
        }),
        prisma.inboundMessage.count({ where }),
      ]);
      return {
        ok: true,
        total,
        items: rows.map((r) => ({
          kind: 'inbound',
          id: r.id,
          at: r.createdAt,
          title: r.subject?.trim() || snippet(r.body),
          subtitle: channelTitle(r.channel),
          status: r.status,
        })),
      };
    }
    case 'deals': {
      const where = { contactId: contact.id, companyId: contact.companyId };
      const [rows, total] = await Promise.all([
        prisma.deal.findMany({
          where,
          select: { id: true, title: true, amount: true, status: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...page,
        }),
        prisma.deal.count({ where }),
      ]);
      return {
        ok: true,
        total,
        items: rows.map((r) => ({
          kind: 'deals',
          id: r.id,
          at: r.createdAt,
          title: r.title,
          subtitle: r.amount !== null ? `${r.amount.toFixed(2)} ₽` : null,
          status: r.status,
        })),
      };
    }
    case 'orders': {
      // Контакт уже прошёл скоуп — его компания и есть компания сессии;
      // администратору — пол компании, сотруднику — тот же скоуп, что у
      // списков заказов.
      const scope: Prisma.OrderWhereInput =
        session.role === 'admin'
          ? { companyId: contact.companyId }
          : managerOrderScope(session, teamMode);
      const where: Prisma.OrderWhereInput = { AND: [scope, { primaryContactId: contact.id }] };
      const [rows, total] = await Promise.all([
        prisma.order.findMany({
          where,
          select: {
            id: true,
            title: true,
            orderNumber: true,
            totalAmount: true,
            createdAt: true,
            executionStatus: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...page,
        }),
        prisma.order.count({ where }),
      ]);
      return {
        ok: true,
        total,
        items: rows.map((r) => ({
          kind: 'orders',
          id: r.id,
          at: r.createdAt,
          title: r.orderNumber ? `${r.orderNumber} · ${r.title}` : r.title,
          subtitle: `${r.totalAmount.toFixed(2)} ₽`,
          status: r.executionStatus,
        })),
      };
    }
    case 'history': {
      const where = { entity: 'contact', entityId: contact.id };
      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          select: { id: true, action: true, createdAt: true, user: { select: { name: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...page,
        }),
        prisma.auditLog.count({ where }),
      ]);
      return {
        ok: true,
        total,
        items: rows.map((r) => ({
          kind: 'history',
          id: r.id,
          at: r.createdAt,
          title: auditActionLabel(r.action),
          subtitle: r.user?.name ?? null,
          status: null,
        })),
      };
    }
  }
}
