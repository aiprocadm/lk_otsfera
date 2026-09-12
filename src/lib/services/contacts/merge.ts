import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canUseContacts, contactScopeWhere, isContactInScope } from './scope';

/**
 * Объединение дублей (`У-181`, спека §3.5): один главный, второй — в архив со
 * ссылкой `mergedIntoId`. Все связи переезжают одной транзакцией: каналы,
 * входящие письма, звонки, диалоги мессенджеров, заказы (`primaryContactId`),
 * сделки (`Deal.contactId`), пользователь кабинета; пустые `position`/`note`
 * главного заполняются из второго — непустые не затираются. Задачи
 * (`Task.linkedContactId`) появятся в этапе 4 и добавятся в перенос там.
 */

export type MergeContactsArgs = { primaryId: string; secondaryId: string };

type MergeMoved = {
  channels: number;
  inbound: number;
  calls: number;
  dialogs: number;
  orders: number;
  deals: number;
  userMoved: boolean;
};

export type MergeContactsResult =
  | { ok: true; primaryId: string; moved: MergeMoved }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'contact_merge_self'
        | 'contact_merge_two_users'
        | 'contact_merge_target_merged';
    };

const MERGE_SELECT = {
  id: true,
  companyId: true,
  organizationId: true,
  userId: true,
  isArchived: true,
  mergedIntoId: true,
  name: true,
  position: true,
  note: true,
  _count: {
    select: {
      channels: true,
      inboundMessages: true,
      calls: true,
      messengerDialogs: true,
      ordersAsPrimary: true,
    },
  },
} satisfies Prisma.ContactSelect;

export async function mergeContacts(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: MergeContactsArgs
): Promise<MergeContactsResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  if (args.primaryId === args.secondaryId) return { ok: false, error: 'contact_merge_self' };

  const rows = await prisma.contact.findMany({
    where: { id: { in: [args.primaryId, args.secondaryId] } },
    select: MERGE_SELECT,
  });
  const primary = rows.find((r) => r.id === args.primaryId);
  const secondary = rows.find((r) => r.id === args.secondaryId);
  // Оба — в скоупе и одной компании; иначе снаружи это «нет такого контакта».
  if (
    !primary ||
    !secondary ||
    !isContactInScope(session, teamMode, primary) ||
    !isContactInScope(session, teamMode, secondary) ||
    primary.companyId !== secondary.companyId
  ) {
    return { ok: false, error: 'not_found' };
  }
  if (primary.mergedIntoId) return { ok: false, error: 'contact_merge_target_merged' };
  if (primary.userId && secondary.userId) return { ok: false, error: 'contact_merge_two_users' };

  const dealsBefore = await prisma.deal.count({ where: { contactId: secondary.id } });
  const before = {
    name: secondary.name,
    organizationId: secondary.organizationId,
    channels: secondary._count.channels,
    inbound: secondary._count.inboundMessages,
    calls: secondary._count.calls,
    dialogs: secondary._count.messengerDialogs,
    orders: secondary._count.ordersAsPrimary,
    deals: dealsBefore,
  };

  const moved = await prisma.$transaction(async (tx) => {
    // Каналы: тип и значение уникальны в компании, конфликтов быть не может;
    // признак основного у перенесённых снимается — основной остаётся у главного.
    const channels = await tx.contactChannel.updateMany({
      where: { contactId: secondary.id },
      data: { contactId: primary.id, isPrimary: false },
    });
    const inbound = await tx.inboundMessage.updateMany({
      where: { contactId: secondary.id },
      data: { contactId: primary.id },
    });
    const calls = await tx.call.updateMany({
      where: { contactId: secondary.id },
      data: { contactId: primary.id },
    });
    const dialogs = await tx.messengerDialog.updateMany({
      where: { contactId: secondary.id },
      data: { contactId: primary.id },
    });
    const orders = await tx.order.updateMany({
      where: { primaryContactId: secondary.id },
      data: { primaryContactId: primary.id },
    });
    const deals = await tx.deal.updateMany({
      where: { contactId: secondary.id },
      data: { contactId: primary.id },
    });
    // `userId` уникален: сначала снимаем у второго, потом отдаём главному.
    const userMoved = !!secondary.userId && !primary.userId;
    await tx.contact.update({
      where: { id: secondary.id },
      data: { userId: null, isArchived: true, mergedIntoId: primary.id },
    });
    await tx.contact.update({
      where: { id: primary.id },
      data: {
        ...(userMoved ? { userId: secondary.userId } : {}),
        ...(primary.position ? {} : { position: secondary.position }),
        ...(primary.note ? {} : { note: secondary.note }),
        ...(primary.organizationId ? {} : { organizationId: secondary.organizationId }),
      },
    });
    await recordAudit(tx, {
      action: 'contact_merged',
      entity: 'contact',
      entityId: primary.id,
      userId: session.sub,
      before,
      after: { mergedFromId: secondary.id },
    });
    return {
      channels: channels.count,
      inbound: inbound.count,
      calls: calls.count,
      dialogs: dialogs.count,
      orders: orders.count,
      deals: deals.count,
      userMoved,
    };
  });

  return { ok: true, primaryId: primary.id, moved };
}

export type MergeCandidate = {
  id: string;
  name: string;
  position: string | null;
  organization: { id: string; name: string } | null;
  channels: { type: string; value: string }[];
};

const CANDIDATES_CAP = 20;

/**
 * С кем объединять: контакты скоупа, кроме архивных и самого себя; поиск по
 * имени. Список короткий — это выбор в диалоге, а не справочник.
 */
export async function listMergeCandidates(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: { excludeId: string; q?: string | undefined }
): Promise<{ ok: true; items: MergeCandidate[] } | { ok: false; error: 'forbidden' }> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const q = args.q?.trim();
  const items = await prisma.contact.findMany({
    where: {
      AND: [
        contactScopeWhere(session, teamMode),
        { isArchived: false, id: { not: args.excludeId } },
        ...(q ? [{ name: { contains: q, mode: 'insensitive' as const } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      position: true,
      organization: { select: { id: true, name: true } },
      channels: { select: { type: true, value: true }, orderBy: { isPrimary: 'desc' } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: CANDIDATES_CAP,
  });
  return { ok: true, items };
}
