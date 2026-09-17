import React from 'react';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { StaffBackupCodesSection } from '@/components/settings/staff-backup-codes-section';
import { SecurityCard } from '@/components/settings/security-card';
import { InternalPhoneCard } from '@/components/manager/settings/internal-phone-card';
import { PersonalSettings } from '@/components/settings/personal-settings';
import {
  PERSONAL_SETTINGS_SUBTITLE,
  type PersonalSettingsTabKey,
} from '@/lib/navigation/personalSettings';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import type { TelegramStatus } from '@/lib/services/telegram/link';
import type { NotificationSettingsView } from '@/lib/services/notifications/preferences';
import type { NotificationPreferenceMatrix } from '@/lib/services/notifications/eventPreferences';

import { PageHeader } from '@/components/ui/page-header';
import { NotificationPreferencesMatrix } from '@/components/settings/notification-preferences-matrix';
/**
 * Раздел хаба «Личные настройки» (`У-114`) — общий для админа и руководителя.
 *
 * Раньше это были два разных раздела в двух разных группах хаба («Каналы
 * уведомлений» в «Интеграциях» и «Личная безопасность» в «Безопасности»), хотя
 * у менеджера, партнёра и заказчика тот же набор всегда лежал на одном экране.
 * Теперь везде один компонент с одними вкладками (`Р-23`, правило зеркала).
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Гард раздела и выборки живут на странице
 * своего кабинета — она грузит данные только для открытой вкладки: открывая
 * «Безопасность», не идём в базу за телеграмом и каналами.
 */
export function StaffPersonalSettings({
  cabinet,
  activeTab,
  withPhone,
  profile,
  notifications,
  preferences = null,
}: {
  cabinet: SettingsCabinet;
  activeTab: PersonalSettingsTabKey;
  /** Внутренний номер — только менеджерский контур (руководитель, не админ). */
  withPhone: boolean;
  profile: { telegram: TelegramStatus; internalPhone: string | null } | null;
  notifications: NotificationSettingsView | null;
  /** `У-229`: матрица «событие × канал»; `null` — флаг выключен или вкладка не та. */
  preferences?: NotificationPreferenceMatrix | null;
}) {
  return (
    <div className="space-y-4">
      <PageHeader title="Личные настройки" subtitle={PERSONAL_SETTINGS_SUBTITLE} />
      <PersonalSettings
        basePath={`/${cabinet}/settings/personal`}
        activeTab={activeTab}
        slots={{
          profile: profile ? (
            <>
              <TelegramLinkCard status={profile.telegram} />
              {withPhone && <InternalPhoneCard initialInternalPhone={profile.internalPhone} />}
            </>
          ) : null,
          notifications: notifications ? (
            <>
              <NotificationChannelsCard settings={notifications} />
              {preferences ? <NotificationPreferencesMatrix matrix={preferences} /> : null}
            </>
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
