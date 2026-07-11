'use client';

import React, { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { regenerateUserBackupCodesAction } from '@/server-actions/admin/users';

// Админ перевыпускает коды восстановления 2FA сотруднику из его карточки.
// Показывается только для staff-target при включённом флаге staff_2fa (гейт
// на странице). Новые коды показываются один раз.
export function AdminBackupCodesControl({ userId }: { userId: string }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function onRegenerate() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', userId);
      const res = await regenerateUserBackupCodesAction(fd);
      if (res.ok) {
        setCodes(res.codes);
      } else {
        toast.error(errorMessageRu(res.error));
      }
    });
  }

  return (
    <div className='rounded-lg border p-4 space-y-2'>
      <h2 className='text-sm font-semibold text-[#111111]'>Коды восстановления (2FA)</h2>
      <p className='text-sm text-gray-500'>
        Перевыпуск для сотрудника, потерявшего доступ к почте и старым кодам.
        Прежние коды аннулируются; новые показываются один раз.
      </p>
      {codes ? (
        <div>
          <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'>
            Передайте эти коды сотруднику сейчас — после закрытия страницы они не покажутся.
          </div>
          <ul className='mt-3 grid grid-cols-2 gap-2 font-mono text-sm'>
            {codes.map((c) => (
              <li key={c} className='rounded border border-gray-200 bg-gray-50 px-3 py-1.5 tracking-widest'>
                {c}
              </li>
            ))}
          </ul>
          <div className='mt-3'>
            <Button type='button' variant='secondary' onClick={onRegenerate} disabled={isPending}>
              {isPending ? 'Генерирую…' : 'Перевыпустить заново'}
            </Button>
          </div>
        </div>
      ) : (
        <Button type='button' onClick={onRegenerate} disabled={isPending}>
          {isPending ? 'Генерирую…' : 'Перевыпустить коды восстановления'}
        </Button>
      )}
    </div>
  );
}
