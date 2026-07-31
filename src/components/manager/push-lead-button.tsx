'use client';

import React from 'react';
import { ActionToastButton } from '@/components/ui';
import { pushLeadToOneCAction } from '@/server-actions/manager/leads';

// Дельта поверх errorMessageRu (контекст ручной отправки лида в 1С):
// центральный not_found говорит «Заказ не найден.», здесь сущность — заявка;
// queue_unavailable/validation берутся из общего словаря.
const ERROR_LABELS: Record<string, string> = {
  already_pushed: 'Лид уже отправлен в 1С',
  not_found: 'Заявка не найдена.',
};

/**
 * B3: ручная постановка лида в очередь oneCSync.pushLead. Отдельный компонент —
 * НЕ добавлять в manager-lead-actions.tsx (он и так вырос). Тонкая обёртка
 * над ActionToastButton — держит тексты и ERROR_LABELS-дельту.
 */
export function PushLeadButton({ leadId }: { leadId: string }) {
  return (
    <ActionToastButton
      variant="secondary"
      label="Отправить в 1С"
      successText="Лид поставлен в очередь отправки в 1С"
      errorLabels={ERROR_LABELS}
      action={() => pushLeadToOneCAction({ leadId })}
    />
  );
}
