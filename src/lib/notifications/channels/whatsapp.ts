/**
 * Канал WhatsApp через агрегатор (D4). За тем же интерфейсом; гейт — флаг
 * `whatsapp_channel` (в isWhatsAppEnabled) + привязанный номер `whatsappPhone`
 * + пользовательская настройка. Адресация по номеру (агрегатор), не chatId.
 */
import { isWhatsAppEnabled, sendWhatsAppMessage } from '@/lib/whatsapp/aggregator';
import { channelPrefEnabled } from './preferences';
import type { NotificationChannel } from './types';

export const whatsappChannel: NotificationChannel = {
  key: 'whatsapp',
  isEnabledFor(user) {
    return (
      isWhatsAppEnabled() &&
      !!user.whatsappPhone &&
      channelPrefEnabled(user.notificationChannels, 'whatsapp')
    );
  },
  async send(user, payload) {
    if (!user.whatsappPhone) {
      return { status: 'skipped', reason: 'not_linked' };
    }
    const result = await sendWhatsAppMessage(
      user.whatsappPhone,
      `${payload.title}\n\n${payload.body}`
    );
    return result.ok ? { status: 'sent' } : { status: 'failed', reason: 'transport' };
  },
};
