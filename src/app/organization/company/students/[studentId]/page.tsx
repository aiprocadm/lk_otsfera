import React from 'react';
import type { TrainingStatus } from '@prisma/client';
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
import { buildOrgEmployeeBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

// Ключ — enum TrainingStatus целиком: карта тотальна, поэтому обращение по
// статусу заказа не даёт undefined (и компилятор потребует дополнить её,
// если в enum появится новый статус).
const TRAINING_TONE: Record<TrainingStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  pending: 'neutral',
  in_progress: 'info',
  certificate_issued: 'success',
  cancelled: 'danger',
};

/**
 * Карточка сотрудника внутри раздела «Моя организация» (`У-97`, `У-100`).
 *
 * Раньше жила отдельным адресом `/organization/students/[id]`, и путь
 * наверху вёл в список, который стал шлюзом. Содержимое прежнее:
 * удостоверения и история обучения. Чужой сотрудник неотличим от
 * несуществующего (notFound).
 */
export default async function OrganizationCompanyStudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  if (!isFeatureEnabled('certificates_registry')) notFound();
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);
  const { studentId: id } = await params;

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
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-5">
        <div>
          {/* `У-72`: крошки вместо самодельной ссылки «назад». */}
          {/* `У-97`: путь показывает, что сотрудник живёт внутри своей
              организации, а не сам по себе. */}
          <Breadcrumbs
            items={buildOrgEmployeeBreadcrumbs('organization', '/organization/company', {
              orgCardHref: '/organization/company',
              orgName: ctx.activeOrgName,
              employeeName: student.name,
            })}
          />
          <div className="bg-white border border-gray-200 rounded-xl p-6 mt-2 space-y-1">
            <PageHeader
              title={student.name}
              subtitle="Сотрудник организации: его обучают, ему выдают удостоверения."
            />
            <p className="text-sm text-gray-500">{student.email ?? 'Почта не указана'}</p>
            <p className="text-gray-400 text-xs mt-1">
              {student.externalStudentId && <>ID студента {student.externalStudentId} · </>}
              Добавлен {fmtDate(student.createdAt)}
            </p>

            {/* У-30 (этап 5): реквизиты справочника сотрудников. */}
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 pt-3 text-sm">
              <Detail label="СНИЛС" value={student.snils} />
              <Detail
                label="Дата рождения"
                value={student.birthDate ? fmtDate(student.birthDate) : null}
              />
              <Detail label="Телефон" value={student.phone} />
              <Detail label="Заметка" value={student.note} />
            </dl>
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

/** Строка реквизита карточки: пустое значение показывается прочерком, а не пропадает (§15). */
function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-gray-500 flex-shrink-0">{label}:</dt>
      <dd className="text-gray-800 break-words">{value ?? '—'}</dd>
    </div>
  );
}
