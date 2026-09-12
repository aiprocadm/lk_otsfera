'use client';
import React from 'react';
import { ActionToastButton } from '@/components/ui';
import { setDialogStatusAction } from '@/server-actions/messengers';

const ERROR_LABELS: Record<string, string> = {
  not_found: 'Диалог не найден',
  forbidden: 'Нет доступа к диалогу',
};

const MODE = {
  open: { label: 'Закрыть диалог', next: 'closed' as const, success: 'Диалог закрыт' },
  closed: { label: 'Открыть снова', next: 'open' as const, success: 'Диалог открыт' },
} as const;

/**
 * Закрыть / открыть снова (спека 2026-09-12 §5.2). Тонкая обёртка над
 * `ActionToastButton`: тексты и выбор следующего состояния — здесь.
 */
export function DialogStatusButton({
  dialogId,
  status,
}: {
  dialogId: string;
  status: 'open' | 'closed';
}) {
  const mode = MODE[status];
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
