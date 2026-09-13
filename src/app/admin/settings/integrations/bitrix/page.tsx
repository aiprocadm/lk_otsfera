import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { isSecretsKeyConfigured } from '@/lib/crypto/secrets';
import {
  getSettingsView,
  type SettingKey,
  type SettingViewRow,
} from '@/lib/config/integrationSettings';
import { loadIntegrationDiagnostics } from '@/lib/services/admin/integrationDiagnostics';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { IntegrationSettingsForm } from '@/components/admin/integration-settings-form';
import { SecretsKeyNotice } from '@/components/admin/secrets-key-notice';
import { PageHeader } from '@/components/ui/page-header';
import {
  saveBitrixConnectionAction,
  testBitrixConnectionAction,
} from '@/server-actions/admin/bitrix';

export const metadata: Metadata = { title: 'Миграция из Битрикс24 · Настройки' };

export const dynamic = 'force-dynamic';

const VIEW_KEYS: SettingKey[] = [
  'bitrix.portalUrl',
  'bitrix.webhookUrl',
  'bitrix.defaultManagerId',
];

const STEPS = [
  'В Битрикс24 откройте «Разработчикам → Другое → Входящий вебхук», отметьте права CRM, задачи, диск и пользователи, скопируйте адрес вебхука.',
  'Вставьте адрес портала и вебхук ниже, выберите менеджера по умолчанию (ему достанутся записи, чей ответственный в Битриксе не сопоставлен) и нажмите «Сохранить».',
  'Нажмите «Проверить подключение» — увидите домен портала и имя пользователя вебхука.',
  'Включите «Миграция из Битрикс24» в «Функциях платформы» и создайте первый пакет на вкладке «Пакеты».',
];

/**
 * «Подключение» (этап 2 ТЗ 12.09.2026, `У-188`, `У-199`): адрес портала,
 * входящий вебхук (секрет — на экране только «задан / не задан»), менеджер по
 * умолчанию и проба подключения. Таблица сопоставления пользователей заполняется
 * на предпросмотре пакета и сохраняется в `bitrix.userMap` сама.
 */
export default async function AdminBitrixSettingsPage() {
  const session = await requireSettingsSection('integrations.bitrix', 'admin');
  const [view, diag, managers] = await Promise.all([
    getSettingsView(prisma, VIEW_KEYS),
    loadIntegrationDiagnostics(prisma, []),
    session.companyId ? listCompanyManagers(prisma, session.companyId) : Promise.resolve([]),
  ]);
  const byKey = (k: SettingKey): SettingViewRow => view.find((r) => r.key === k)!;
  const managerOptions = managers
    .filter((m) => m.isActive)
    .map((m) => ({ value: m.id, label: `${m.name} (${m.email})` }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Миграция из Битрикс24"
        subtitle="Подключите портал по входящему вебхуку, проверьте связь — и переносите данные пакетами с предпросмотром, отчётом и откатом."
      />

      <SecretsKeyNotice ready={isSecretsKeyConfigured()} />

      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <p className="font-medium mb-1">Как подключить</p>
        <ol className="list-decimal pl-5 space-y-0.5">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-2">
          Раздел работает, когда включена функция «Миграция из Битрикс24» в{' '}
          <Link href="/admin/settings/system/feature-flags" className="underline">
            «Функциях платформы»
          </Link>
          . Вебхук хранится в базе в зашифрованном виде; в журналах остаётся только домен портала.
        </p>
      </div>

      <IntegrationSettingsForm
        title="Портал Битрикс24"
        description="Адрес портала и входящий вебхук с правами CRM, задач, диска и пользователей."
        {...(managerOptions.length === 0
          ? {
              note: session.companyId
                ? 'Менеджер по умолчанию появится, когда в вашей компании будут активные менеджеры.'
                : 'У вашей учётной записи нет компании — менеджер по умолчанию выбирается из компании администратора. Обратитесь к владельцу платформы.',
            }
          : {})}
        action={saveBitrixConnectionAction}
        fields={[
          {
            name: 'bitrix_portalUrl',
            label: 'Адрес портала',
            kind: 'text',
            initialValue: byKey('bitrix.portalUrl').value ?? '',
            settingKey: 'bitrix.portalUrl',
            source: byKey('bitrix.portalUrl').source,
            placeholder: 'company.bitrix24.ru',
          },
          {
            name: 'bitrix_webhookUrl',
            label: 'Входящий вебхук',
            kind: 'secret',
            placeholder: 'https://company.bitrix24.ru/rest/1/abcdef…/',
            secretSet: byKey('bitrix.webhookUrl').isSet,
            secretSource: byKey('bitrix.webhookUrl').source,
            settingKey: 'bitrix.webhookUrl',
          },
          {
            name: 'bitrix_defaultManagerId',
            label: 'Менеджер по умолчанию',
            kind: 'select',
            initialValue: byKey('bitrix.defaultManagerId').value ?? '',
            settingKey: 'bitrix.defaultManagerId',
            source: byKey('bitrix.defaultManagerId').source,
            options: [{ value: '', label: '— не выбран —' }, ...managerOptions],
          },
        ]}
        testAction={testBitrixConnectionAction}
        check={diag.checkOf('bitrix')}
      />
    </div>
  );
}
