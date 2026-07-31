import type { PrismaClient } from '@prisma/client';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { log } from '@/lib/logging';

const TELEGRAM_TIMEOUT_MS = 5000;

export async function deliverTelegram(text: string): Promise<void> {
  const token = process.env.ALERT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID?.trim();
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

export type AlertDelivery = { kind: 'fire' | 'resolve'; message: string; type?: string };

export async function deliverAlert(prisma: PrismaClient, d: AlertDelivery): Promise<void> {
  const text = `${d.kind === 'fire' ? '🔴' : '✅'} ${d.message}`;
  const title = d.kind === 'fire' ? 'Алерт: инфраструктура' : 'Восстановление';
  const type = d.type ?? 'ops_alert';

  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });

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
