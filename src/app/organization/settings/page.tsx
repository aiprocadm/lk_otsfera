import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { SecurityCard } from '@/components/settings/security-card';
import { PersonalSettings } from '@/components/settings/personal-settings';
import { readPersonalSettingsTab } from '@/lib/navigation/personalSettingsTab';
import { PERSONAL_SETTINGS_SUBTITLE } from '@/lib/navigation/personalSettings';

import { PageHeader } from '@/components/ui/page-header';
import { getNotificationPreferenceMatrix } from '@/lib/services/notifications/eventPreferences';
import { NotificationPreferencesMatrix } from '@/components/settings/notification-preferences-matrix';
import { DigestSettingsCard } from '@/components/settings/digest-settings-card';
import { getDigestSettings } from '@/lib/services/notifications/digest';
import { isFeatureEnabled } from '@/lib/featureFlags';
export const dynamic = 'force-dynamic';

/**
 * Личные настройки заказчика (`У-114`).
 *
 * Раньше здесь же лежали реквизиты организации — то есть настройки **себя** и
 * настройки **своей компании** были свалены на один экран. Реквизиты переехали
 * в раздел «Моя организация» (`У-100`), а здесь остались вкладки Профиль ·
 * Уведомления · Безопасность — те же, что у менеджера и партнёра.
 */
export default async function OrganizationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; org?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);
  const tab = readPersonalSettingsTab(sp.tab);

  const telegram = tab === 'profile' ? await getTelegramStatus(prisma, ctx.session) : null;
  const notifications =
    tab === 'notifications' ? await getNotificationSettings(prisma, ctx.session) : null;
  // `У-229`: матрица «событие × канал» — под флагом центра уведомлений (`Р-Э5-8`).
  const preferences =
    tab === 'notifications' && isFeatureEnabled('notification_center')
      ? (await getNotificationPreferenceMatrix(prisma, ctx.session)).matrix
      : null;
  // `У-230`: дневной дайджест — тоже под флагом (`Р-Э5-8`).
  const digest =
    tab === 'notifications' && isFeatureEnabled('notification_center')
      ? (await getDigestSettings(prisma, ctx.session)).settings
      : null;

  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-4">
        <PageHeader title="Настройки" subtitle={PERSONAL_SETTINGS_SUBTITLE} />
        <PersonalSettings
          basePath="/organization/settings"
          activeTab={tab}
          slots={{
            profile: telegram ? <TelegramLinkCard status={telegram} /> : null,
            notifications: notifications ? (
              <>
                <NotificationChannelsCard settings={notifications.view} />
                {preferences ? <NotificationPreferencesMatrix matrix={preferences} /> : null}
                {digest ? <DigestSettingsCard settings={digest} /> : null}
              </>
            ) : null,
            security: <SecurityCard />,
          }}
        />
      </div>
    </OrgAppShell>
  );
}
