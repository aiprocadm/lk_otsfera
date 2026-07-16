'use client';

import React, { useTransition } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import {
  archiveInboundMessageAction,
  restoreInboundMessageAction
} from '@/server-actions/inbound';

// Дельта поверх errorMessageRu (контекст архива обращений): общий словарь
// говорит про загрузку («Нет прав на загрузку.») и заказ («Заказ не
// найден.») — здесь нужны тексты про обращение.
const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Нет доступа к обращению',
  not_found: 'Обращение не найдено'
};

const MODE_TEXT = {
  archive: { label: 'В архив', success: 'Обращение перемещено в архив' },
  restore: { label: 'Вернуть', success: 'Обращение восстановлено' }
} as const;

/**
 * E2: архивация/восстановление обращения в инбоксе. Успешный экшен сам
 * ревалидирует /manager/inbox (revalidatePath), refresh здесь не нужен.
 */
export function InboxArchiveButton({
  inboundMessageId,
  mode
}: {
  inboundMessageId: string;
  mode: 'archive' | 'restore';
}) {
  const [pending, startTransition] = useTransition();
  const text = MODE_TEXT[mode];

  function onClick() {
    startTransition(async () => {
      const action = mode === 'archive' ? archiveInboundMessageAction : restoreInboundMessageAction;
      const res = await action({ inboundMessageId });
      if (res.ok) toast.success(text.success);
      else toast.error(resolveErrorText(res.error, ERROR_LABELS));
    });
  }

  return (
    <Button variant='secondary' size='sm' loading={pending} onClick={onClick}>
      {text.label}
    </Button>
  );
}
