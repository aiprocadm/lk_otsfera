'use client';

import React, { useTransition } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { requeuePendingRecordAction } from '@/server-actions/admin/pendingRecords';

// Дельты поверх errorMessageRu: центральный not_found говорит про заказ,
// forbidden — про загрузку документов; здесь контекст — отложенная запись 1С.
const ERROR_LABELS: Record<string, string> = {
  not_dead: 'Запись уже не в статусе dead',
  not_found: 'Запись не найдена.',
  forbidden: 'Нет прав на это действие.',
};

/**
 * G1: возврат dead-записи 1С в очередь replay. Рендерится только у dead-строк
 * (pending и так подберётся ближайшим live-sync). Успешный экшен сам
 * ревалидирует /admin/sync (revalidatePath в pendingRecords action), поэтому
 * router.refresh здесь не нужен.
 */
export function RequeuePendingButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const res = await requeuePendingRecordAction(fd);
      if (res.ok) toast.success('Запись возвращена в очередь');
      else toast.error(resolveErrorText(res.error, ERROR_LABELS));
    });
  }

  return (
    <Button variant='secondary' size='sm' loading={pending} onClick={onClick}>
      Вернуть в очередь
    </Button>
  );
}
