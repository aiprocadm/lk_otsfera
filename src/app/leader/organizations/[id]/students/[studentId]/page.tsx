import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getOrgCardEmployee } from '@/lib/services/organization/orgCardEmployees';
import { listCertificates } from '@/lib/services/training/certificates';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { OrgEmployeeCard } from '@/components/organization/org-employee-card';
import { buildOrgEmployeeBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Карточка сотрудника внутри карточки организации у руководителя (`У-97`).
 *
 * Гард пускает любого руководителя, границу компании держит сервис: он
 * спрашивает `studentOrgAccess`, а тот для менеджерского контура фильтрует
 * организацию по `managerOrgScope` с учётом режима видимости команды (C8).
 */
export default async function LeaderOrgEmployeePage({
  params,
}: {
  params: Promise<{ id: string; studentId: string }>;
}) {
  const { id, studentId } = await params;
  const session = await requireManagerLeader();

  const org = await prisma.organization.findUnique({ where: { id }, select: { name: true } });
  const employee = await getOrgCardEmployee(prisma, session, { orgId: id, studentId });
  if (!org || !employee) notFound();

  const certsResult = await listCertificates(prisma, session, { organizationId: id, studentId });
  const customFields = await getFieldsForEntity(prisma, session, 'student', studentId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={buildOrgEmployeeBreadcrumbs('leader', '/leader/organizations', {
          orgCardHref: `/leader/organizations/${id}`,
          orgName: org.name,
          employeeName: employee.name,
        })}
      />
      <OrgEmployeeCard
        employee={employee}
        certificates={certsResult.ok ? certsResult.certificates : []}
        customFields={
          <EntityCustomFields fields={customFields} entityType="student" entityId={studentId} />
        }
      />
    </div>
  );
}
