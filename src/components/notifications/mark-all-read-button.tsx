'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { markAllNotificationsReadAction } from '@/server-actions/notifications';

/**
 * Главное действие страницы «Уведомления» (`У-228`, `Р-Э5-3`).
 *
 * Когда непрочитанных нет, кнопка не исчезает, а объясняет, почему неактивна:
 * пропавшая кнопка выглядит как поломка, а неактивная с подсказкой — как
 * порядок.
 */
export function MarkAllReadButton({
  basePath,
  unreadTotal,
}: {
  basePath: string;
  unreadTotal: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function handleClick() {
    setBusy(true);
    const res = await markAllNotificationsReadAction(basePath);
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось отметить уведомления.'));
      return;
    }
    toast.success(
      res.count && res.count > 0 ? `Прочитано: ${res.count}.` : 'Непрочитанных не было.'
    );
    startTransition(() => router.refresh());
  }

  return (
    <Button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy || unreadTotal === 0}
      title={unreadTotal === 0 ? 'Непрочитанных уведомлений нет' : undefined}
    >
      {busy ? 'Отмечаю…' : 'Отметить все прочитанными'}
    </Button>
  );
}
