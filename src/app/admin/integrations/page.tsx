import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { getIntegrationsStatus } from '@/lib/services/admin/integrations';
import { prisma } from '@/lib/db/prisma';
import { getSettingsView, type SettingKey, type SettingViewRow } from '@/lib/config/integrationSettings';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { EmailSettingsForm } from '@/components/admin/email-settings-form';
import { IntegrationSettingsForm } from '@/components/admin/integration-settings-form';
import {
  saveTelegramSettingsAction,
  saveMaxSettingsAction,
  saveWhatsappSettingsAction,
  saveMangoSettingsAction,
  saveImapSettingsAction
} from '@/server-actions/admin/integrationSettings';

export const dynamic = 'force-dynamic';

const VIEW_KEYS: SettingKey[] = [
  'email.enabled',
  'email.from',
  'email.resendApiKey',
  'telegram.botToken',
  'telegram.botUsername',
  'max.botToken',
  'max.botUsername',
  'whatsapp.apiKey',
  'whatsapp.channelId',
  'mango.apiKey',
  'mango.apiSalt',
  'mango.vpbxBaseUrl',
  'imap.adapter',
  'imap.host',
  'imap.port',
  'imap.user',
  'imap.password',
  'imap.tls'
];

export default async function AdminIntegrationsPage() {
  await requireAdmin();
  // Статус-панель читает креды через кэш настроек — праймим до вызова.
  await primeIntegrationSettingsCache(prisma);
  const integrations = getIntegrationsStatus();

  const view = await getSettingsView(prisma, VIEW_KEYS);
  const byKey = (k: SettingKey): SettingViewRow => view.find((r) => r.key === k)!;
  const emailEnabled = byKey('email.enabled').value?.trim().toLowerCase() === 'true';
  const emailFrom = byKey('email.from').value ?? '';
  const apiKeyRow = byKey('email.resendApiKey');
  const imapTls = (byKey('imap.tls').value ?? '1').trim().toLowerCase();

  const secretProps = (k: SettingKey) => ({
    secretSet: byKey(k).isSet,
    secretSource: byKey(k).source
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Интеграции</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Статус внешних сервисов платформы: телефония, мессенджеры и обмен с 1С.
        </p>
      </div>

      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">ℹ️</span>
        Секретные ключи хранятся в базе в зашифрованном виде. Если параметр задан
        в конфиге сервера (env), он используется как запасной вариант, пока не
        задан здесь.
      </div>

      <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
        {integrations.map((it) => (
          <li key={it.key} className="px-4 py-3.5 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[#111111] text-sm">{it.label}</span>
                {it.enabled ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                    Подключено
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                    Не настроено
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{it.description}</div>
              <div className="text-xs text-gray-400 mt-1 font-mono">{it.envHint}</div>
            </div>
          </li>
        ))}
      </ul>

      <div className="pt-2 space-y-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Настройки</h2>
        <EmailSettingsForm
          initialEnabled={emailEnabled}
          initialFrom={emailFrom}
          apiKeySet={apiKeyRow.isSet}
          apiKeySource={apiKeyRow.source}
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
              placeholder: 'otsfera_bot'
            },
            {
              name: 'telegram_botToken',
              label: 'Токен бота',
              kind: 'secret',
              placeholder: '123456:ABC-…',
              ...secretProps('telegram.botToken')
            }
          ]}
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
              initialValue: byKey('max.botUsername').value ?? ''
            },
            {
              name: 'max_botToken',
              label: 'Токен бота',
              kind: 'secret',
              ...secretProps('max.botToken')
            }
          ]}
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
              ...secretProps('whatsapp.apiKey')
            },
            {
              name: 'whatsapp_channelId',
              label: 'ID канала (подключённый номер)',
              kind: 'secret',
              ...secretProps('whatsapp.channelId')
            }
          ]}
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
              placeholder: 'https://app.mango-office.ru/vpbx/'
            },
            {
              name: 'mango_apiKey',
              label: 'API-ключ (vpbx_api_key)',
              kind: 'secret',
              ...secretProps('mango.apiKey')
            },
            {
              name: 'mango_apiSalt',
              label: 'Соль подписи (api_salt)',
              kind: 'secret',
              ...secretProps('mango.apiSalt')
            }
          ]}
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
                { value: 'imap', label: 'IMAP-ящик' }
              ]
            },
            {
              name: 'imap_host',
              label: 'Сервер (host)',
              kind: 'text',
              initialValue: byKey('imap.host').value ?? '',
              placeholder: 'imap.yandex.ru'
            },
            {
              name: 'imap_port',
              label: 'Порт',
              kind: 'text',
              initialValue: byKey('imap.port').value ?? '',
              placeholder: '993'
            },
            {
              name: 'imap_user',
              label: 'Логин',
              kind: 'text',
              initialValue: byKey('imap.user').value ?? ''
            },
            {
              name: 'imap_password',
              label: 'Пароль',
              kind: 'secret',
              ...secretProps('imap.password')
            },
            {
              name: 'imap_tls',
              label: 'Использовать TLS (шифрованное соединение)',
              kind: 'checkbox',
              initialChecked: imapTls !== '0' && imapTls !== 'false' && imapTls !== 'off'
            }
          ]}
        />
      </div>
    </div>
  );
}
