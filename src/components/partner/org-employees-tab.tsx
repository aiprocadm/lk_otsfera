import React from 'react';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listOrgCardEmployees } from '@/lib/services/organization/orgCardEmployees';
import { OrgEmployeesSection } from '@/components/organization/org-employees-section';

/**
 * Вкладка «Сотрудники» карточки организации в кабинете партнёра (`У-97`).
 *
 * До этапа 2 список читал `OrganizationUser` — пользователей кабинета, — а
 * кнопка рядом заводила сотрудника организации (`Student`): добавленный
 * человек не появлялся в списке никогда (`Д-27`). Теперь и список, и кнопка
 * про одних и тех же людей, а данные отдаёт общий сервис со скоупом роли.
 */
export async function EmployeesTab({
  orgId,
  prisma,
  session,
  searchParams,
}: {
  orgId: string;
  prisma: PrismaClient;
  session: SessionPayload;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const q = typeof searchParams.q === 'string' ? searchParams.q : undefined;
  const skipRaw = Number(typeof searchParams.skip === 'string' ? searchParams.skip : '');
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;

  const { rows, total, canWrite } = await listOrgCardEmployees(prisma, session, {
    orgId,
    ...(q ? { q } : {}),
    skip,
  });

  return (
    <OrgEmployeesSection
      orgId={orgId}
      basePath={`/partner/portfolio/${orgId}`}
      searchParams={searchParams}
      rows={rows}
      total={total}
      canWrite={canWrite}
      take={25}
      skip={skip}
    />
  );
}
