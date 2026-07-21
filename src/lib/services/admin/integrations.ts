import { isTelegramEnabled } from '@/lib/telegram/client';
import { isMaxEnabled } from '@/lib/max/client';
import { isWhatsAppEnabled } from '@/lib/whatsapp/aggregator';

/**
 * Read-only статус платформенных интеграций для /admin/integrations.
 *
 * Секреты (ключи Mango, токены ботов) настраиваются ТОЛЬКО через env при
 * установке (см. спеки omnichannel-...-telephony-design и track-d-...-channels)
 * — эта панель их НЕ показывает и НЕ редактирует, только сообщает, настроен ли
 * канал. Значения секретов сюда не попадают: используются лишь булевы
 * is*Enabled()-проверки и факт наличия ключей Mango.
 */

export type IntegrationStatus = {
  key: string;
  label: string;
  /** true — канал полностью сконфигурирован и активен. */
  enabled: boolean;
  /** Что это за интеграция, коротко для админа. */
  description: string;
  /** Какие env-переменные её включают (без значений) — подсказка для настройки. */
  envHint: string;
};

function isMangoTelephonyEnabled(): boolean {
  const flagOn = ['1', 'true', 'on', 'yes'].includes(
    (process.env.FEATURE_TELEPHONY_MANGO ?? '').trim().toLowerCase()
  );
  return (
    flagOn &&
    !!process.env.MANGO_API_KEY?.trim() &&
    !!process.env.MANGO_API_SALT?.trim()
  );
}

export function getIntegrationsStatus(): IntegrationStatus[] {
  const oneCAdapter = (process.env.ONE_C_ADAPTER ?? 'fake').trim().toLowerCase();
  return [
    {
      key: 'onec',
      label: 'Обмен с 1С',
      enabled: oneCAdapter === 'rest',
      description:
        oneCAdapter === 'rest'
          ? 'Боевой обмен с 1С по сети включён.'
          : 'Работает тестовый (fake) адаптер — реальный обмен с 1С выключен.',
      envHint: 'ONE_C_ADAPTER=rest'
    },
    {
      key: 'mango',
      label: 'Телефония (Mango Office)',
      enabled: isMangoTelephonyEnabled(),
      description: 'Приём звонков, запись разговоров и click-to-call через Mango Office.',
      envHint: 'FEATURE_TELEPHONY_MANGO=1 + MANGO_API_KEY + MANGO_API_SALT'
    },
    {
      key: 'telegram',
      label: 'Telegram-бот',
      enabled: isTelegramEnabled(),
      description: 'Уведомления и вход через Telegram-бот.',
      envHint: 'TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME'
    },
    {
      key: 'max',
      label: 'Max-бот',
      enabled: isMaxEnabled(),
      description: 'Уведомления через мессенджер Max.',
      envHint: 'max_channel=on + MAX_BOT_TOKEN + MAX_BOT_USERNAME'
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      enabled: isWhatsAppEnabled(),
      description: 'Входящие/исходящие сообщения WhatsApp через агрегатора.',
      envHint: 'whatsapp_channel=on + WHATSAPP_AGGREGATOR_API_KEY + WHATSAPP_AGGREGATOR_CHANNEL_ID'
    }
  ];
}
