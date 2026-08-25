import React from 'react';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader } from '@/lib/auth/roleModel';
import { listOrgRateHistory } from '@/lib/services/commission/rateHistory';
import type { OrganizationCard } from '@/lib/services/manager/organizationCard';
import type { FieldWithValue } from '@/lib/services/customFields';
import { CustomerAccessSection } from '@/components/partner/customer-access-section';
import { ManagersBlock } from '@/components/admin/managers-block';
import { AdminRateOverrideForm } from '@/components/admin/admin-rate-override-form';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { OrgSettingsTab } from './org-settings-tab';
import { OrgRequisitesView } from './org-requisites-view';
import { OrgCommissionSection } from './org-commission-section';

/**
 * Вкладка «Настройки» карточки организации для кабинетов сотрудников ЦО
 * (`У-99`). Один сборщик на менеджера и руководителя: карточки у них
 * одинаковые, и расхождение здесь было бы расхождением зеркала (§0.2 ТЗ), а не
 * особенностью роли.
 *
 * **Права, а не внешний вид.** Что человек увидит, решает не этот компонент:
 * `commission` приходит из карточки уже `null` без capability `see_commission`,
 * историю ставки отдаёт сервис (`forbidden` → секции просто нет), а форму
 * правки получают только администратор и руководитель — так требует `У-99`.
 * Назначать менеджеров по-прежнему может только администратор: ТЗ расширило
 * права только по ставке, и «заодно» их расширять нельзя (§16).
 */
export async function OrgStaffSettings({
  cabinet,
  card,
  session,
  prisma,
  customFields,
}: {
  cabinet: 'leader' | 'manager';
  card: OrganizationCard;
  session: SessionPayload;
  prisma: PrismaClient;
  customFields: FieldWithValue[];
}) {
  // Кабинеты здесь только менеджерские, поэтому право на ставку = «это
  // руководитель». Администратор ведёт ставку на своей странице организации.
  const canEditRate = isManagerLeader(session);
  const historyResult = await listOrgRateHistory(prisma, session, card.id);
  const history = historyResult.ok ? historyResult.rows : [];

  const rate = card.commission?.partnerCommissionRate
    ? Number(card.commission.partnerCommissionRate)
    : null;

  return (
    <OrgSettingsTab
      cabinet={cabinet}
      slots={{
        requisites: (
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
        ),
        cabinetAccess: (
          <CustomerAccessSection
            organizationId={card.id}
            prisma={prisma}
            canInvite={false}
            source="admin"
          />
        ),
        managers: <ManagersBlock orgId={card.id} prisma={prisma} canManage={false} />,
        commission: card.commission ? (
          <OrgCommissionSection
            rate={rate}
            note={card.commission.note}
            history={history}
            form={
              canEditRate ? (
                <AdminRateOverrideForm
                  organizationId={card.id}
                  initialRate={rate}
                  initialNote={card.commission.note}
                />
              ) : null
            }
          />
        ) : undefined,
        customFields: (
          <EntityCustomFields fields={customFields} entityType="organization" entityId={card.id} />
        ),
      }}
    />
  );
}
