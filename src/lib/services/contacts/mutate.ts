import { Prisma } from '@prisma/client';
import type { ContactChannelType, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { findChannelOwner, isUserOwnedChannel, type ChannelOwner } from './channels';
import { normalizeChannelValue } from './resolveContactByChannel';
import { canBindOrganization, canUseContacts, isContactInScope } from './scope';

/**
 * Правки контакта (`У-180`, спека §3.4). Каждая функция: право → скоуп →
 * проверка → запись → аудит. Чужой или несуществующий контакт неразличимы
 * снаружи (`not_found`); занятый канал — русская подсказка с владельцем.
 */

type ChannelTaken = {
  ok: false;
  error: 'contact_channel_taken';
  conflict: ChannelOwner;
};

export type MutateContactResult =
  | { ok: true; contactId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'invalid' | 'contact_channel_locked' }
  | ChannelTaken;

const CONTACT_SELECT = {
  id: true,
  companyId: true,
  organizationId: true,
  userId: true,
  isArchived: true,
  mergedIntoId: true,
  name: true,
  user: {
    select: { email: true, telegramChatId: true, maxChatId: true, whatsappPhone: true },
  },
} satisfies Prisma.ContactSelect;

type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

/** Контакт в скоупе сессии или `null` — вне скоупа и несуществующий неразличимы. */
async function loadContact(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  id: string
): Promise<ContactRow | null> {
  const row = await prisma.contact.findUnique({ where: { id }, select: CONTACT_SELECT });
  if (!row || !isContactInScope(session, teamMode, row)) return null;
  return row;
}

export type UpdateContactArgs = {
  id: string;
  name: string;
  position?: string | null | undefined;
  note?: string | null | undefined;
  organizationId?: string | null | undefined;
};

export async function updateContact(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: UpdateContactArgs
): Promise<MutateContactResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const contact = await loadContact(prisma, session, teamMode, args.id);
  if (!contact) return { ok: false, error: 'not_found' };
  const name = args.name.trim();
  if (!name) return { ok: false, error: 'invalid' };

  const organizationId =
    args.organizationId === undefined ? contact.organizationId : args.organizationId;
  if (organizationId && organizationId !== contact.organizationId) {
    // Смена организации — та же проверка, что при создании: организация своей
    // компании и в охвате сотрудника (C8, defense-in-depth).
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, companyId: true },
    });
    if (!org || !canBindOrganization(session, teamMode, org))
      return { ok: false, error: 'not_found' };
  }

  const before = { name: contact.name, organizationId: contact.organizationId };
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      name,
      ...(args.position === undefined ? {} : { position: args.position?.trim() || null }),
      ...(args.note === undefined ? {} : { note: args.note?.trim() || null }),
      organizationId,
    },
  });
  await recordAudit(prisma, {
    action: 'contact_updated',
    entity: 'contact',
    entityId: contact.id,
    userId: session.sub,
    before,
    after: { name, organizationId },
  });
  return { ok: true, contactId: contact.id };
}

export async function archiveContact(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: { id: string }
): Promise<MutateContactResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const contact = await loadContact(prisma, session, teamMode, args.id);
  if (!contact) return { ok: false, error: 'not_found' };
  if (!contact.isArchived) {
    await prisma.contact.update({ where: { id: contact.id }, data: { isArchived: true } });
    await recordAudit(prisma, {
      action: 'contact_archived',
      entity: 'contact',
      entityId: contact.id,
      userId: session.sub,
    });
  }
  return { ok: true, contactId: contact.id };
}

export async function restoreContact(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: { id: string }
): Promise<MutateContactResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const contact = await loadContact(prisma, session, teamMode, args.id);
  if (!contact) return { ok: false, error: 'not_found' };
  // Объединённый контакт живёт в архиве как ссылка на главный (`У-181`):
  // возвращать его — заводить дубль заново.
  if (contact.mergedIntoId) return { ok: false, error: 'invalid' };
  if (contact.isArchived) {
    await prisma.contact.update({ where: { id: contact.id }, data: { isArchived: false } });
    await recordAudit(prisma, {
      action: 'contact_restored',
      entity: 'contact',
      entityId: contact.id,
      userId: session.sub,
    });
  }
  return { ok: true, contactId: contact.id };
}

export type AddChannelArgs = {
  contactId: string;
  type: ContactChannelType;
  value: string;
  makePrimary?: boolean | undefined;
};

export async function addChannel(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: AddChannelArgs
): Promise<MutateContactResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const contact = await loadContact(prisma, session, teamMode, args.contactId);
  if (!contact) return { ok: false, error: 'not_found' };
  const value = args.value.trim();
  const normalizedValue = normalizeChannelValue(args.type, value);
  if (!normalizedValue) return { ok: false, error: 'invalid' };

  const owner = await findChannelOwner(prisma, {
    companyId: contact.companyId,
    type: args.type,
    value,
  });
  // Свой же канал повторно — не ошибка и не дубль: ничего не меняем.
  if (owner && owner.contactId === contact.id) return { ok: true, contactId: contact.id };
  if (owner) return { ok: false, error: 'contact_channel_taken', conflict: owner };

  const hasChannels = (await prisma.contactChannel.count({ where: { contactId: contact.id } })) > 0;
  const isPrimary = args.makePrimary === true || !hasChannels;
  try {
    await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.contactChannel.updateMany({
          where: { contactId: contact.id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      await tx.contactChannel.create({
        data: {
          contactId: contact.id,
          companyId: contact.companyId,
          type: args.type,
          value,
          normalizedValue,
          isPrimary,
        },
      });
      await recordAudit(tx, {
        action: 'contact_channel_added',
        entity: 'contact',
        entityId: contact.id,
        userId: session.sub,
        after: { type: args.type },
      });
    });
  } catch (e) {
    // Гонка двух запросов: пришедший вторым получает ту же подсказку, что и
    // при обычной проверке, а не техническую ошибку базы.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const raced = await findChannelOwner(prisma, {
        companyId: contact.companyId,
        type: args.type,
        value,
      });
      if (raced) return { ok: false, error: 'contact_channel_taken', conflict: raced };
    }
    throw e;
  }
  return { ok: true, contactId: contact.id };
}

const CHANNEL_SELECT = {
  id: true,
  contactId: true,
  type: true,
  normalizedValue: true,
  isPrimary: true,
} satisfies Prisma.ContactChannelSelect;

async function loadChannel(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  channelId: string
): Promise<{
  channel: Prisma.ContactChannelGetPayload<{ select: typeof CHANNEL_SELECT }>;
  contact: ContactRow;
} | null> {
  const channel = await prisma.contactChannel.findUnique({
    where: { id: channelId },
    select: CHANNEL_SELECT,
  });
  if (!channel) return null;
  const contact = await loadContact(prisma, session, teamMode, channel.contactId);
  if (!contact) return null;
  return { channel, contact };
}

export async function removeChannel(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: { channelId: string }
): Promise<MutateContactResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const loaded = await loadChannel(prisma, session, teamMode, args.channelId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { channel, contact } = loaded;
  if (isUserOwnedChannel(contact.user, channel))
    return { ok: false, error: 'contact_channel_locked' };

  await prisma.$transaction(async (tx) => {
    await tx.contactChannel.delete({ where: { id: channel.id } });
    // Основной канал не должен исчезнуть вместе с удалённым: следующий по
    // порядку становится основным.
    if (channel.isPrimary) {
      const next = await tx.contactChannel.findFirst({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next)
        await tx.contactChannel.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await recordAudit(tx, {
      action: 'contact_channel_removed',
      entity: 'contact',
      entityId: contact.id,
      userId: session.sub,
      before: { type: channel.type },
    });
  });
  return { ok: true, contactId: contact.id };
}

export async function setPrimaryChannel(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: { channelId: string }
): Promise<MutateContactResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const loaded = await loadChannel(prisma, session, teamMode, args.channelId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { channel, contact } = loaded;
  if (!channel.isPrimary) {
    await prisma.$transaction([
      prisma.contactChannel.updateMany({
        where: { contactId: contact.id, isPrimary: true },
        data: { isPrimary: false },
      }),
      prisma.contactChannel.update({ where: { id: channel.id }, data: { isPrimary: true } }),
    ]);
  }
  return { ok: true, contactId: contact.id };
}
