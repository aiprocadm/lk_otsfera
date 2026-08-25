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
import { listTeam } from '@/lib/services/partner/team';
import { listPartnerOrgOptions } from '@/lib/services/partner/orgOptions';
import { TeamTable } from '@/components/partner/team-table';
import { TeamCardList } from '@/components/partner/team-card-list';
import { InviteMemberForm } from '@/components/partner/invite-member-form';
import { pluralizeRu } from '@/lib/format';
import { PersonalSettings } from '@/components/settings/personal-settings';
import { readPersonalSettingsTab } from '@/lib/navigation/personalSettingsTab';
import { PERSONAL_SETTINGS_SUBTITLE } from '@/lib/navigation/personalSettings';

export const dynamic = 'force-dynamic';

/**
 * Личные настройки партнёра (`У-60`, `У-114`).
 *
 * Вкладки были свои (`partner/settings-tabs.tsx`), из-за чего один и тот же
 * набор настроек в кабинете партнёра выглядел иначе, чем у менеджера и
 * заказчика. Теперь переключатель общий, а «Команда» — единственное отличие:
 * ею управляет только партнёр-администратор (`У-60`).
 *
 * Данные грузятся **только для активной вкладки**: открывая «Безопасность», не
 * надо ходить в базу за командой и телеграмом.
 */
export default async function PartnerSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requirePartner();
  const isAdmin = session.partnerRole === 'admin';
  const tab = readPersonalSettingsTab((await searchParams).tab, { team: isAdmin });

  const profile =
    tab === 'profile'
      ? {
          requisites: await getPartnerRequisites(prisma, session),
          telegram: await getTelegramStatus(prisma, session),
        }
      : null;
  const team =
    tab === 'team'
      ? {
          rows: await listTeam(prisma, session.partnerId),
          orgs: await listPartnerOrgOptions(prisma, { partnerId: session.partnerId }),
        }
      : null;
  const notifications =
    tab === 'notifications' ? await getNotificationSettings(prisma, session) : null;

  const activeCount = team ? team.rows.filter((r) => r.isActive).length : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#111111]">Настройки</h1>
      <p className="text-sm text-gray-500">{PERSONAL_SETTINGS_SUBTITLE}</p>
      <PersonalSettings
        basePath="/partner/settings"
        activeTab={tab}
        team={isAdmin}
        slots={{
          profile: profile ? (
            <>
              {profile.requisites.ok ? (
                <RequisitesCard
                  title="Реквизиты партнёра"
                  description="Нужны для автоматического формирования документов. Начните вводить название или ИНН — остальное подставится само."
                  defaults={profile.requisites.requisites}
                  idPrefix="pt-req"
                  action={setPartnerRequisitesAction}
                  canEdit={isAdmin}
                />
              ) : (
                <p className="text-sm text-gray-500">
                  Реквизиты недоступны — обратитесь к администратору партнёра.
                </p>
              )}
              <TelegramLinkCard status={profile.telegram} />
            </>
          ) : null,
          team: team ? (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <p className="text-sm text-gray-500">
                  {activeCount}{' '}
                  {pluralizeRu(
                    activeCount,
                    'активный сотрудник',
                    'активных сотрудника',
                    'активных сотрудников'
                  )}
                  {team.rows.length > activeCount && (
                    <span className="text-gray-400">
                      {' '}
                      · {team.rows.length - activeCount} деактивирован
                      {team.rows.length - activeCount === 1 ? '' : 'о'}
                    </span>
                  )}
                </p>
                <InviteMemberForm orgs={team.orgs} />
              </div>

              <TeamTable rows={team.rows} orgs={team.orgs} currentUserId={session.sub} />
              <TeamCardList rows={team.rows} orgs={team.orgs} currentUserId={session.sub} />
            </div>
          ) : null,
          notifications: notifications ? (
            <NotificationChannelsCard settings={notifications.view} />
          ) : null,
          security: <SecurityCard />,
        }}
      />
    </div>
  );
}
