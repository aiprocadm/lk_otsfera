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
    <div className='space-y-6'>
      <div className='flex items-center gap-2'>
        <Link href='/manager/students' className='text-sm text-[#F97316] hover:underline'>
          ← Сотрудники
        </Link>
      </div>

      <div className='bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-1'>
        <h1 className='text-2xl font-semibold text-[#111111]'>{student.name}</h1>
        <p className='text-gray-500 text-sm'>{student.email}</p>
        <p className='text-gray-400 text-xs mt-1'>
          Организация:{' '}
          <Link
            href={`/manager/organizations/${student.organization.id}`}
            className='text-[#F97316] hover:underline'
          >
            {student.organization.name}
          </Link>{' '}
          · Добавлен {fmtDate(student.createdAt)}
        </p>
      </div>

      <div className='space-y-2'>
        <h2 className='text-xl font-semibold text-[#111111]'>Удостоверения</h2>
        <CertificateList certificates={certificates} />
      </div>

      <EntityCustomFields fields={customFields} entityType='student' entityId={id} />
    </div>
  );
}