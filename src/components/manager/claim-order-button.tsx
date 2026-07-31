'use client';

import React from 'react';
import { ActionToastButton } from '@/components/ui';
import { claimOrderAction } from '@/server-actions/manager/orderAssignment';

// Дельта поверх errorMessageRu: центральный already_assigned описывает
// назначение менеджера на организацию, а forbidden — загрузку документов;
// здесь контекст — самозабор заказа.
const ERROR_LABELS: Record<string, string> = {
  already_assigned: 'Заказ уже взят другим менеджером',
  forbidden: 'Нет доступа к этому заказу.',
};

/**
 * A2 (§5.3 self-assign): менеджер забирает незакреплённый заказ в работу.
 * Рендерится только при managerId === null. Тонкая обёртка над
 * ActionToastButton — держит guard, тексты и ERROR_LABELS-дельту.
 */
export function ClaimOrderButton({
  orderId,
  managerId,
}: {
  orderId: string;
  managerId: string | null;
}) {
  if (managerId !== null) return null;

  return (
    <ActionToastButton
      variant="secondary"
      label="Взять в работу"
      successText="Заказ закреплён за вами"
      errorLabels={ERROR_LABELS}
      action={() => claimOrderAction({ orderId })}
    />
  );
}
