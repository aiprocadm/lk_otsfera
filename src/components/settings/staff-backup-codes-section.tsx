'use client';

import React, { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { regenerateBackupCodesAction } from '@/server-actions/staff/backupCodes';

// Секция «Коды восстановления» на страницах настроек staff-кабинетов. Один
// компонент на admin/manager/leader (домен один, роли не расходятся — §4).
export function StaffBackupCodesSection() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function onGenerate() {
    startTransition(async () => {
      const res = await regenerateBackupCodesAction();
      if (res.ok) {
        setCodes(res.codes);
      } else {
        toast.error(errorMessageRu(res.error));
      }
    });
  }

  function onCopy() {
    if (!codes) return;
    void navigator.clipboard.writeText(codes.join('\n')).then(
      () => toast.success('Коды скопированы'),
      () => toast.error('Не удалось скопировать')
    );
  }

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-4'>
      <h2 className='text-sm font-semibold text-gray-700'>Коды восстановления (2FA)</h2>
      <p className='mt-1 text-sm text-gray-500'>
        Одноразовые коды на случай, если у вас нет доступа к почте при входе.
        Сгенерируйте и сохраните их в надёжном месте — они показываются один раз.
      </p>

      {codes ? (
        <div className='mt-3'>
          <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'>
            Сохраните эти коды сейчас — после закрытия страницы они больше не покажутся.
            Прежние коды восстановления аннулированы.
          </div>
          <ul className='mt-3 grid grid-cols-2 gap-2 font-mono text-sm'>
            {codes.map((c) => (
              <li key={c} className='rounded border border-gray-200 bg-gray-50 px-3 py-1.5 tracking-widest'>
                {c}
              </li>
            ))}
          </ul>
          <div className='mt-3 flex gap-2'>
            <Button type='button' variant='secondary' onClick={onCopy}>
              Скопировать
            </Button>
            <Button type='button' variant='secondary' onClick={onGenerate} disabled={isPending}>
              {isPending ? 'Генерирую…' : 'Сгенерировать заново'}
            </Button>
          </div>
        </div>
      ) : (
        <div className='mt-3'>
          <Button type='button' onClick={onGenerate} disabled={isPending}>
            {isPending ? 'Генерирую…' : 'Сгенерировать коды восстановления'}
          </Button>
        </div>
      )}
    </div>
  );
}
