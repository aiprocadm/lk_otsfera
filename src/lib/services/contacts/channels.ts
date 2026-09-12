import type { ContactChannelType, Prisma, PrismaClient } from '@prisma/client';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';
import { normalizeChannelValue } from './resolveContactByChannel';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/** Кому принадлежит канал: другой контакт той же компании (`У-180`). */
export type ChannelOwner = { contactId: string; name: string };

/**
 * Занят ли канал другим контактом компании. Уникальность
 * `(companyId, type, normalizedValue)` держит база, но человеку нужна русская
 * подсказка с именем владельца и кнопкой «Объединить», а не `P2002`.
 */
export async function findChannelOwner(
  prisma: PrismaLike,
  args: { companyId: string; type: ContactChannelType; value: string; excludeContactId?: string }
): Promise<ChannelOwner | null> {
  const normalizedValue = normalizeChannelValue(args.type, args.value);
  if (!normalizedValue) return null;
  const row = await prisma.contactChannel.findFirst({
    where: {
      companyId: args.companyId,
      type: args.type,
      normalizedValue,
      ...(args.excludeContactId ? { contactId: { not: args.excludeContactId } } : {}),
    },
    select: { contactId: true, contact: { select: { name: true } } },
  });
  return row ? { contactId: row.contactId, name: row.contact.name } : null;
}

/** Поля пользователя кабинета, из которых бэкфилл заводит каналы контакта. */
export type ChannelOwnerUser = {
  email: string;
  telegramChatId: string | null;
  maxChatId: string | null;
  whatsappPhone: string | null;
};

/**
 * Канал «принадлежит» пользователю кабинета, если совпадает с его полем
 * (`User.email`, `telegramChatId`, `maxChatId`, `whatsappPhone`): такие каналы
 * меняются в профиле пользователя, а не в контакте (спека §3.3, код
 * `contact_channel_locked`).
 */
export function isUserOwnedChannel(
  user: ChannelOwnerUser | null,
  channel: { type: ContactChannelType; normalizedValue: string }
): boolean {
  if (!user) return false;
  switch (channel.type) {
    case 'email':
      return channel.normalizedValue === user.email.trim().toLowerCase();
    case 'telegram':
      return user.telegramChatId !== null && channel.normalizedValue === user.telegramChatId.trim();
    case 'max':
      return user.maxChatId !== null && channel.normalizedValue === user.maxChatId.trim();
    case 'phone':
    case 'whatsapp':
      return (
        user.whatsappPhone !== null &&
        channel.normalizedValue === normalizePhoneCanonical(user.whatsappPhone)
      );
  }
}
