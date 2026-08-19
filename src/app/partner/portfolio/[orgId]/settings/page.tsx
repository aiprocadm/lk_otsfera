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
import { OrgTabs } from '@/components/partner/org-tabs';
import { CustomerAccessSection } from '@/components/partner/customer-access-section';
import { RequisitesCard } from '@/components/requisites/requisites-card';

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
      <OrgTabs orgId={orgId} active="settings" isAdmin={true} />

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-1">
        <h2 className="text-sm font-semibold text-[#111111]">Настройки организации</h2>
        <p className="text-sm text-gray-600">
          Реквизиты для документов и доступ сотрудников организации в их кабинет. Ставку комиссии
          назначает учебный центр.
        </p>
      </section>

      {/* У-62: та же карточка, что в кабинете организации, — не пишем вторую. */}
      {requisites.ok && (
        <RequisitesCard
          title="Реквизиты организации"
          description="Нужны для автоматического формирования документов. Начните вводить название или ИНН — остальное подставится само."
          defaults={requisites.requisites}
          idPrefix="org-req"
          action={setOrgRequisitesAction}
          canEdit={true}
          hidden={{ orgId }}
        />
      )}

      {/* У-61: блок доступа переехал сюда из общей области карточки, где он
          висел под всеми вкладками сразу. */}
      <CustomerAccessSection organizationId={orgId} prisma={prisma} canInvite={true} />
    </div>
  );
}
