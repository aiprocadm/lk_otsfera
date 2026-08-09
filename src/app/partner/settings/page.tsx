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
import { PartnerSettingsTabs, type PartnerSettingsTab } from '@/components/partner/settings-tabs';

const VALID_TABS: PartnerSettingsTab[] = ['profile', 'team', 'notifications', 'security'];

/**
 * Настройки партнёра (`У-60`, этап 4): четыре вкладки вместо одной длинной
 * страницы. Служебная «Команда» переехала сюда из главного меню; старый адрес
 * `/partner/team` остался редиректом.
 *
 * Данные грузятся **только для активной вкладки** — открывая «Безопасность», не
 * надо ходить в базу за командой и телеграмом.
 */
export default async function PartnerSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requirePartner();
  const isAdmin = session.partnerRole === 'admin';

  const sp = await searchParams;
  const requested = VALID_TABS.includes(sp.tab as PartnerSettingsTab)
    ? (sp.tab as PartnerSettingsTab)
    : 'profile';
  // Вкладка «Команда» — только партнёру-администратору. Обычный пользователь,
  // пришедший по прямой ссылке, попадает на «Профиль», а не на пустой экран.
  const tab: PartnerSettingsTab = requested === 'team' && !isAdmin ? 'profile' : requested;

  const requisites = tab === 'profile' ? await getPartnerRequisites(prisma, session) : null;
  const team =
    tab === 'team'
      ? {
          rows: await listTeam(prisma, session.partnerId),
          orgs: await listPartnerOrgOptions(prisma, { partnerId: session.partnerId }),
        }
      : null;
  const notifications =
    tab === 'notifications'
      ? {
          status: await getTelegramStatus(prisma, session),
          settings: await getNotificationSettings(prisma, session),
        }
      : null;

  const activeCount = team ? team.rows.filter((r) => r.isActive).length : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Настройки</h1>
        <p className="text-sm text-gray-600 mt-1">
          Реквизиты для документов, сотрудники вашей компании, уведомления и вход.
        </p>
      </div>

      <PartnerSettingsTabs active={tab} isAdmin={isAdmin} />

      {tab === 'profile' &&
        (requisites?.ok ? (
          <RequisitesCard
            title="Реквизиты партнёра"
            description="Нужны для автоматического формирования документов. Начните вводить название или ИНН — остальное подставится само."
            defaults={requisites.requisites}
            idPrefix="pt-req"
            action={setPartnerRequisitesAction}
            canEdit={isAdmin}
          />
        ) : (
          <p className="text-sm text-gray-500">
            Реквизиты недоступны — обратитесь к администратору партнёра.
          </p>
        ))}

      {tab === 'team' && team && (
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
      )}

      {tab === 'notifications' && notifications && (
        <div className="space-y-6">
          <TelegramLinkCard status={notifications.status} />
          <NotificationChannelsCard settings={notifications.settings.view} />
        </div>
      )}

      {tab === 'security' && <SecurityCard />}
    </div>
  );
}
