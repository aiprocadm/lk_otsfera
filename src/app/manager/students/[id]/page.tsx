import React from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listCertificates } from '@/lib/services/training';
import { getStudent } from '@/lib/services/manager/students';
import { CertificateList } from '@/components/training/certificate-list';
import { fmtDate } from '@/lib/format';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';

export default async function ManagerStudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireManager();

  // Load student; scope-чек и журнал ПДн — внутри сервиса (getStudent).
  const student = await getStudent(prisma, session, id);
  if (!student) notFound();

  const certsResult = await listCertificates(prisma, session, { studentId: id });
  const certificates = certsResult.ok ? certsResult.certificates : [];

  // §11 ТЗ v0.5: настраиваемые поля сотрудника организации.
  const customFields = await getFieldsForEntity(prisma, session, 'student', id);

  return (
    <div className="space-y-6">
      {/* `У-72`: путь до экрана вместо одиночной ссылки «назад». */}
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('manager', '/manager/students', [{ label: student.name }])}
      />

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-1">
        <h1 className="text-2xl font-semibold text-[#111111]">{student.name}</h1>
        <p className="text-gray-500 text-sm">{student.email ?? 'Почта не указана'}</p>
        <p className="text-gray-400 text-xs mt-1">
          Организация:{' '}
          <Link
            href={`/manager/organizations/${student.organization.id}`}
            className="text-[#F97316] hover:underline"
          >
            {student.organization.name}
          </Link>{' '}
          · Добавлен {fmtDate(student.createdAt)}
        </p>

        {/* У-30 (этап 5): реквизиты справочника. Выдача карточки журналируется
            в PiiAccessEvent сервисом (У-31) — СНИЛС и дата рождения это ПДн. */}
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 pt-3 text-sm">
          <Detail label="Должность" value={student.position} />
          <Detail label="СНИЛС" value={student.snils} />
          <Detail
            label="Дата рождения"
            value={student.birthDate ? fmtDate(student.birthDate) : null}
          />
          <Detail label="Телефон" value={student.phone} />
          <Detail label="Заметка" value={student.note} />
        </dl>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-[#111111]">Удостоверения</h2>
        <CertificateList certificates={certificates} />
      </div>

      <EntityCustomFields fields={customFields} entityType="student" entityId={id} />
    </div>
  );
}

/** Строка реквизита: пустое значение показывается прочерком, а не пропадает (§15). */
function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-gray-500 flex-shrink-0">{label}:</dt>
      <dd className="text-gray-800 break-words">{value ?? '—'}</dd>
    </div>
  );
}
