'use client';

import React from 'react';
import { ActionToastButton } from '@/components/ui';
import { requeuePendingRecordAction } from '@/server-actions/admin/pendingRecords';

// Дельты поверх errorMessageRu: центральный not_found говорит про заказ,
// forbidden — про загрузку документов; здесь контекст — отложенная запись 1С.
const ERROR_LABELS: Record<string, string> = {
  not_dead: 'Запись уже не в статусе dead.',
  not_found: 'Запись не найдена.',
  forbidden: 'Нет прав на это действие.',
};

/**
 * G1: возврат dead-записи 1С в очередь replay. Рендерится только у dead-строк
 * (pending и так подберётся ближайшим live-sync). Тонкая обёртка над
 * ActionToastButton — держит ERROR_LABELS-дельту и FormData-сборку в замыкании.
 */
export function RequeuePendingButton({ id }: { id: string }) {
  return (
    <ActionToastButton
      variant="secondary"
      size="sm"
      label="Вернуть в очередь"
      successText="Запись возвращена в очередь"
      errorLabels={ERROR_LABELS}
      action={() => {
        const fd = new FormData();
        fd.set('id', id);
        return requeuePendingRecordAction(fd);
      }}
    />
  );
}
