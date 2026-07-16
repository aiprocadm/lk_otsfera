'use client';

import React, { useTransition } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';

/**
 * Кнопка «клик → server action → toast»: общий примитив для тонких
 * обёрток (claim-order, push-lead, inbox-archive, requeue-pending).
 * Обёртки держат свои тексты/ERROR_LABELS-дельты и собирают payload в
 * замыкании `action`; здесь — только useTransition + toast-развилка.
 * Успешный экшен сам ревалидирует данные (revalidatePath в экшенах),
 * поэтому router.refresh не нужен.
 */
export function ActionToastButton({
  label,
  successText,
  action,
  errorLabels,
  variant,
  size,
  disabled
}: {
  label: string;
  successText: string;
  action: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Дельта поверх errorMessageRu — контекстные тексты кодов ошибок. */
  errorLabels?: Record<string, string>;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await action();
      if (res.ok) toast.success(successText);
      else toast.error(resolveErrorText(res.error, errorLabels));
    });
  }

  return (
    <Button variant={variant} size={size} loading={pending} disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}
