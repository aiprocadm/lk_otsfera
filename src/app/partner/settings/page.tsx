import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { SecurityCard } from '@/components/settings/security-card';
import { getPartnerRequisites } from '@/lib/services/partner/requisites';
import { setPartnerRequisitesAction } from '@/server-actions/requisites';

export default async function PartnerSettingsPage() {
  const session = await requirePartner();
  const status = await getTelegramStatus(prisma, session);
  const settings = await getNotificationSettings(prisma, session);
  // Этап 8 (ФТ-9.2): реквизиты партнёра; правка — только partner-admin.
  const requisites = await getPartnerRequisites(prisma, session);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#111111]">Настройки</h1>
      <TelegramLinkCard status={status} />
      <NotificationChannelsCard settings={settings.view} />
      {requisites.ok && (
        <RequisitesCard
          title="Реквизиты партнёра"
          description="Нужны для автоматического формирования документов. Начните вводить название или ИНН — остальное подставится само."
          defaults={requisites.requisites}
          idPrefix="pt-req"
          action={setPartnerRequisitesAction}
          canEdit={session.partnerRole === 'admin'}
        />
      )}
      <SecurityCard />
    </div>
  );
}
