'use client';

import React, { useTransition } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { pushLeadToOneCAction } from '@/server-actions/manager/leads';

// Дельта поверх errorMessageRu (контекст ручной отправки лида в 1С);
// queue_unavailable/not_found/validation берутся из общего словаря.
const ERROR_LABELS: Record<string, string> = {
  already_pushed: 'Лид уже отправлен в 1С'
};

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
      else toast.error(resolveErrorText(res.error, ERROR_LABELS));
    });
  }

  return (
    <Button variant='secondary' loading={pending} onClick={onClick}>
      Отправить в 1С
    </Button>
  );
}
