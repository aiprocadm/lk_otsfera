'use client';
import React from 'react';

import { useRef } from 'react';
import { toast } from 'sonner';
import { replyInboundAction } from '@/server-actions/inbound';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Textarea, Button, Input } from '@/components/ui';

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

/** «a@x.ru, b@y.ru; c@z.ru» → список адресов (`У-316`). */
function parseCc(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

export function InboxReplyForm({
  inboundMessageId,
  email,
}: {
  inboundMessageId: string;
  /** `У-316`: ответ на письмо — поле «Копия» и подпись под текстом. */
  email?: { signature: string } | undefined;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const { formAction, pending, errorText } = useFormAction<{ ok: true }>({
    action: (formData) =>
      replyInboundAction({
        inboundMessageId,
        text: String(formData.get('text') ?? ''),
        ...(email ? { cc: parseCc(String(formData.get('cc') ?? '')) } : {}),
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
      {email && (
        <>
          <Input
            name="cc"
            disabled={pending}
            placeholder="Копия: адреса через запятую"
            aria-label="Копия"
          />
          {email.signature && (
            <pre
              aria-label="Подпись"
              className="whitespace-pre-wrap rounded border border-gray-100 bg-gray-50 px-2 py-1 font-sans text-xs text-gray-500"
            >
              {email.signature}
            </pre>
          )}
        </>
      )}
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
