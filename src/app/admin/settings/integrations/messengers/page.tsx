import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { isSecretsKeyConfigured } from '@/lib/crypto/secrets';
import { getIntegrationsHealth } from '@/lib/services/admin/integrationsHealth';
import { loadIntegrationDiagnostics } from '@/lib/services/admin/integrationDiagnostics';
import type { IntegrationTestKey } from '@/lib/services/admin/testIntegration';
import {
  getSettingsView,
  type SettingKey,
  type SettingViewRow,
} from '@/lib/config/integrationSettings';
import {
  MESSENGER_CHANNELS,
  MESSENGER_LABELS,
  isMessengerChannel,
  type MessengerChannel,
} from '@/lib/services/messengers/channels';
import { IntegrationsHealthPanel } from '@/components/admin/integrations-health-panel';
import { IntegrationSettingsForm } from '@/components/admin/integration-settings-form';
import { SecretsKeyNotice } from '@/components/admin/secrets-key-notice';
import {
  saveTelegramSettingsAction,
  saveMaxSettingsAction,
  saveWhatsappSettingsAction,
  testIntegrationAction,
} from '@/server-actions/admin/integrationSettings';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Подключение мессенджеров · Настройки' };

export const dynamic = 'force-dynamic';

const VIEW_KEYS: SettingKey[] = [
  'telegram.botToken',
  'telegram.botUsername',
  // `У-123`: индикатор «секрет вебхука задан» читает БАЗУ, а не переменную
  // сервера — иначе сгенерированный в интерфейсе секрет отображался бы как
  // «не задан».
  'telegram.webhookSecret',
  'max.botToken',
  'max.botUsername',
  'max.baseUrl',
  'max.webhookSecret',
  'whatsapp.apiKey',
  'whatsapp.channelId',
  'whatsapp.baseUrl',
  'whatsapp.webhookSecret',
];

/**
 * Как подключить — по шагам простыми словами (§15). У каждого мессенджера
 * свой путь: Telegram включается самим токеном, MAX и WhatsApp — ещё и
 * переключателем канала в состоянии выше.
 */
const STEPS: Record<MessengerChannel, string[]> = {
  telegram: [
    'Создайте бота у @BotFather в Telegram и скопируйте выданный токен.',
    'Введите имя бота и токен ниже, нажмите «Сохранить».',
    'Нажмите «Сгенерировать секрет», затем «Зарегистрировать вебхук» — Telegram начнёт присылать сообщения клиентов сюда.',
    'Нажмите «Проверить подключение». Канал включается сам, как только токен задан.',
  ],
  max: [
    'Создайте бота в MAX и получите его токен.',
    'Введите имя бота и токен ниже, нажмите «Сохранить».',
    'Нажмите «Сгенерировать секрет», затем «Зарегистрировать вебхук».',
    'Включите канал переключателем в состоянии выше и нажмите «Проверить подключение».',
  ],
  whatsapp: [
    'Заведите номер у сервиса-агрегатора (Wazzup-совместимый API) и получите API-ключ и ID канала.',
    'Введите ключ и ID канала ниже, нажмите «Сохранить».',
    'Нажмите «Сгенерировать секрет» и укажите адрес вебхука (он показан ниже) в кабинете агрегатора — API для регистрации у него нет.',
    'Включите канал переключателем в состоянии выше и нажмите «Проверить подключение».',
  ],
};

/**
 * «Подключение мессенджеров» (спека 2026-09-12, Р-М-6 / §5.3): Telegram, MAX
 * и WhatsApp подключаются как каналы переписки с клиентами — токен, вебхук,
 * проверка связи и включение, всё из интерфейса (§0.3 действующего ТЗ).
 * Формы переехали сюда с обзора «Интеграции»: один объект — одно место.
 */
export default async function AdminMessengersSettingsPage() {
  const session = await requireSettingsSection('integrations.messengers', 'admin');
  // Светофор праймит кэш настроек — остальное читает уже после него.
  const health = await getIntegrationsHealth(prisma, session);
  const [diag, view] = await Promise.all([
    loadIntegrationDiagnostics(prisma, MESSENGER_CHANNELS),
    getSettingsView(prisma, VIEW_KEYS),
  ]);

  const byKey = (k: SettingKey): SettingViewRow => view.find((r) => r.key === k)!;
  const secretProps = (k: SettingKey) => ({
    secretSet: byKey(k).isSet,
    secretSource: byKey(k).source,
    // `У-131`: кнопка «использовать значение сервера» появляется у секрета
    // ровно тогда, когда он задан здесь и перекрывает серверный.
    settingKey: k,
  });
  const testOf = (key: IntegrationTestKey) => testIntegrationAction.bind(null, key);
  const rows = health.ok ? health.rows.filter((r) => isMessengerChannel(r.key)) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Подключение мессенджеров"
        subtitle="Подключите Telegram, MAX и WhatsApp: токен, адрес вебхука и проверка связи — всё здесь, без доступа к серверу."
      />

      <SecretsKeyNotice ready={isSecretsKeyConfigured()} />

      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Приём сообщений и раздел «Мессенджеры» у менеджеров включаются переключателем «Мессенджеры»
        в разделе{' '}
        <Link href="/admin/settings/system/feature-flags" className="underline">
          «Функции платформы»
        </Link>
        . Секретные ключи хранятся в базе в зашифрованном виде.
      </div>

      {health.ok ? (
        <IntegrationsHealthPanel rows={rows} />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Недостаточно прав для просмотра состояния подключений.
        </p>
      )}

      <div className="space-y-6">
        <MessengerBlock channel="telegram">
          <IntegrationSettingsForm
            title="Telegram-бот"
            description="Переписка с клиентами, уведомления и привязка аккаунтов через Telegram. Токен выдаёт @BotFather."
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
            check={diag.checkOf('telegram')}
            webhook={diag.webhookOf(
              'telegram',
              'x-telegram-bot-api-secret-token',
              byKey('telegram.webhookSecret').isSet
            )}
          />
        </MessengerBlock>

        <MessengerBlock channel="max">
          <IntegrationSettingsForm
            title="MAX-бот"
            description="Переписка с клиентами и уведомления через мессенджер MAX."
            note="Канал включается переключателем в состоянии выше; здесь задаются только креды бота."
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
            check={diag.checkOf('max')}
            webhook={diag.webhookOf(
              'max',
              'x-max-webhook-secret',
              byKey('max.webhookSecret').isSet
            )}
          />
        </MessengerBlock>

        <MessengerBlock channel="whatsapp">
          <IntegrationSettingsForm
            title="WhatsApp (агрегатор)"
            description="Входящие и исходящие сообщения WhatsApp через сервис-агрегатор (Wazzup-совместимый API)."
            note="Канал включается переключателем в состоянии выше; здесь задаются ключи агрегатора."
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
            check={diag.checkOf('whatsapp')}
            webhook={diag.webhookOf(
              'whatsapp',
              'x-wazzup-secret',
              byKey('whatsapp.webhookSecret').isSet
            )}
          />
        </MessengerBlock>
      </div>
    </div>
  );
}

/** Блок одного мессенджера: заголовок, шаги подключения, форма. */
function MessengerBlock({
  channel,
  children,
}: {
  channel: MessengerChannel;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={MESSENGER_LABELS[channel]}>
      <div>
        <h2 className="text-base font-semibold text-[#111111]">{MESSENGER_LABELS[channel]}</h2>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-gray-600">
          {STEPS[channel].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      {children}
    </section>
  );
}
