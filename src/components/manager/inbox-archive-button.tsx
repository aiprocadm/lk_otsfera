'use client';

import React from 'react';
import { ActionToastButton } from '@/components/ui';
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
 * E2: архивация/восстановление обращения в инбоксе. Тонкая обёртка над
 * ActionToastButton — держит mode-ветку (тексты + выбор экшена) и
 * ERROR_LABELS-дельту.
 */
export function InboxArchiveButton({
  inboundMessageId,
  mode
}: {
  inboundMessageId: string;
  mode: 'archive' | 'restore';
}) {
  const text = MODE_TEXT[mode];
  const action = mode === 'archive' ? archiveInboundMessageAction : restoreInboundMessageAction;

  return (
    <ActionToastButton
      variant='secondary'
      size='sm'
      label={text.label}
      successText={text.success}
      errorLabels={ERROR_LABELS}
      action={() => action({ inboundMessageId })}
    />
  );
}
