import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { prisma } from '@/lib/db/prisma';
import { getOrgCardEmployee } from '@/lib/services/organization/orgCardEmployees';
import { listCertificates } from '@/lib/services/training/certificates';
import { OrgEmployeeCard } from '@/components/organization/org-employee-card';
import { buildOrgEmployeeBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Карточка сотрудника внутри карточки организации у партнёра (`У-97`).
 *
 * До этого шага строка вкладки «Сотрудники» вела в никуда: адреса просто не
 * существовало, и клик давал «страница не найдена».
 *
 * Настраиваемых полей здесь нет намеренно: их состав и право правки задаёт
 * учебный центр, а партнёрский кабинет их не ведёт.
 */
export default async function PartnerOrgEmployeePage({
  params,
}: {
  params: Promise<{ orgId: string; studentId: string }>;
}) {
  const session = await requirePartner();
  const { orgId, studentId } = await params;

  if (!(await canPartnerAccessOrg(session, orgId))) redirect('/forbidden');

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const employee = await getOrgCardEmployee(prisma, session, { orgId, studentId });
  if (!org || !employee) notFound();

  const certsResult = await listCertificates(prisma, session, { organizationId: orgId, studentId });

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={buildOrgEmployeeBreadcrumbs('partner', '/partner/portfolio', {
          orgCardHref: `/partner/portfolio/${orgId}`,
          orgName: org.name,
          employeeName: employee.name,
        })}
      />
      <OrgEmployeeCard
        employee={employee}
        certificates={certsResult.ok ? certsResult.certificates : []}
      />
    </div>
  );
}
