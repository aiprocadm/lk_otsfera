import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { StaffBackupCodesSection } from '@/components/settings/staff-backup-codes-section';
import { SecurityCard } from '@/components/settings/security-card';
import { InternalPhoneCard } from '@/components/manager/settings/internal-phone-card';

export default async function ManagerSettingsPage() {
  const session = await requireManager();
  const status = await getTelegramStatus(prisma, session);
  const settings = await getNotificationSettings(prisma, session);
  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { internalPhone: true } });

  return (
    <div className='space-y-6'>
      <h1 className='text-2xl font-bold text-[#111111]'>Настройки</h1>
      <TelegramLinkCard status={status} />
      <NotificationChannelsCard settings={settings.view} />
      <InternalPhoneCard initialInternalPhone={me?.internalPhone ?? null} />
      {isFeatureEnabled('staff_2fa') ? <StaffBackupCodesSection /> : null}
      <SecurityCard />
    </div>
  );
}