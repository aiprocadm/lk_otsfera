import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listIntegrationSyncStates } from '@/lib/services/admin/integrations';
import { getIntegrationsHealth } from '@/lib/services/admin/integrationsHealth';
import { IntegrationsHealthPanel } from '@/components/admin/integrations-health-panel';
import { prisma } from '@/lib/db/prisma';
import { isSecretsKeyConfigured } from '@/lib/crypto/secrets';
import {
  getSettingsView,
  type SettingKey,
  type SettingViewRow,
} from '@/lib/config/integrationSettings';
import { EmailSettingsForm } from '@/components/admin/email-settings-form';
import {
  IntegrationSettingsForm,
  type IntegrationCheckInfo,
  type WebhookDiagInfo,
} from '@/components/admin/integration-settings-form';
import {
  saveTelegramSettingsAction,
  saveMaxSettingsAction,
  saveWhatsappSettingsAction,
  saveMangoSettingsAction,
  saveImapSettingsAction,
  saveOnecSettingsAction,
  saveDadataSettingsAction,
  testIntegrationAction,
} from '@/server-actions/admin/integrationSettings';
import {
  INTEGRATION_TEST_KEYS,
  type IntegrationTestKey,
} from '@/lib/services/admin/testIntegration';
import { getAppBaseUrl } from '@/lib/notifications/shared';
import { fmtDateTime } from '@/lib/format';

import { PageHeader } from '@/components/ui/page-header';
export const metadata: Metadata = { title: 'Интеграции · Настройки' };

export const dynamic = 'force-dynamic';

const VIEW_KEYS: SettingKey[] = [
  'email.enabled',
  'email.from',
  'email.resendApiKey',
  'telegram.botToken',
  'telegram.botUsername',
  'max.botToken',
  'max.botUsername',
  'max.baseUrl',
  'whatsapp.apiKey',
  'whatsapp.channelId',
  'whatsapp.baseUrl',
  'mango.apiKey',
  'mango.apiSalt',
  'mango.vpbxBaseUrl',
  'imap.adapter',
  'imap.host',
  'imap.port',
  'imap.user',
  'imap.password',
  'imap.tls',
  'onec.adapter',
  'onec.apiUrl',
  'onec.apiToken',
  'onec.healthPath',
  'dadata.enabled',
  'dadata.apiKey',
];

const WEBHOOK_NAMES = ['telegram', 'max', 'whatsapp', 'mango'] as const;

export default async function AdminIntegrationsPage() {
  const session = await requireSettingsSection('integrations.overview', 'admin');
  // `У-70`: светофор состояния собирается в сервисе (там же — переключатели
  // каналов для `У-69`). Кэш настроек праймится внутри.
  const health = await getIntegrationsHealth(prisma, session);

  // ФТ-14.3/14.4: результаты проб «Проверить подключение» и отметки вебхуков.
  const syncStates = await listIntegrationSyncStates(prisma, [
    ...INTEGRATION_TEST_KEYS.map((k) => `integration.${k}`),
    ...WEBHOOK_NAMES.map((n) => `webhook.${n}`),
  ]);
  const stateOf = (entity: string) => syncStates.find((s) => s.entity === entity);

  const checkOf = (key: IntegrationTestKey): IntegrationCheckInfo | null => {
    const s = stateOf(`integration.${key}`);
    if (!s?.lastRunAt) return null;
    const lastOk = !!s.lastSuccessAt && s.lastRunAt.getTime() === s.lastSuccessAt.getTime();
    return {
      lastAt: fmtDateTime(s.lastRunAt),
      lastOk,
      lastError: s.lastError,
    };
  };

  const appUrl = getAppBaseUrl();
  const webhookOf = (
    name: (typeof WEBHOOK_NAMES)[number],
    headerName: string | null,
    secretSet: boolean,
    note?: string
  ): WebhookDiagInfo => {
    const s = stateOf(`webhook.${name}`);
    return {
      url: `${appUrl}/api/integrations/${name}/webhook`,
      headerName,
      secretSet,
      lastEventAt: s?.lastSuccessAt ? fmtDateTime(s.lastSuccessAt) : null,
      note,
    };
  };
  const testOf = (key: IntegrationTestKey) => testIntegrationAction.bind(null, key);

  // `У-132`: состояние мастер-ключа считается один раз и на сервере — форма
  // узнаёт о нём до того, как человек начнёт вводить секреты.
  const secretsKeyReady = isSecretsKeyConfigured();
  const view = await getSettingsView(prisma, VIEW_KEYS);
  const byKey = (k: SettingKey): SettingViewRow => view.find((r) => r.key === k)!;
  const emailEnabled = byKey('email.enabled').value?.trim().toLowerCase() === 'true';
  const emailFrom = byKey('email.from').value ?? '';
  const apiKeyRow = byKey('email.resendApiKey');
  const imapTls = (byKey('imap.tls').value ?? '1').trim().toLowerCase();
  const dadataEnabled = byKey('dadata.enabled').value?.trim().toLowerCase() === 'true';
  const onecAdapter = (byKey('onec.adapter').value ?? 'fake').trim().toLowerCase();

  const secretProps = (k: SettingKey) => ({
    secretSet: byKey(k).isSet,
    secretSource: byKey(k).source,
    // `У-131`: кнопка «использовать значение сервера» появляется у секрета
    // ровно тогда, когда он задан здесь и перекрывает серверный.
    settingKey: k,
  });

  return (
    <div className="space-y-5">
      <div>
        <PageHeader
          title="Интеграции"
          subtitle="Статус внешних сервисов платформы: телефония, мессенджеры и обмен с 1С."
        />
      </div>

      {/* `У-132` (дефект `Д-36`): предупреждение стоит ДО форм. Раньше об
          отсутствии ключа человек узнавал только нажав «Сохранить» — то есть
          заполнив форму секретами впустую. */}
      {secretsKeyReady ? null : (
        <div
          role="alert"
          className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-4 py-3"
        >
          <span aria-hidden className="mr-1">
            ⚠️
          </span>
          <strong>Сохранение секретов недоступно:</strong> на сервере не задан ключ шифрования (
          <code>APP_ENCRYPTION_KEY</code>). Несекретные поля сохранить можно, секретные — нет.
          Задайте ключ в конфиге сервера и перезапустите приложение.
        </div>
      )}

      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Секретные ключи хранятся в базе в зашифрованном виде. Если параметр задан в конфиге сервера
        (env), он используется как запасной вариант, пока не задан здесь.
      </div>

      {health.ok ? (
        <IntegrationsHealthPanel rows={health.rows} />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Недостаточно прав для просмотра состояния интеграций.
        </p>
      )}

      <div className="pt-2 space-y-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Настройки
        </h2>
        <EmailSettingsForm
          initialEnabled={emailEnabled}
          initialFrom={emailFrom}
          apiKeySet={apiKeyRow.isSet}
          apiKeySource={apiKeyRow.source}
          testAction={testOf('email')}
          check={checkOf('email')}
        />

        <IntegrationSettingsForm
          title="Telegram-бот"
          description="Уведомления и привязка аккаунтов через Telegram. Токен выдаёт @BotFather."
          action={saveTelegramSettingsAction}
          fields={[
            {
              name: 'telegram_botUsername',
              label: 'Имя бота (username, без @)',
              kind: 'text',
              initialValue: byKey('telegram.botUsername').value ?? '',
              settingKey: 'telegram.botUsername',
              source: byKey('telegram.botUsername').source,
              placeholder: 'otsfera_bot',
            },
            {
              name: 'telegram_botToken',
              label: 'Токен бота',
              kind: 'secret',
              placeholder: '123456:ABC-…',
              ...secretProps('telegram.botToken'),
            },
          ]}
          testAction={testOf('telegram')}
          check={checkOf('telegram')}
          webhook={webhookOf(
            'telegram',
            'x-telegram-bot-api-secret-token',
            !!process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
          )}
        />

        <IntegrationSettingsForm
          title="Max-бот"
          description="Уведомления через мессенджер Max."
          note="Канал включается флагом FEATURE_MAX_CHANNEL=1 в конфиге сервера; здесь задаются только креды бота."
          action={saveMaxSettingsAction}
          fields={[
            {
              name: 'max_botUsername',
              label: 'Имя бота (username)',
              kind: 'text',
              initialValue: byKey('max.botUsername').value ?? '',
              settingKey: 'max.botUsername',
              source: byKey('max.botUsername').source,
            },
            {
              name: 'max_botToken',
              label: 'Токен бота',
              kind: 'secret',
              ...secretProps('max.botToken'),
            },
            {
              name: 'max_baseUrl',
              label: 'Базовый URL API (необязательно)',
              kind: 'text',
              initialValue: byKey('max.baseUrl').value ?? '',
              settingKey: 'max.baseUrl',
              source: byKey('max.baseUrl').source,
              placeholder: 'https://botapi.max.ru',
            },
          ]}
          testAction={testOf('max')}
          check={checkOf('max')}
          webhook={webhookOf(
            'max',
            'x-max-webhook-secret',
            !!process.env.MAX_WEBHOOK_SECRET?.trim()
          )}
        />

        <IntegrationSettingsForm
          title="WhatsApp (агрегатор)"
          description="Входящие и исходящие сообщения WhatsApp через сервис-агрегатор (Wazzup-совместимый API)."
          note="Канал включается флагом FEATURE_WHATSAPP_CHANNEL=1 в конфиге сервера; здесь задаются ключи агрегатора."
          action={saveWhatsappSettingsAction}
          fields={[
            {
              name: 'whatsapp_apiKey',
              label: 'API-ключ агрегатора',
              kind: 'secret',
              ...secretProps('whatsapp.apiKey'),
            },
            {
              name: 'whatsapp_channelId',
              label: 'ID канала (подключённый номер)',
              kind: 'secret',
              ...secretProps('whatsapp.channelId'),
            },
            {
              name: 'whatsapp_baseUrl',
              label: 'Базовый URL агрегатора (необязательно)',
              kind: 'text',
              initialValue: byKey('whatsapp.baseUrl').value ?? '',
              settingKey: 'whatsapp.baseUrl',
              source: byKey('whatsapp.baseUrl').source,
              placeholder: 'https://api.wazzup24.com',
            },
          ]}
          testAction={testOf('whatsapp')}
          check={checkOf('whatsapp')}
          webhook={webhookOf(
            'whatsapp',
            'x-wazzup-secret',
            !!process.env.WHATSAPP_WEBHOOK_SECRET?.trim()
          )}
        />

        <IntegrationSettingsForm
          title="Телефония Mango Office"
          description="Ключи VPBX API: подпись вебхуков, записи разговоров, click-to-call."
          note="Телефония включается флагом FEATURE_TELEPHONY_MANGO=1 в конфиге сервера (гейт страниц не читает базу); здесь задаются ключи."
          action={saveMangoSettingsAction}
          fields={[
            {
              name: 'mango_vpbxBaseUrl',
              label: 'Базовый URL VPBX API',
              kind: 'text',
              initialValue: byKey('mango.vpbxBaseUrl').value ?? '',
              settingKey: 'mango.vpbxBaseUrl',
              source: byKey('mango.vpbxBaseUrl').source,
              placeholder: 'https://app.mango-office.ru/vpbx/',
            },
            {
              name: 'mango_apiKey',
              label: 'API-ключ (vpbx_api_key)',
              kind: 'secret',
              ...secretProps('mango.apiKey'),
            },
            {
              name: 'mango_apiSalt',
              label: 'Соль подписи (api_salt)',
              kind: 'secret',
              ...secretProps('mango.apiSalt'),
            },
          ]}
          testAction={testOf('mango')}
          check={checkOf('mango')}
          webhook={webhookOf(
            'mango',
            null,
            byKey('mango.apiKey').isSet && byKey('mango.apiSalt').isSet,
            'Запросы аутентифицируются подписью по ключам API и IP-адресами Mango — отдельный секрет-заголовок не нужен.'
          )}
        />

        <IntegrationSettingsForm
          title="Входящая почта (IMAP)"
          description="Приём писем клиентов в омниканальный инбокс: воркер опрашивает ящик по IMAP."
          action={saveImapSettingsAction}
          fields={[
            {
              name: 'imap_adapter',
              label: 'Источник',
              kind: 'select',
              initialValue: (byKey('imap.adapter').value ?? 'fake').trim().toLowerCase(),
              options: [
                { value: 'fake', label: 'Отключено (тестовый режим)' },
                { value: 'imap', label: 'IMAP-ящик' },
              ],
            },
            {
              name: 'imap_host',
              label: 'Сервер (host)',
              kind: 'text',
              initialValue: byKey('imap.host').value ?? '',
              settingKey: 'imap.host',
              source: byKey('imap.host').source,
              placeholder: 'imap.yandex.ru',
            },
            {
              name: 'imap_port',
              label: 'Порт',
              kind: 'text',
              initialValue: byKey('imap.port').value ?? '',
              settingKey: 'imap.port',
              source: byKey('imap.port').source,
              placeholder: '993',
            },
            {
              name: 'imap_user',
              label: 'Логин',
              kind: 'text',
              initialValue: byKey('imap.user').value ?? '',
              settingKey: 'imap.user',
              source: byKey('imap.user').source,
            },
            {
              name: 'imap_password',
              label: 'Пароль',
              kind: 'secret',
              ...secretProps('imap.password'),
            },
            {
              name: 'imap_tls',
              label: 'Использовать TLS (шифрованное соединение)',
              kind: 'checkbox',
              initialChecked: imapTls !== '0' && imapTls !== 'false' && imapTls !== 'off',
            },
          ]}
          testAction={testOf('imap')}
          check={checkOf('imap')}
        />

        <IntegrationSettingsForm
          title="Обмен с 1С"
          description="Синхронизация организаций, заказов, оплат и документов, отправка заявок в 1С."
          note="Тюнинг обмена (режим, таймауты, курсор) остаётся в конфиге сервера — здесь только адрес, токен и вид адаптера."
          action={saveOnecSettingsAction}
          fields={[
            {
              name: 'onec_adapter',
              label: 'Адаптер',
              kind: 'select',
              initialValue: onecAdapter === 'rest' ? 'rest' : 'fake',
              options: [
                { value: 'fake', label: 'Отключено (тестовый режим)' },
                { value: 'rest', label: 'Боевой обмен по сети (REST)' },
              ],
            },
            {
              name: 'onec_apiUrl',
              label: 'Адрес API 1С',
              kind: 'text',
              initialValue: byKey('onec.apiUrl').value ?? '',
              settingKey: 'onec.apiUrl',
              source: byKey('onec.apiUrl').source,
              placeholder: 'https://1c.example.ru/base/hs/exchange/',
            },
            {
              name: 'onec_healthPath',
              label: 'Путь для проверки связи (необязательно)',
              kind: 'text',
              initialValue: byKey('onec.healthPath').value ?? '',
              settingKey: 'onec.healthPath',
              source: byKey('onec.healthPath').source,
              placeholder: 'health',
            },
            {
              name: 'onec_apiToken',
              label: 'Токен доступа',
              kind: 'secret',
              ...secretProps('onec.apiToken'),
            },
          ]}
          testAction={testOf('onec')}
          check={checkOf('onec')}
        />

        <IntegrationSettingsForm
          title="DaData (подсказки по ИНН)"
          description="Автозаполнение реквизитов организаций по названию или ИНН. Ключ хранится на сервере и в браузер не передаётся."
          action={saveDadataSettingsAction}
          fields={[
            {
              name: 'dadata_enabled',
              label: 'Включить подсказки DaData',
              kind: 'checkbox',
              initialChecked: dadataEnabled,
            },
            {
              name: 'dadata_apiKey',
              label: 'API-ключ DaData',
              kind: 'secret',
              ...secretProps('dadata.apiKey'),
            },
          ]}
          testAction={testOf('dadata')}
          check={checkOf('dadata')}
        />
      </div>
    </div>
  );
}
