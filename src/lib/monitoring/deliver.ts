import type { PrismaClient } from '@prisma/client';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import { log } from '@/lib/logging';

const TELEGRAM_TIMEOUT_MS = 5000;

async function deliverTelegram(text: string): Promise<void> {
  // `У-126`: бот и чат задаются в форме «Здоровье системы → Оповещения»;
  // переменные сервера остаются запасным значением.
  const token = (
    cachedIntegrationSetting('alerts.telegramBotToken') ?? process.env.ALERT_TELEGRAM_BOT_TOKEN
  )?.trim();
  const chatId = (
    cachedIntegrationSetting('alerts.telegramChatId') ?? process.env.ALERT_TELEGRAM_CHAT_ID
  )?.trim();
  if (!token || !chatId) return; // channel not configured — skip silently

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Кому уходят ops-оповещения (`У-126`).
 *
 * По умолчанию — всем активным администраторам: так было и до появления
 * формы. Если в настройках задан список адресов, берём тех, кто в нём есть.
 *
 * **Адрес, которому не соответствует активная учётная запись, молча
 * пропускается.** Слать почту «в никуда» бессмысленно, а оповещение об
 * инфраструктуре не должно падать из-за опечатки в списке.
 */
async function alertRecipients(prisma: PrismaClient): Promise<Array<{ id: string }>> {
  const raw = cachedIntegrationSetting('alerts.emailRecipients')?.trim();
  const emails = (raw ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    return prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } });
  }
  return prisma.user.findMany({
    where: { isActive: true, email: { in: emails, mode: 'insensitive' } },
    select: { id: true },
  });
}

export type AlertDelivery = { kind: 'fire' | 'resolve'; message: string; type?: string };

export async function deliverAlert(prisma: PrismaClient, d: AlertDelivery): Promise<void> {
  const text = `${d.kind === 'fire' ? '🔴' : '✅'} ${d.message}`;
  const title = d.kind === 'fire' ? 'Алерт: инфраструктура' : 'Восстановление';
  const type = d.type ?? 'ops_alert';

  const admins = await alertRecipients(prisma);

  for (const a of admins) {
    let rowId: string | undefined;
    try {
      const row = await createNotification({ userId: a.id, type, title, body: text });
      rowId = row.id;
    } catch (err) {
      log.error('[alerts] in-app notification failed', { userId: a.id, err });
    }
    try {
      // Только email: персональный Telegram дублировал бы общий алерт-чат
      // (deliverTelegram ниже шлёт в ALERT_TELEGRAM_CHAT_ID).
      await deliverNotificationToUser({
        userId: a.id,
        title,
        body: text,
        type,
        channels: ['email'],
        dedupKey: rowId,
      });
    } catch (err) {
      log.error('[alerts] email failed', { userId: a.id, err });
    }
  }

  try {
    await deliverTelegram(text);
  } catch (err) {
    log.error('[alerts] telegram failed', { err });
  }
}
