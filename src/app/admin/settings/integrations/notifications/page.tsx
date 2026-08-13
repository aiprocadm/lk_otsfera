import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';

export const metadata: Metadata = { title: 'Каналы уведомлений · Настройки' };

/**
 * Личные каналы уведомлений сотрудника: привязка Telegram и выбор событий.
 * Переехало с общей страницы настроек в хаб (ТЗ 2026-08-04 §3.1), логика та же.
 * Настройка самих адаптеров платформы — соседний раздел «Интеграции».
 */
export default async function AdminNotificationChannelsPage() {
  const session = await requireSettingsSection('integrations.notifications', 'admin');
  const status = await getTelegramStatus(prisma, session);
  const settings = await getNotificationSettings(prisma, session);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#111111]">Каналы уведомлений</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">
        Какими каналами система сообщает людям о событиях
      </p>
      <TelegramLinkCard status={status} />
      <NotificationChannelsCard settings={settings.view} />
    </div>
  );
}
