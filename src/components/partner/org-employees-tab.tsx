import React from 'react';
import type { PrismaClient } from '@prisma/client';
import { listOrgEmployees } from '@/lib/services/partner/orgEmployees';
import { AddStudentDialog } from '@/components/students/add-student-dialog';
import { OrgEmployeesList } from './org-employees-list';

export async function EmployeesTab({ orgId, prisma }: { orgId: string; prisma: PrismaClient }) {
  const rows = await listOrgEmployees(prisma, { orgId });

  return (
    <div className="space-y-3">
      {/* У-25/У-63 (этап 5): долг этапа 4 закрыт — кнопке наконец есть что звать.
          Право на добавление проверяет сервис, а не эта кнопка (§4). */}
      <div className="flex justify-end">
        <AddStudentDialog organizationId={orgId} />
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-700">В этой организации пока нет сотрудников.</p>
          <p className="text-xs text-gray-500 mt-1">
            Добавьте первого кнопкой выше — или дождитесь, когда организация пригласит их в свой
            кабинет.
          </p>
        </div>
      ) : (
        <OrgEmployeesList rows={rows} />
      )}
    </div>
  );
}
