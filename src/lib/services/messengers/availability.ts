import { isTelegramEnabled } from '@/lib/telegram/client';
import { isMaxEnabled } from '@/lib/max/client';
import { isWhatsAppEnabled } from '@/lib/whatsapp/aggregator';
import type { MessengerChannel } from './channels';

/**
 * Доступность канала — СЕРВЕРНЫЙ модуль, отдельно от `channels.ts` намеренно.
 *
 * Предикаты клиентов ботов читают кэш настроек, а тот — ключ шифрования из
 * `node:crypto`. Пока эта функция лежала рядом с подписями каналов, клиентский
 * компонент «Новый диалог» (`'use client'`) импортом подписей утаскивал в
 * браузерный бандл `node:crypto`, и `next build` падал (стенд откатился после
 * #581). Границу держит страж `components.client-server-boundary.guardrail`.
 *
 * Канал готов отправлять: ключи заданы, а у MAX и WhatsApp поднят и флаг
 * канала. Ровно те же предикаты, что у транспортов уведомлений — форма ответа
 * в диалоге появляется тогда же, когда канал начинает доставлять уведомления.
 */
export function isMessengerAvailable(channel: MessengerChannel): boolean {
  switch (channel) {
    case 'telegram':
      return isTelegramEnabled();
    case 'max':
      return isMaxEnabled();
    case 'whatsapp':
      return isWhatsAppEnabled();
  }
}
