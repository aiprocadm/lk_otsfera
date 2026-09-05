import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import { orgCardTabsFor, type OrgCardTabKey } from '@/lib/navigation/orgCardTabs';
import { OrgCardTabs } from '@/components/manager/org-card-tabs';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgEmployeesSection } from '@/components/organization/org-employees-section';
import { OrgSettingsTab } from '@/components/organization/org-settings-tab';
import { OrgCabinetAccessSection } from '@/components/organization/org-cabinet-access-section';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { OrgRequisitesView } from '@/components/organization/org-requisites-view';
import { listOrgCardEmployees } from '@/lib/services/organization/orgCardEmployees';
import { getOrgRequisites } from '@/lib/services/organization/requisites';
import { setOrgRequisitesAction } from '@/server-actions/requisites';

export const dynamic = 'force-dynamic';

/**
 * «Моя организация» — карточка своей организации в кабинете заказчика
 * (`У-100`).
 *
 * До этого раздела заказчик видел свою организацию по кусочкам: «Сотрудники» —
 * один пункт меню, «Доступ в кабинет» — другой, реквизиты — на третьем экране,
 * а самой организации как объекта не было нигде. У сотрудников учебного центра
 * и партнёра всё это давно было одной карточкой с вкладками — теперь она
 * одинакова во всех кабинетах (§0.2, правило зеркала).
 *
 * Данные даёт тот же сервис карточки: для заказчика он проверяет **активное
 * членство** и не грузит внутренние блоки учебного центра (лиды, звонки,
 * входящие письма) — их у заказчика нет ни во вкладках, ни в данных.
 */
export default async function OrganizationCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!isFeatureEnabled('organization_cabinet')) notFound();
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  const visibleTabs = orgCardTabsFor('organization', { flags: isFeatureEnabled });
  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const activeTab: OrgCardTabKey = visibleTabs.some((t) => t.key === rawTab)
    ? (rawTab as OrgCardTabKey)
    : 'overview';

  const card = await getOrganizationCard(prisma, ctx.session, ctx.activeOrgId);
  if (!card) notFound();

  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const skipRaw = Number(typeof sp.skip === 'string' ? sp.skip : '');
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  const employees =
    activeTab === 'employees'
      ? await listOrgCardEmployees(prisma, ctx.session, {
          orgId: ctx.activeOrgId,
          ...(q ? { q } : {}),
          skip,
        })
      : null;

  // `У-99`: у заказчика на «Настройках» реквизиты и доступ в кабинет — без
  // ставки комиссии и менеджеров. Право правки решает сервис (`У-62`):
  // участник без прав видит значения, но не форму.
  const requisites =
    activeTab === 'settings' ? await getOrgRequisites(prisma, ctx.session, ctx.activeOrgId) : null;
  const canEditRequisites = ctx.viewerRole === 'admin' || ctx.viewerRole === 'leader';

  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <OrgCardTabs
        card={card}
        activeTab={activeTab}
        tabs={visibleTabs}
        // Выгрузка удостоверений — роутом заказчика (свой скоуп); staff-роут
        // карточки заказчику отвечает 403 (этап 9, PR-1).
        certificatesExport={{
          base: '/api/organization/certificates/export',
          params: { org: ctx.activeOrgId },
        }}
        employees={
          employees ? (
            <OrgEmployeesSection
              orgId={ctx.activeOrgId}
              basePath="/organization/company"
              searchParams={sp}
              rows={employees.rows}
              total={employees.total}
              canWrite={employees.canWrite}
              take={25}
              skip={skip}
            />
          ) : null
        }
        settings={
          requisites ? (
            <OrgSettingsTab
              cabinet="organization"
              slots={{
                requisites: requisites.ok ? (
                  canEditRequisites ? (
                    <RequisitesCard
                      description="Нужны для счетов, актов и договоров. Начните вводить название или ИНН — остальное подставится само."
                      defaults={requisites.requisites}
                      idPrefix="own-org-req"
                      action={setOrgRequisitesAction}
                      canEdit={true}
                      hidden={{ orgId: ctx.activeOrgId }}
                    />
                  ) : (
                    <OrgRequisitesView
                      requisites={{
                        inn: card.inn,
                        kpp: card.kpp,
                        legalName: card.requisites.legalName,
                        ogrn: card.requisites.ogrn,
                        legalAddress: card.requisites.legalAddress,
                        bankName: card.requisites.bankName,
                        bankAccount: card.requisites.bankAccount,
                        corrAccount: card.requisites.corrAccount,
                        bic: card.requisites.bic,
                        signerName: card.requisites.signerName,
                        signerPosition: card.requisites.signerPosition,
                      }}
                    />
                  )
                ) : undefined,
                cabinetAccess: (
                  <OrgCabinetAccessSection
                    organizationId={ctx.activeOrgId}
                    prisma={prisma}
                    currentUserId={ctx.session.sub}
                    viewerRole={ctx.viewerRole}
                  />
                ),
              }}
            />
          ) : null
        }
      />
    </OrgAppShell>
  );
}
