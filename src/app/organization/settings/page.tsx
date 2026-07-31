import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { SecurityCard } from '@/components/settings/security-card';
import { getOrgRequisites } from '@/lib/services/organization/requisites';
import { setOrgRequisitesAction } from '@/server-actions/requisites';

export default async function OrganizationSettingsPage() {
  const ctx = await getOrgPageContext({});
  const status = await getTelegramStatus(prisma, ctx.session);
  const settings = await getNotificationSettings(prisma, ctx.session);
  // Этап 8 (ФТ-9.2): реквизиты активной организации; правка — admin|leader.
  const requisites = ctx.activeOrgId
    ? await getOrgRequisites(prisma, ctx.session, ctx.activeOrgId)
    : null;
  const canEditRequisites = ctx.viewerRole === 'admin' || ctx.viewerRole === 'leader';

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-[#111111]">Настройки</h1>
        <TelegramLinkCard status={status} />
        <NotificationChannelsCard settings={settings.view} />
        {requisites?.ok && ctx.activeOrgId && (
          <RequisitesCard
            title="Реквизиты организации"
            description="Нужны для автоматического формирования счетов и актов. Начните вводить название или ИНН — остальное подставится само."
            defaults={requisites.requisites}
            idPrefix="org-req"
            action={setOrgRequisitesAction}
            hidden={{ orgId: ctx.activeOrgId }}
            canEdit={canEditRequisites}
          />
        )}
        <SecurityCard />
      </div>
    </OrgAppShell>
  );
}
