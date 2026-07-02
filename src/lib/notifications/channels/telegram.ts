/**
 * Telegram-канал (D1). Перенос существующего поведения под интерфейс без
 * изменений: гейт `isTelegramEnabled()` (env token+username), адресация по
 * `User.telegramChatId`, текст `title\n\nbody`. Транспортный `{ok:false}`
 * мапится в `failed` — inline-путь его игнорирует (как раньше `.catch(()=>{})`),
 * воркер (D5) использует для SyncLog + retry.
 */
import { isTelegramEnabled, sendTelegramMessage } from '@/lib/telegram/client';
import { channelPrefEnabled } from './preferences';
import type { NotificationChannel } from './types';

export const telegramChannel: NotificationChannel = {
  key: 'telegram',
  isEnabledFor(user) {
    return (
      isTelegramEnabled() &&
      !!user.telegramChatId &&
      channelPrefEnabled(user.notificationChannels, 'telegram')
    );
  },
  async send(user, payload) {
    if (!user.telegramChatId) {
      return { status: 'skipped', reason: 'not_linked' };
    }
    const result = await sendTelegramMessage(
      user.telegramChatId,
      `${payload.title}\n\n${payload.body}`
    );
    return result.ok ? { status: 'sent' } : { status: 'failed', reason: 'transport' };
  },
};
