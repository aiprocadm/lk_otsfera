/**
 * Канал Max (D3). За тем же интерфейсом, что email/telegram; гейт — флаг
 * `max_channel` (внутри isMaxEnabled) + привязка `maxChatId` + пользовательская
 * настройка. Добавление канала — только эта реализация + строка в registry.
 */
import { isMaxEnabled, sendMaxMessage } from '@/lib/max/client';
import { channelPrefEnabled } from './preferences';
import type { NotificationChannel } from './types';

export const maxChannel: NotificationChannel = {
  key: 'max',
  isEnabledFor(user) {
    return (
      isMaxEnabled() && !!user.maxChatId && channelPrefEnabled(user.notificationChannels, 'max')
    );
  },
  async send(user, payload) {
    if (!user.maxChatId) {
      return { status: 'skipped', reason: 'not_linked' };
    }
    const result = await sendMaxMessage(user.maxChatId, `${payload.title}\n\n${payload.body}`);
    return result.ok ? { status: 'sent' } : { status: 'failed', reason: 'transport' };
  },
};
