import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  getCompanyTeamVisibility,
  isManagerLeader,
  isOrgInScope,
  managerOrgScope,
} from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { recordPiiAccess } from '@/lib/pii/record';
import { MESSENGER_CHANNELS, type MessengerChannel } from './channels';
import { upsertDialog } from './dialog';

/** С кем можно начать диалог: человек и мессенджеры, где его адрес известен. */
export type DialogCandidate = {
  kind: 'user' | 'contact';
  id: string;
  name: string;
  organizationName: string | null;
  channels: MessengerChannel[];
};

const CANDIDATES_CAP = 200;

/**
 * Кандидаты для «Нового диалога» (Р-М-8): пользователи кабинетов с привязанным
 * мессенджером и контакты компании с каналом мессенджера — в охвате
 * сотрудника (командная видимость / закреплённые организации). Человек без
 * известного адреса в списке не появляется: в Telegram и MAX бот не может
 * написать первым тому, кто не нажал «Start».
 */
export async function listDialogCandidates(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<DialogCandidate[]> {
  if (!session.companyId) return [];
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const orgScope: Prisma.OrganizationWhereInput = managerOrgScope(session, teamMode);

  const [users, contacts] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: 'organization',
        isActive: true,
        organization: orgScope,
        OR: [
          { telegramChatId: { not: null } },
          { maxChatId: { not: null } },
          { whatsappPhone: { not: null } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        telegramChatId: true,
        maxChatId: true,
        whatsappPhone: true,
        organization: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: CANDIDATES_CAP,
    }),
    prisma.contact.findMany({
      where: {
        companyId: session.companyId,
        isArchived: false,
        OR: [{ organizationId: null }, { organization: orgScope }],
        channels: { some: { type: { in: [...MESSENGER_CHANNELS] } } },
      },
      select: {
        id: true,
        name: true,
        organization: { select: { name: true } },
        channels: {
          where: { type: { in: [...MESSENGER_CHANNELS] } },
          select: { type: true },
        },
      },
      orderBy: { name: 'asc' },
      take: CANDIDATES_CAP,
    }),
  ]);

  const out: DialogCandidate[] = [
    ...users.map((u) => ({
      kind: 'user' as const,
      id: u.id,
      name: u.name?.trim() || u.email,
      organizationName: u.organization?.name ?? null,
      channels: [
        ...(u.telegramChatId ? (['telegram'] as const) : []),
        ...(u.maxChatId ? (['max'] as const) : []),
        ...(u.whatsappPhone ? (['whatsapp'] as const) : []),
      ],
    })),
    ...contacts.map((c) => ({
      kind: 'contact' as const,
      id: c.id,
      name: c.name,
      organizationName: c.organization?.name ?? null,
      channels: [...new Set(c.channels.map((ch) => ch.type as MessengerChannel))],
    })),
  ];

  await recordPiiAccess(prisma, {
    session,
    context: 'messengers_candidates',
    subjectIds: out.map((c) => c.id),
  });

  return out;
}

export type StartDialogArgs = {
  kind: 'user' | 'contact';
  id: string;
  channel: MessengerChannel;
};

export type StartDialogResult =
  | { ok: true; dialogId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'no_messenger_channel' };

type Target = {
  peerRef: string;
  peerDisplay: string | null;
  organizationId: string | null;
  contactId: string | null;
  userId: string | null;
};

/**
 * Начать диалог первым (Р-М-8). Адрес собеседника берётся С СЕРВЕРА из его
 * привязки — от клиента принимаются только «кто» и «в каком мессенджере»,
 * иначе можно было бы написать произвольному chatId от имени компании.
 * Диалог с этим собеседником может уже существовать: тогда открываем его;
 * ничей — привязываем; чужой компании — `forbidden`.
 */
export async function startDialog(
  prisma: PrismaClient,
  session: SessionPayload,
  args: StartDialogArgs
): Promise<StartDialogResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const orgAllowed = (organizationId: string | null) =>
    organizationId === null ||
    teamMode ||
    isManagerLeader(session) ||
    isOrgInScope(session, organizationId);

  let target: Target;
  if (args.kind === 'user') {
    const user = await prisma.user.findUnique({
      where: { id: args.id },
      select: {
        id: true,
        name: true,
        email: true,
        telegramChatId: true,
        maxChatId: true,
        whatsappPhone: true,
        organization: { select: { id: true, companyId: true } },
      },
    });
    if (!user) return { ok: false, error: 'not_found' };
    if (!user.organization || user.organization.companyId !== session.companyId) {
      return { ok: false, error: 'forbidden' };
    }
    if (!orgAllowed(user.organization.id)) return { ok: false, error: 'forbidden' };
    const peerRef =
      args.channel === 'telegram'
        ? user.telegramChatId
        : args.channel === 'max'
          ? user.maxChatId
          : user.whatsappPhone;
    if (!peerRef) return { ok: false, error: 'no_messenger_channel' };
    target = {
      peerRef,
      peerDisplay: user.name?.trim() || user.email,
      organizationId: user.organization.id,
      contactId: null,
      userId: user.id,
    };
  } else {
    const contact = await prisma.contact.findUnique({
      where: { id: args.id },
      select: {
        id: true,
        name: true,
        companyId: true,
        organizationId: true,
        isArchived: true,
        channels: { where: { type: args.channel }, select: { normalizedValue: true }, take: 1 },
      },
    });
    if (!contact || contact.isArchived) return { ok: false, error: 'not_found' };
    if (contact.companyId !== session.companyId) return { ok: false, error: 'forbidden' };
    if (!orgAllowed(contact.organizationId)) return { ok: false, error: 'forbidden' };
    const peerRef = contact.channels[0]?.normalizedValue;
    if (!peerRef) return { ok: false, error: 'no_messenger_channel' };
    target = {
      peerRef,
      peerDisplay: contact.name,
      organizationId: contact.organizationId,
      contactId: contact.id,
      userId: null,
    };
  }

  const binding = {
    companyId: session.companyId,
    organizationId: target.organizationId,
    contactId: target.contactId,
    userId: target.userId,
  };
  const dialog = await upsertDialog(
    prisma,
    { channel: args.channel, peerRef: target.peerRef },
    {
      create: { peerDisplay: target.peerDisplay, ...binding, status: 'open', unreadCount: 0 },
      // Существующий диалог не трогаем: чей он — решается ниже.
      update: {},
    }
  );
  if (dialog.companyId !== null && dialog.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  if (dialog.companyId === null) {
    await prisma.messengerDialog.updateMany({
      where: { id: dialog.id, companyId: null },
      data: binding,
    });
  }

  await recordAudit(prisma, {
    action: 'messenger_dialog_started',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
    after: { channel: args.channel, kind: args.kind, targetId: args.id },
  });

  return { ok: true, dialogId: dialog.id };
}
