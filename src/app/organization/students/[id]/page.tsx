import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getOrgStudent, listOrgStudentTraining } from '@/lib/services/organization/students';
import { listCertificates } from '@/lib/services/training/certificates';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { CertificateRegistryTable } from '@/components/certificates/certificate-registry-table';
import { StudentPositionForm } from '@/components/organization/student-position-form';
import { TRAINING_STATUS_RU } from '@/components/training/order-items-section';
import { Badge, TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { getFieldsForEntity } from '@/lib/services/customFields';

export const dynamic = 'force-dynamic';

const TRAINING_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = {
  pending: 'neutral',
  in_progress: 'info',
  certificate_issued: 'success',
  cancelled: 'danger',
};

/**
 * Карточка сотрудника организации (этап 3, ФТ-6.3): удостоверения + история
 * обучения. Чужой сотрудник неотличим от несуществующего (notFound).
 */
export default async function OrganizationStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  if (!isFeatureEnabled('certificates_registry')) notFound();
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);
  const { id } = await params;

  const student = await getOrgStudent(prisma, { organizationId: ctx.activeOrgId, studentId: id });
  if (!student) notFound();

  const [certsResult, training] = await Promise.all([
    listCertificates(prisma, ctx.session, { organizationId: ctx.activeOrgId, studentId: id }),
    listOrgStudentTraining(prisma, { organizationId: ctx.activeOrgId, studentId: id }),
  ]);
  const certificates = certsResult.ok ? certsResult.certificates : [];

  // §11 ТЗ v0.5: настраиваемые поля сотрудника. Клиент правит их только если
  // администратор явно отметил роль «Организация» — решает сервер.
  const customFields = await getFieldsForEntity(prisma, ctx.session, 'student', id);

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-5">
        <div>
          <Link href="/organization/students" className="text-sm text-[#F97316] hover:underline">
            ← Сотрудники
          </Link>
          <div className="bg-white border border-gray-200 rounded-xl p-6 mt-2 space-y-1">
            <h1 className="text-2xl font-semibold text-[#111111]">{student.name}</h1>
            <p className="text-gray-500 text-sm">{student.email}</p>
            <p className="text-gray-400 text-xs mt-1">
              {student.externalStudentId && <>ID студента {student.externalStudentId} · </>}
              Добавлен {fmtDate(student.createdAt)}
            </p>
            {/* ФТ-12.2: должность попадает в выгрузку сотрудников. */}
            <div className="pt-3">
              <StudentPositionForm
                organizationId={ctx.activeOrgId}
                studentId={student.id}
                initialPosition={student.position}
              />
            </div>
          </div>
        </div>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-[#111111]">Удостоверения</h2>
          <CertificateRegistryTable rows={certificates} />
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-[#111111]">История обучения</h2>
          {training.length === 0 ? (
            <EmptyState icon="🎓" message="Обучение сотрудника пока не оформлялось." />
          ) : (
            <TableShell>
              <THead>
                <Th>Заказ</Th>
                <Th>Направление</Th>
                <Th>Статус</Th>
                <Th>Добавлен</Th>
              </THead>
              <tbody>
                {training.map((t) => (
                  <Tr key={t.id}>
                    <Td>
                      <Link
                        href={`/organization/orders/${t.order.id}`}
                        className="text-[#F97316] hover:underline"
                      >
                        {t.order.orderNumber ? `№ ${t.order.orderNumber}` : t.order.title}
                      </Link>
                    </Td>
                    <Td>{t.direction.name}</Td>
                    <Td>
                      <Badge tone={TRAINING_TONE[t.trainingStatus]}>
                        {TRAINING_STATUS_RU[t.trainingStatus]}
                      </Badge>
                    </Td>
                    <Td className="text-gray-500">{fmtDate(t.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </section>

        <EntityCustomFields fields={customFields} entityType="student" entityId={id} />
      </div>
    </OrgAppShell>
  );
}
