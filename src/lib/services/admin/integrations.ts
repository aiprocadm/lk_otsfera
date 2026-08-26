import type { PrismaClient } from '@prisma/client';
import { isTelegramEnabled } from '@/lib/telegram/client';
import { isMaxEnabled } from '@/lib/max/client';
import { isWhatsAppEnabled } from '@/lib/whatsapp/aggregator';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import { isFeatureEnabled } from '@/lib/featureFlags';

/**
 * Read-only статус платформенных интеграций для /admin/integrations.
 *
 * Значения секретов сюда не попадают: используются лишь булевы
 * is*Enabled()-проверки и факт наличия ключей. Креды читаются через кэш
 * настроек интеграций (страница праймит его перед вызовом) — статус отражает
 * то, что сохранено в UI, с env как fallback. Флаги каналов остаются env.
 *
 * ФТ-14.2: точки чтения кредов переведены с `process.env` на настройки
 * (`cachedIntegrationSetting` / `getSettingValue`, env — fallback) — здесь и в
 * `telegram/client.ts`, `max/client.ts`, `whatsapp/aggregator.ts`, воркере.
 * Применение без рестарта обеспечивает сброс кэша при сохранении
 * (`resetIntegrationSettingsCache` в server-actions).
 *
 * `У-124` отменил прежнюю оговорку «рубильники фич и выбор адаптеров остаются
 * в env как деплой-решения»: телефония включается переключателем в разделе
 * «Функции платформы», а её адаптер — поле формы. Оговорка была верна, пока
 * флаг закрывал раздел в edge-middleware; теперь он поведенческий.
 */

export type IntegrationStatus = {
  key: string;
  label: string;
  /** true — канал полностью сконфигурирован и активен. */
  enabled: boolean;
  /** Что это за интеграция, коротко для админа. */
  description: string;
  /** Как её включить (env-флаги и/или формы ниже) — подсказка без значений. */
  envHint: string;
};

function isMangoTelephonyEnabled(): boolean {
  // `У-124`: флаг читается ТЕМ ЖЕ способом, что в `integrationsHealth.ts`.
  // Здесь стояло сырое чтение `process.env`, и после переключения флага из
  // интерфейса два экрана про одну телефонию показывали разное: светофор
  // «включено», а карточка статуса «выключено».
  return (
    isFeatureEnabled('telephony_mango') &&
    !!cachedIntegrationSetting('mango.apiKey') &&
    !!cachedIntegrationSetting('mango.apiSalt')
  );
}

/** `У-85`: тот же предикат нужен обогащению ИНН при импорте выписки. */
export function isDadataEnabled(): boolean {
  const flag = (cachedIntegrationSetting('dadata.enabled') ?? '').trim().toLowerCase();
  const flagOn = ['1', 'true', 'on', 'yes'].includes(flag);
  return flagOn && !!cachedIntegrationSetting('dadata.apiKey');
}

export function getIntegrationsStatus(): IntegrationStatus[] {
  const oneCAdapter = (cachedIntegrationSetting('onec.adapter') ?? 'fake').trim().toLowerCase();
  return [
    {
      key: 'onec',
      label: 'Обмен с 1С',
      enabled: oneCAdapter === 'rest',
      description:
        oneCAdapter === 'rest'
          ? 'Боевой обмен с 1С по сети включён.'
          : 'Работает тестовый (fake) адаптер — реальный обмен с 1С выключен.',
      envHint: 'вид адаптера и креды — в форме ниже',
    },
    {
      key: 'mango',
      label: 'Телефония (Mango Office)',
      enabled: isMangoTelephonyEnabled(),
      description: 'Приём звонков, запись разговоров и click-to-call через Mango Office.',
      envHint: 'включается в разделе «Функции платформы» + ключи в форме ниже',
    },
    {
      key: 'telegram',
      label: 'Telegram-бот',
      enabled: isTelegramEnabled(),
      description: 'Уведомления и вход через Telegram-бот.',
      envHint: 'токен и имя бота — в форме ниже',
    },
    {
      key: 'max',
      label: 'Max-бот',
      enabled: isMaxEnabled(),
      description: 'Уведомления через мессенджер Max.',
      envHint: 'FEATURE_MAX_CHANNEL=1 (на сервере) + токен и имя бота в форме ниже',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      enabled: isWhatsAppEnabled(),
      description: 'Входящие/исходящие сообщения WhatsApp через агрегатора.',
      envHint: 'FEATURE_WHATSAPP_CHANNEL=1 (на сервере) + ключи агрегатора в форме ниже',
    },
    {
      key: 'dadata',
      label: 'DaData (подсказки по ИНН)',
      enabled: isDadataEnabled(),
      description: 'Автозаполнение реквизитов организаций по названию/ИНН.',
      envHint: 'включение и ключ — в форме ниже',
    },
  ];
}

/**
 * Отметки проб «Проверить подключение» и входящих вебхуков (ФТ-14.3/14.4).
 *
 * Хранятся в `SyncState` под именами `integration.<key>` / `webhook.<name>`;
 * страница /admin/integrations передаёт список интересующих её имён.
 */
export async function listIntegrationSyncStates(
  prisma: PrismaClient,
  entities: string[]
): Promise<
  Array<{
    entity: string;
    lastRunAt: Date | null;
    lastSuccessAt: Date | null;
    lastError: string | null;
  }>
> {
  return prisma.syncState.findMany({
    where: { entity: { in: entities } },
    select: { entity: true, lastRunAt: true, lastSuccessAt: true, lastError: true },
  });
}
