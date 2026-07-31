'use client';

import React, { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { revokeAllSessionsAction } from '@/server-actions/security';

/**
 * Этап 9 (ФТ-11.2) — карточка «Безопасность» на страницах настроек всех пяти
 * кабинетов. Компонент роль-агностичный (домен один — собственные сессии
 * пользователя), поэтому общий, а не sibling-копии по ролям (§4).
 * После ревокации текущий токен тоже недействителен → уходим на /login.
 */
export function SecurityCard() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onRevoke() {
    startTransition(async () => {
      const res = await revokeAllSessionsAction();
      if (!res.ok) {
        toast.error(errorMessageRu(res.error));
        return;
      }
      router.push('/login');
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">Безопасность</h2>
      <p className="mt-1 text-sm text-gray-500">
        Завершает работу во всех браузерах и на всех устройствах, включая это. Пригодится, если вы
        входили с чужого компьютера или потеряли телефон. Дальше нужно будет войти заново.
      </p>
      <div className="mt-3">
        <Button type="button" variant="danger" onClick={onRevoke} disabled={isPending}>
          {isPending ? 'Выходим…' : 'Выйти на всех устройствах'}
        </Button>
      </div>
    </div>
  );
}
