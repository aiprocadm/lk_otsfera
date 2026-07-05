import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';

export default async function OrganizationSettingsPage() {
  const ctx = await getOrgPageContext({});
  const status = await getTelegramStatus(prisma, ctx.session);
  const settings = await getNotificationSettings(prisma, ctx.session);

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-6'>
        <h1 className='text-2xl font-semibold text-[#111111]'>Настройки</h1>
        <TelegramLinkCard status={status} />
        <NotificationChannelsCard settings={settings.view} />
      </div>
    </OrgAppShell>
  );
}
