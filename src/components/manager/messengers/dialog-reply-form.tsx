'use client';
import React, { useRef } from 'react';
import { toast } from 'sonner';
import { sendDialogMessageAction } from '@/server-actions/messengers';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Textarea, Button } from '@/components/ui';

/**
 * Ответ из диалога (спека 2026-09-12 §5.2). После удачной отправки страница
 * перечитывается (`refresh`) — новое сообщение встаёт в ленту. Коды `invalid`,
 * `text_too_long`, `channel_unavailable`, `reply_failed` переводит общий
 * словарь; здесь — только контекстные уточнения.
 */
const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет доступа к этому диалогу.',
  not_found: 'Диалог не найден.',
};

export function DialogReplyForm({ dialogId }: { dialogId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  const { formAction, pending, errorText } = useFormAction<{ messageId: string }>({
    action: (formData) =>
      sendDialogMessageAction({ dialogId, text: String(formData.get('text') ?? '') }),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Сообщение отправлено');
      formRef.current?.reset();
    },
  });

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <Textarea
        name="text"
        rows={3}
        required
        disabled={pending}
        placeholder="Напишите клиенту…"
        aria-label="Текст сообщения"
      />
      <div className="flex items-center justify-between gap-2">
        <Button type="submit" loading={pending} disabled={pending}>
          Отправить
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
