'use client';

import React, { useTransition } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { claimOrderAction } from '@/server-actions/manager/orderAssignment';

// Дельта поверх errorMessageRu: центральный already_assigned описывает
// назначение менеджера на организацию, здесь контекст — самозабор заказа.
const ERROR_LABELS: Record<string, string> = {
  already_assigned: 'Заказ уже взят другим менеджером'
};

/**
 * A2 (§5.3 self-assign): менеджер забирает незакреплённый заказ в работу.
 * Рендерится только при managerId === null. Успешный claimOrderAction сам
 * ревалидирует деталку и списки (revalidateOrder в orderAssignment.ts),
 * поэтому router.refresh здесь не нужен.
 */
export function ClaimOrderButton({
  orderId,
  managerId
}: {
  orderId: string;
  managerId: string | null;
}) {
  const [pending, startTransition] = useTransition();

  if (managerId !== null) return null;

  function onClick() {
    startTransition(async () => {
      const res = await claimOrderAction({ orderId });
      if (res.ok) toast.success('Заказ закреплён за вами');
      else toast.error(resolveErrorText(res.error, ERROR_LABELS));
    });
  }

  return (
    <Button variant='secondary' loading={pending} onClick={onClick}>
      Взять в работу
    </Button>
  );
}
