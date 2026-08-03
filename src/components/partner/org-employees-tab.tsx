import React from 'react';
import type { PrismaClient } from '@prisma/client';
import { listOrgEmployees } from '@/lib/services/partner/orgEmployees';

export async function EmployeesTab({ orgId, prisma }: { orgId: string; prisma: PrismaClient }) {
  const rows = await listOrgEmployees(prisma, { orgId });

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
        В этой организации пока нет сотрудников.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-xl">
      {rows.map((r) => (
        <li key={r.id} className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-[#111111]">{r.user.name}</div>
            <div className="text-xs text-gray-500">{r.user.email}</div>
          </div>
          {r.roleInOrg && (
            <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">
              {r.roleInOrg}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
