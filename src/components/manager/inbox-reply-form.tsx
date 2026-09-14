'use client';
import React from 'react';

import { useRef } from 'react';
import { toast } from 'sonner';
import { replyInboundAction } from '@/server-actions/inbound';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Textarea, Button } from '@/components/ui';

/**
 * Ответ на уже привязанное (`status==='bound'`) обращение. Отправляет через
 * `replyInboundAction` → `replyToInbound` (реальный исходящий транспорт
 * канала). С `У-205` это касается и почты: ответ уходит письмом с `Reply-To`
 * на входящий ящик, поэтому ответ клиента возвращается в ту же переписку.
 */

/**
 * Дельта поверх центральной карты: только контекстные уточнения forbidden/
 * not_found. Остальной контракт action'а (`invalid`, `reply_failed`) уже
 * точно покрыт errorMessageRu — не дублируем (E3).
 */
const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Обращение недоступно вашей компании.',
  not_found: 'Обращение не найдено.',
};

export function InboxReplyForm({ inboundMessageId }: { inboundMessageId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  const { formAction, pending, errorText } = useFormAction<{ ok: true }>({
    action: (formData) =>
      replyInboundAction({
        inboundMessageId,
        text: String(formData.get('text') ?? ''),
      }),
    errorMap: ERROR_LABEL,
    onSuccess: () => {
      toast.success('Ответ отправлен');
      formRef.current?.reset();
    },
  });

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <Textarea
        name="text"
        rows={2}
        required
        disabled={pending}
        placeholder="Текст ответа…"
        aria-label="Текст ответа"
      />
      <div className="flex items-center justify-between gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={pending}>
          Ответить
        </Button>
        {errorText && (
          <p role="alert" className="text-xs text-red-600">
            {errorText}
          </p>
        )}
      </div>
    </form>
  );
}
