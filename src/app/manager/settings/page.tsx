import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { getStaffInternalPhone } from '@/lib/services/manager/staffProfile';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { StaffBackupCodesSection } from '@/components/settings/staff-backup-codes-section';
import { SecurityCard } from '@/components/settings/security-card';
import { InternalPhoneCard } from '@/components/manager/settings/internal-phone-card';
import { PersonalSettings } from '@/components/settings/personal-settings';
import { readPersonalSettingsTab } from '@/lib/navigation/personalSettingsTab';
import { PERSONAL_SETTINGS_SUBTITLE } from '@/lib/navigation/personalSettings';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

/**
 * Личные настройки менеджера (`У-114`).
 *
 * Раньше это была одна длинная страница со всеми карточками подряд, а у
 * партнёра — четыре вкладки: один и тот же набор выглядел в двух кабинетах
 * по-разному. Теперь экран общий, вкладки из реестра, а данные грузятся
 * **только для открытой вкладки**.
 */
export default async function ManagerSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireManager();
  const tab = readPersonalSettingsTab((await searchParams).tab);

  const profile =
    tab === 'profile'
      ? {
          telegram: await getTelegramStatus(prisma, session),
          internalPhone: await getStaffInternalPhone(prisma, session),
        }
      : null;
  const notifications =
    tab === 'notifications' ? await getNotificationSettings(prisma, session) : null;

  return (
    <div className="space-y-4">
      <PageHeader title="Настройки" subtitle={PERSONAL_SETTINGS_SUBTITLE} />
      <PersonalSettings
        basePath="/manager/settings"
        activeTab={tab}
        slots={{
          profile: profile ? (
            <>
              <TelegramLinkCard status={profile.telegram} />
              <InternalPhoneCard initialInternalPhone={profile.internalPhone} />
            </>
          ) : null,
          notifications: notifications ? (
            <NotificationChannelsCard settings={notifications.view} />
          ) : null,
          security: (
            <>
              {isFeatureEnabled('staff_2fa') ? <StaffBackupCodesSection /> : null}
              <SecurityCard />
            </>
          ),
        }}
      />
    </div>
  );
}
