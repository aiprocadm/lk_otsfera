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

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-[#111111]">Настройки</h1>
        <p className="text-sm text-gray-500">{PERSONAL_SETTINGS_SUBTITLE}</p>
        <PersonalSettings
          basePath="/organization/settings"
          activeTab={tab}
          slots={{
            profile: telegram ? <TelegramLinkCard status={telegram} /> : null,
            notifications: notifications ? (
              <NotificationChannelsCard settings={notifications.view} />
            ) : null,
            security: <SecurityCard />,
          }}
        />
      </div>
    </OrgAppShell>
  );
}
