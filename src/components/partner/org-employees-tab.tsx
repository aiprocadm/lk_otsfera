import React from 'react';
import { prisma } from '@/lib/db/prisma';

export async function EmployeesTab({ orgId }: { orgId: string }) {
  const rows = await prisma.organizationUser.findMany({
    where: { organizationId: orgId, isActive: true },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' }
  });

  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        В этой организации пока нет сотрудников.
      </div>
    );
  }

  return (
    <ul className='divide-y divide-gray-100 bg-white border border-gray-200 rounded-xl'>
      {rows.map((r) => (
        <li key={r.id} className='px-4 py-3 flex items-center justify-between'>
          <div>
            <div className='text-sm font-medium text-[#111111]'>{r.user.name}</div>
            <div className='text-xs text-gray-500'>{r.user.email}</div>
          </div>
          {r.roleInOrg && (
            <span className='text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded'>{r.roleInOrg}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
