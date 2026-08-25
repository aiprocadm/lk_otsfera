import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requirePartnerAdmin } from '@/lib/auth/requireRole';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { getOrgRequisites } from '@/lib/services/organization/requisites';
import { setOrgRequisitesAction } from '@/server-actions/requisites';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { orgCardTabsFor } from '@/lib/navigation/orgCardTabs';
import { OrgCardTabsNav } from '@/components/manager/org-card-tabs';
import { partnerOrgTabHref } from '@/lib/navigation/partnerOrgCard';
import { CustomerAccessSection } from '@/components/partner/customer-access-section';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { OrgSettingsTab } from '@/components/organization/org-settings-tab';
import { OrgCommissionSection } from '@/components/organization/org-commission-section';

export default async function OrgSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const session = await requirePartnerAdmin();

  const { orgId } = await params;
  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) redirect('/forbidden');

  const card = await getOrgCard(prisma, { orgId, partnerId: session.partnerId });
  if (!card) notFound();

  // У-62: реквизиты организации ведёт и партнёр-администратор. Право проверяет
  // сервис (§4) — страница только показывает то, что он разрешил отдать.
  const requisites = await getOrgRequisites(prisma, session, orgId);

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('partner', '/partner/portfolio', [
          { label: card.name, href: `/partner/portfolio/${orgId}` },
          { label: 'Настройки' },
        ])}
      />
      <OrgCardHeader card={card} />
      {/* `У-96`: состав вкладок — фильтр общего реестра, а не свой список. */}
      <OrgCardTabsNav
        tabs={orgCardTabsFor('partner', { flags: isFeatureEnabled })}
        activeTab="settings"
        hrefFor={(key) => partnerOrgTabHref(orgId, key)}
      />

      <p className="text-sm text-gray-600">
        Реквизиты для документов и доступ сотрудников организации в их кабинет. Ставку комиссии
        назначает учебный центр.
      </p>

      {/* `У-99`: тот же набор секций, те же названия и тот же порядок, что у
          сотрудников учебного центра, — различаются только данные и права
          (§0.2, правило зеркала). У-62: реквизиты ведёт та же карточка, что в
          кабинете организации; У-61: доступ живёт здесь, а не под всеми
          вкладками сразу. */}
      <OrgSettingsTab
        cabinet="partner"
        slots={{
          requisites: requisites.ok ? (
            <RequisitesCard
              description="Начните вводить название или ИНН — остальное подставится само."
              defaults={requisites.requisites}
              idPrefix="org-req"
              action={setOrgRequisitesAction}
              canEdit={true}
              hidden={{ orgId }}
            />
          ) : undefined,
          cabinetAccess: (
            <CustomerAccessSection organizationId={orgId} prisma={prisma} canInvite={true} />
          ),
          // `У-3` (решение `Р-4`): партнёр ставку только видит. Формы правки
          // здесь нет и быть не может — это закреплено стражем.
          commission: (
            <OrgCommissionSection
              rate={card.partnerCommissionRate !== null ? Number(card.partnerCommissionRate) : null}
              note={card.partnerCommissionRateNote}
              history={[]}
            />
          ),
        }}
      />
    </div>
  );
}
