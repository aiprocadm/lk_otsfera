'use client';
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { retryDialogMessageAction } from '@/server-actions/messengers';

/**
 * «Повторить» у недоставленного сообщения (`У-213`).
 *
 * Отдельная маленькая кнопка прямо в ленте, а не действие в шапке диалога:
 * повторяют конкретную реплику, и человек должен видеть, какую именно.
 *
 * После неудачи показываем НОВУЮ причину: она могла измениться («бот
 * заблокирован» вместо «сеть недоступна»), и повторять дальше бессмысленно,
 * пока не решена та беда, о которой говорит текст.
 */
const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Мессенджеры выключены.',
  not_found: 'Сообщение не найдено — обновите страницу.',
  not_failed: 'Это сообщение уже доставлено или ещё отправляется.',
  channel_unavailable: 'Канал не подключён — обратитесь к администратору.',
  validation: 'Не удалось повторить отправку.',
};

export function RetryMessageButton({
  dialogId,
  messageId,
}: {
  dialogId: string;
  messageId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryDialogMessageAction({ dialogId, messageId });
      if (result.ok) {
        router.refresh();
        return;
      }
      // Причина от провайдера точнее любой нашей подписи — показываем её.
      const reason = 'reason' in result ? result.reason : undefined;
      setError(reason ?? ERROR_LABEL[result.error] ?? 'Не удалось повторить отправку.');
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="ml-2 text-[11px] font-medium text-[#EA580C] underline hover:no-underline disabled:opacity-50"
      >
        {pending ? 'Отправляем…' : 'Повторить'}
      </button>
      {error && (
        <span role="alert" className="ml-2 text-[11px] text-red-600">
          {error}
        </span>
      )}
    </>
  );
}
