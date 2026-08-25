import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
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
import type { SettingsCabinet } from '@/lib/navigation/settings';
import { isManagerLeader } from '@/lib/auth/roleModel';

/**
 * Раздел хаба «Личные настройки» (`У-114`) — общий для админа и руководителя.
 *
 * Раньше это были два разных раздела в двух разных группах хаба («Каналы
 * уведомлений» в «Интеграциях» и «Личная безопасность» в «Безопасности»), хотя
 * у менеджера, партнёра и заказчика тот же набор всегда лежал на одном экране.
 * Теперь везде один компонент с одними вкладками (`Р-23`, правило зеркала).
 *
 * Гард раздела вызывается на КАЖДЫЙ запрос (§2b): скрытая карточка — это
 * внешний вид, а не право доступа.
 *
 * Данные грузятся только для открытой вкладки: открывая «Безопасность», не идём
 * в базу за телеграмом и каналами.
 */
export async function StaffPersonalSettings({
  cabinet,
  searchParams,
}: {
  cabinet: SettingsCabinet;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSettingsSection('personal.settings', cabinet);
  const tab = readPersonalSettingsTab((await searchParams).tab);

  // Внутренний номер — только менеджерский контур: click-to-call через Mango
  // инициирует руководитель, а `updateInternalPhoneAction` админа и не пустит.
  const withPhone = isManagerLeader(session);

  const profile =
    tab === 'profile'
      ? {
          telegram: await getTelegramStatus(prisma, session),
          internalPhone: withPhone ? await getStaffInternalPhone(prisma, session) : null,
        }
      : null;
  const notifications =
    tab === 'notifications' ? await getNotificationSettings(prisma, session) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#111111]">Личные настройки</h1>
      <p className="text-sm text-gray-500">{PERSONAL_SETTINGS_SUBTITLE}</p>
      <PersonalSettings
        basePath={`/${cabinet}/settings/personal`}
        activeTab={tab}
        slots={{
          profile: profile ? (
            <>
              <TelegramLinkCard status={profile.telegram} />
              {withPhone && <InternalPhoneCard initialInternalPhone={profile.internalPhone} />}
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
