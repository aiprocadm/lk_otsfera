import { isTelegramEnabled } from '@/lib/telegram/client';
import { isMaxEnabled } from '@/lib/max/client';
import { isWhatsAppEnabled } from '@/lib/whatsapp/aggregator';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import { looksLikeEmail } from '@/lib/services/inbound/emailReply';
import type { DialogChannel } from './channels';

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
export function isMessengerAvailable(channel: DialogChannel): boolean {
  switch (channel) {
    case 'telegram':
      return isTelegramEnabled();
    case 'max':
      return isMaxEnabled();
    case 'whatsapp':
      return isWhatsAppEnabled();
    case 'cabinet':
      // Кабинет не надо «подключать»: ответ кладётся уведомлением внутрь
      // системы. Единственное условие — известен пользователь, и его проверяет
      // сама доставка, а не этот предикат.
      return true;
    case 'email':
      // Почта (`У-205`): отправка включена, ключ задан И настроен входящий
      // ящик адресом. Последнее — не формальность: без него ответ уйдёт с
      // `no-reply`, и ответ клиента попадёт в никуда. Форма ответа не должна
      // появляться там, где ответить по-настоящему нельзя.
      return (
        (cachedIntegrationSetting('email.enabled') ?? '').trim().toLowerCase() === 'true' &&
        !!cachedIntegrationSetting('email.resendApiKey') &&
        looksLikeEmail(cachedIntegrationSetting('imap.user') ?? '')
      );
  }
}
