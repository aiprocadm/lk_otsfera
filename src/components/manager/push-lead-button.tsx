'use client';

import React, { useTransition } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { pushLeadToOneCAction } from '@/server-actions/manager/leads';

// Дельты поверх errorMessageRu (контекст ручной отправки лида в 1С).
// Локальная копия паттерна manager-lead-actions (rule-of-three: в общий модуль не выносим).
const ERROR_LABELS: Record<string, string> = {
  already_pushed: 'Лид уже отправлен в 1С',
  queue_error: 'Очередь недоступна, попробуйте позже'
};

function pushErrorText(code: string): string {
  return ERROR_LABELS[code] ?? errorMessageRu(code, `Не удалось выполнить действие: ${code}`);
}

/**
 * B3: ручная постановка лида в очередь oneCSync.pushLead. Отдельный компонент —
 * НЕ добавлять в manager-lead-actions.tsx (он и так вырос). Успешный экшен сам
 * ревалидирует страницу лида (revalidatePath), refresh здесь не нужен.
 */
export function PushLeadButton({ leadId }: { leadId: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await pushLeadToOneCAction({ leadId });
      if (res.ok) toast.success('Лид поставлен в очередь отправки в 1С');
      else toast.error(pushErrorText(res.error));
    });
  }

  return (
    <Button variant='secondary' loading={pending} onClick={onClick}>
      Отправить в 1С
    </Button>
  );
}
