'use client';

import { useTransition } from 'react';
import { setManagerRoleAction } from '@/server-actions/admin/manager';

export function ManagerRoleControl({ userId, current }: { userId: string; current: string | null }) {
  const [pending, startTransition] = useTransition();
  const isLeader = current === 'leader';

  function setRole(role: 'leader' | 'member') {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('userId', userId);
      fd.set('role', role);
      await setManagerRoleAction(fd);
    });
  }

  return (
    <div className='flex items-center gap-2'>
      <span className='text-sm text-gray-600'>Роль в кабинете менеджера:</span>
      <span className='font-medium'>{isLeader ? 'Руководитель' : 'Менеджер'}</span>
      <button
        type='button'
        disabled={pending}
        onClick={() => setRole(isLeader ? 'member' : 'leader')}
        className='rounded-md border px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-50'
      >
        {isLeader ? 'Снять руководителя' : 'Назначить руководителем'}
      </button>
    </div>
  );
}
