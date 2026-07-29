import React from 'react';
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { StaffBackupCodesSection } from '@/components/settings/staff-backup-codes-section';
import { SecurityCard } from '@/components/settings/security-card';

export default async function LeaderSettingsPage() {
  const session = await requireManagerLeader();
  const status = await getTelegramStatus(prisma, session);
  const settings = await getNotificationSettings(prisma, session);

  return (
    <div className='space-y-6'>
      <h1 className='text-2xl font-bold text-[#111111]'>Настройки</h1>
      <TelegramLinkCard status={status} />
      <NotificationChannelsCard settings={settings.view} />
      {isFeatureEnabled('staff_2fa') ? <StaffBackupCodesSection /> : null}
      {/* §11 ТЗ v0.5: настройку доп-полей ведёт и руководитель. */}
      <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-2'>
        <h2 className='text-sm font-semibold text-[#111111]'>Настраиваемые поля</h2>
        <p className='text-sm text-gray-500'>
          Дополнительные поля карточек: заявка, организация, партнёр, сотрудник, документ.
        </p>
        <Link
          href='/leader/settings/custom-fields'
          className='inline-block text-sm font-medium text-[#F97316] hover:text-[#EA580C]'
        >
          Открыть настройку полей →
        </Link>
      </div>
      <SecurityCard />
    </div>
  );
}
