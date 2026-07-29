import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerForOrg } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import { OrgCardTabs, ORG_CARD_TABS, type OrgCardTab } from '@/components/manager/org-card-tabs';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { getValuesForEntity } from '@/lib/services/customFields';

export const dynamic = 'force-dynamic';

export default async function ManagerOrgDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // Табы «Обращения»/«Звонки» условны на своих флагах (Task 12/G4, Task 9b/B4) —
  // фильтруем видимый список табов здесь же, чтобы и nav, и ?tab=-валидация были согласованы.
  const visibleTabs = ORG_CARD_TABS.filter(
    (t) =>
      (t.key !== 'inbound_messages' || isFeatureEnabled('inbound_messaging')) &&
      (t.key !== 'calls' || isFeatureEnabled('telephony_mango')) &&
      // Этап 7 (PR-3): внутренний контур — по флагам доменов; лиды под кабинетом (без флага).
      (t.key !== 'client_requests' || isFeatureEnabled('client_requests')) &&
      (t.key !== 'deals' || isFeatureEnabled('deals_pipeline')) &&
      // Этап 9 (ФТ-12.2): вкладка удостоверений живёт под тем же флагом, что и реестры.
      (t.key !== 'certificates' || isFeatureEnabled('certificates_registry'))
  );

  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const activeTab: OrgCardTab = visibleTabs.some((t) => t.key === rawTab) ? (rawTab as OrgCardTab) : 'history';

  const session = await requireManagerForOrg(id);
  const card = await getOrganizationCard(prisma, session, id);
  if (!card) notFound();

  // §11 ТЗ v0.5: настраиваемые поля организации — под вкладками, чтобы были
  // видны на любой из них (вкладки переключают историю/удостоверения, а поля
  // относятся к самой организации).
  const customFieldsResult = await getValuesForEntity(prisma, session, 'organization', id);
  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];

  return (
    <div className='space-y-5'>
      <OrgCardTabs card={card} activeTab={activeTab} tabs={visibleTabs} />
      <EntityCustomFields fields={customFields} entityType='organization' entityId={id} />
    </div>
  );
}
