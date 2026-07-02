/**
 * Настройки каналов уведомлений пользователя (трек D2) — Result-контракт §3.
 *
 * - toggle opt-in каналов (telegram/max/whatsapp; email не отключается);
 * - сохранение/удаление номера WhatsApp (агрегатор адресует по номеру,
 *   deep-link-привязки как у Telegram/Max у WhatsApp нет).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  channelPrefEnabled,
  isOptionalChannelKey,
  parseChannelPrefs,
  type ChannelPrefs,
} from '@/lib/notifications/channels/preferences';
import { isTelegramEnabled } from '@/lib/telegram/client';
import { isMaxEnabled } from '@/lib/max/client';
import { isWhatsAppEnabled } from '@/lib/whatsapp/aggregator';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Полное представление настроек каналов для UI (D2). Собирает привязки,
 * пользовательские toggle-и и env/flag-доступность каждого канала. Email —
 * всегда включён, отдельным полем `emailAlwaysOn` (в UI показывается как
 * «всегда включён, не отключается»).
 */
export type NotificationSettingsView = {
  emailAlwaysOn: true;
  telegram: { available: boolean; linked: boolean; enabled: boolean };
  max: { available: boolean; linked: boolean; enabled: boolean };
  whatsapp: { available: boolean; phone: string | null; enabled: boolean };
};

export async function getNotificationSettings(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; view: NotificationSettingsView }> {
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      telegramChatId: true,
      maxChatId: true,
      whatsappPhone: true,
      notificationChannels: true,
    },
  });
  const prefs = parseChannelPrefs(user?.notificationChannels);

  return {
    ok: true,
    view: {
      emailAlwaysOn: true,
      telegram: {
        available: isTelegramEnabled(),
        linked: !!user?.telegramChatId,
        enabled: channelPrefEnabled(prefs, 'telegram'),
      },
      max: {
        available: isMaxEnabled(),
        linked: !!user?.maxChatId,
        enabled: channelPrefEnabled(prefs, 'max'),
      },
      whatsapp: {
        available: isWhatsAppEnabled(),
        phone: user?.whatsappPhone ?? null,
        enabled: channelPrefEnabled(prefs, 'whatsapp'),
      },
    },
  };
}

export async function updateChannelPreference(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { channel: string; enabled: boolean }
): Promise<{ ok: true; channels: ChannelPrefs } | { ok: false; error: 'invalid_channel' }> {
  if (!isOptionalChannelKey(args.channel)) {
    return { ok: false, error: 'invalid_channel' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { notificationChannels: true },
  });
  const merged: ChannelPrefs = {
    ...parseChannelPrefs(user?.notificationChannels),
    [args.channel]: args.enabled,
  };

  await prisma.user.update({
    where: { id: session.sub },
    data: { notificationChannels: merged as Prisma.InputJsonValue },
  });

  return { ok: true, channels: merged };
}

/**
 * Нормализация телефона к E.164-виду: убираем разделители, «8XXXXXXXXXX»
 * (домашний RU-формат) переводим в «+7…», требуем 10–15 цифр. Возвращает
 * null для невалидного ввода.
 */
export function normalizePhone(raw: string): string | null {
  const stripped = raw.trim().replace(/[\s\-()]/g, '');
  if (!/^\+?\d{10,15}$/.test(stripped)) return null;
  const digits = stripped.replace(/^\+/, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`;
  }
  return `+${digits}`;
}

export async function saveWhatsappPhone(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { phone: string }
): Promise<{ ok: true; phone: string | null } | { ok: false; error: 'invalid_phone' | 'phone_taken' }> {
  // Пустая строка = отвязка номера.
  if (args.phone.trim() === '') {
    await prisma.user.update({
      where: { id: session.sub },
      data: { whatsappPhone: null },
    });
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'whatsapp_phone_removed',
      entity: 'user',
      entityId: session.sub,
    });
    return { ok: true, phone: null };
  }

  const phone = normalizePhone(args.phone);
  if (!phone) return { ok: false, error: 'invalid_phone' };

  try {
    await prisma.user.update({
      where: { id: session.sub },
      data: { whatsappPhone: phone },
    });
  } catch (err) {
    // @unique(whatsappPhone): номер уже привязан к другому пользователю.
    if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
      return { ok: false, error: 'phone_taken' };
    }
    throw err;
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'whatsapp_phone_saved',
    entity: 'user',
    entityId: session.sub,
    // Номер телефона (ПДн) намеренно не пишем в audit meta.
  });

  return { ok: true, phone };
}
