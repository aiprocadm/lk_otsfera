import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { StaffBackupCodesSection } from '@/components/settings/staff-backup-codes-section';

export default async function AdminSettingsPage() {
  const session = await requireAdmin();
  const status = await getTelegramStatus(prisma, session);
  const settings = await getNotificationSettings(prisma, session);

  return (
    <div className='space-y-6'>
      <h1 className='text-2xl font-bold text-[#111111]'>Настройки</h1>
      <div className='text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3'>
        <span aria-hidden className='mr-1'>ℹ️</span>
        Здесь — только ваши личные настройки уведомлений. Интеграции платформы
        (телефония Mango, боты Telegram/Max/WhatsApp) настраиваются администратором
        сервера в конфигурации при установке, а не через этот интерфейс.
      </div>
      <TelegramLinkCard status={status} />
      <NotificationChannelsCard settings={settings.view} />
      {isFeatureEnabled('staff_2fa') ? <StaffBackupCodesSection /> : null}
    </div>
  );
}
