import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getIntegrationsHealth } from '@/lib/services/admin/integrationsHealth';
import { loadIntegrationDiagnostics } from '@/lib/services/admin/integrationDiagnostics';
import { IntegrationsHealthPanel } from '@/components/admin/integrations-health-panel';
import { prisma } from '@/lib/db/prisma';
import { isSecretsKeyConfigured } from '@/lib/crypto/secrets';
import { settingsSectionHref } from '@/lib/navigation/settings';
import {
  getSettingsView,
  type SettingKey,
  type SettingViewRow,
} from '@/lib/config/integrationSettings';
import { EmailSettingsForm } from '@/components/admin/email-settings-form';
import { IntegrationSettingsForm } from '@/components/admin/integration-settings-form';
import { SecretsKeyNotice } from '@/components/admin/secrets-key-notice';
import {
  saveMangoSettingsAction,
  saveImapSettingsAction,
  saveOnecSettingsAction,
  saveDadataSettingsAction,
  testIntegrationAction,
} from '@/server-actions/admin/integrationSettings';
import type { IntegrationTestKey } from '@/lib/services/admin/testIntegration';

import { PageHeader } from '@/components/ui/page-header';
export const metadata: Metadata = { title: 'Интеграции · Настройки' };

export const dynamic = 'force-dynamic';

const VIEW_KEYS: SettingKey[] = [
  'email.enabled',
  'email.from',
  'email.resendApiKey',
  'mango.apiKey',
  'mango.apiSalt',
  'mango.vpbxBaseUrl',
  // `У-124`: адаптер, разрешённые адреса и задержка поллинга — поля формы.
  'mango.adapter',
  'mango.allowedIps',
  'mango.statsPollDelayMs',
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

export default async function AdminIntegrationsPage() {
  const session = await requireSettingsSection('integrations.overview', 'admin');
  // `У-70`: светофор состояния собирается в сервисе (там же — переключатели
  // каналов для `У-69`). Кэш настроек праймится внутри.
  const health = await getIntegrationsHealth(prisma, session);

  // ФТ-14.3/14.4: результаты проб «Проверить подключение» и отметки вебхуков.
  // Мессенджеры (спека 2026-09-12, Р-М-6) живут в своём разделе — здесь из
  // вебхуков остаётся только телефония.
  const diag = await loadIntegrationDiagnostics(prisma, ['mango']);
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

  const messengersHref = settingsSectionHref('integrations.messengers', 'admin');

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
      <SecretsKeyNotice ready={secretsKeyReady} />

      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Секретные ключи хранятся в базе в зашифрованном виде. Если параметр задан в конфиге сервера
        (env), он используется как запасной вариант, пока не задан здесь.
      </div>

      {health.ok ? (
        <IntegrationsHealthPanel
          rows={health.rows}
          // `У-174`: список «не выгружен» — фильтр у админа живёт на вкладке
          // «Общие» (вкладка «По заказам» пока на прежней панели, план PR-5).
          failedDocumentsHref="/admin/documents?tab=general&oneCPushStatus=failed"
        />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Недостаточно прав для просмотра состояния интеграций.
        </p>
      )}

      <div className="pt-2 space-y-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Настройки
        </h2>

        {/* Спека 2026-09-12 (Р-М-6): токены ботов, вебхуки и проверка связи
            мессенджеров — в своём разделе, здесь только дорога к нему. */}
        {messengersHref && (
          <Link
            href={messengersHref}
            className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-orange-500"
          >
            <p className="text-sm font-semibold text-[#111111]">📱 Подключение мессенджеров →</p>
            <p className="mt-1 text-sm text-gray-600">
              Telegram, MAX и WhatsApp как каналы переписки с клиентами: токены ботов, адреса
              вебхуков, проверка связи и включение каналов.
            </p>
          </Link>
        )}

        <EmailSettingsForm
          initialEnabled={emailEnabled}
          initialFrom={emailFrom}
          apiKeySet={apiKeyRow.isSet}
          apiKeySource={apiKeyRow.source}
          testAction={testOf('email')}
          check={diag.checkOf('email')}
        />

        <IntegrationSettingsForm
          title="Телефония Mango Office"
          description="Ключи VPBX API: подпись вебхуков, записи разговоров, click-to-call."
          note="Телефония включается переключателем в разделе «Функции платформы» — заходить на сервер не нужно."
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
            {
              name: 'mango_adapter',
              label: 'Адаптер',
              kind: 'select',
              initialValue: (byKey('mango.adapter').value ?? 'fake').trim().toLowerCase(),
              settingKey: 'mango.adapter',
              source: byKey('mango.adapter').source,
              options: [
                { value: 'fake', label: 'Тестовый (без обращений к Mango)' },
                { value: 'rest', label: 'Боевой REST' },
              ],
            },
            {
              name: 'mango_allowedIps',
              label: 'Разрешённые адреса вебхука (через запятую)',
              kind: 'text',
              initialValue: byKey('mango.allowedIps').value ?? '',
              settingKey: 'mango.allowedIps',
              source: byKey('mango.allowedIps').source,
              placeholder: '81.88.80.132,81.88.80.133,81.88.82.36',
            },
            {
              name: 'mango_statsPollDelayMs',
              label: 'Задержка между опросами статистики, мс',
              kind: 'text',
              initialValue: byKey('mango.statsPollDelayMs').value ?? '',
              settingKey: 'mango.statsPollDelayMs',
              source: byKey('mango.statsPollDelayMs').source,
              placeholder: '3000',
            },
          ]}
          testAction={testOf('mango')}
          check={diag.checkOf('mango')}
          webhook={diag.webhookOf(
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
          check={diag.checkOf('imap')}
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
          check={diag.checkOf('onec')}
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
          check={diag.checkOf('dadata')}
        />
      </div>
    </div>
  );
}
