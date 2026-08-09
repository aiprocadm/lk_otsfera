import React from 'react';
import type { PrismaClient } from '@prisma/client';
import { listOrgEmployees } from '@/lib/services/partner/orgEmployees';
import { OrgEmployeesList } from './org-employees-list';

export async function EmployeesTab({ orgId, prisma }: { orgId: string; prisma: PrismaClient }) {
  const rows = await listOrgEmployees(prisma, { orgId });

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
        <p className="text-sm text-gray-700">В этой организации пока нет сотрудников.</p>
        <p className="text-xs text-gray-500 mt-1">
          Сотрудники появятся здесь, когда организация пригласит их в свой кабинет.
        </p>
      </div>
    );
  }

  // У-63: поиск по списку. Кнопка добавления — этапом 5 вместе с У-25.
  return <OrgEmployeesList rows={rows} />;
}
