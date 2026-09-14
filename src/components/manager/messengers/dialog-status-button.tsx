'use client';
import React from 'react';
import { ActionToastButton } from '@/components/ui';
import type { DialogStatus } from '@/lib/services/messengers/dialogStatus';
import { setDialogStatusAction } from '@/server-actions/messengers';

const ERROR_LABELS: Record<string, string> = {
  not_found: 'Диалог не найден',
  forbidden: 'Нет доступа к диалогу',
};

const CLOSE = { label: 'Закрыть диалог', next: 'closed' as const, success: 'Диалог закрыт' };
const REOPEN = { label: 'Открыть снова', next: 'open' as const, success: 'Диалог открыт' };

/**
 * Закрыть / открыть снова (спека 2026-09-12 §5.2). Тонкая обёртка над
 * `ActionToastButton`: тексты и выбор следующего состояния — здесь.
 *
 * Кнопка смотрит только на «закрыт или нет»: промежуточные статусы ожидания
 * (`У-207`) руками не ставятся, их считает автомат, поэтому у живого диалога
 * в любом из них действие одно — закрыть.
 */
export function DialogStatusButton({
  dialogId,
  status,
}: {
  dialogId: string;
  status: DialogStatus;
}) {
  const mode = status === 'closed' ? REOPEN : CLOSE;
  return (
    <ActionToastButton
      variant="secondary"
      label={mode.label}
      successText={mode.success}
      errorLabels={ERROR_LABELS}
      action={() => setDialogStatusAction({ dialogId, status: mode.next })}
    />
  );
}
