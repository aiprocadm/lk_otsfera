'use client';

import { useTransition } from 'react';
import type { CompanyManagerRow } from '@/lib/services/manager/team';
import { leaderDeactivateAssignmentAction } from '@/server-actions/manager/team';

export function ManagerRosterPanel({ roster }: { roster: CompanyManagerRow[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <section className='space-y-3'>
      <h2 className='text-lg font-medium text-[#111111]'>Менеджеры компании</h2>
      {roster.length === 0 && <p className='text-sm text-gray-600'>Менеджеров пока нет.</p>}
      <ul className='divide-y rounded-lg border'>
        {roster.map((m) => (
          <li key={m.id} className='flex items-center justify-between gap-4 p-3'>
            <div>
              <p className='font-medium text-[#111111]'>
                {m.name}{' '}
                {m.managerRole === 'leader' && (
                  <span className='ml-1 rounded bg-[#F97316] px-2 py-0.5 text-xs text-white'>Руководитель</span>
                )}
              </p>
              <p className='text-sm text-gray-600'>{m.email}</p>
              <p className='text-xs text-gray-500'>
                Организации:{' '}
                {m.assignments.filter((a) => a.isActive).map((a) => a.organizationName).join(', ') || '—'}
              </p>
            </div>
            <div className='flex gap-2'>
              {m.assignments.filter((a) => a.isActive).map((a) => (
                <button
                  key={a.id}
                  type='button'
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const fd = new FormData();
                      fd.set('assignmentId', a.id);
                      await leaderDeactivateAssignmentAction(fd);
                    })
                  }
                  className='rounded-md border px-2 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50'
                >
                  Снять с {a.organizationName}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
