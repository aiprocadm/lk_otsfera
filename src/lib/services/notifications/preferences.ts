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
  isOptionalChannelKey,
  parseChannelPrefs,
  type ChannelPrefs,
} from '@/lib/notifications/channels/preferences';
import { recordAudit } from '@/lib/auth/audit';

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
