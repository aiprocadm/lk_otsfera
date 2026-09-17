'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { replyFromCabinetAction } from '@/server-actions/cabinetDialogs';

/**
 * Поле «Написать менеджеру» (`У-234`). Сообщение всегда уходит в переписку
 * кабинета — даже когда открыт диалог другого канала: отвечать в чужой канал
 * из кабинета нельзя (`Р-Э6-1`), и подсказка об этом стоит рядом.
 */
export function CabinetReplyForm({ hint }: { hint?: string | undefined }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('text', text);
      const res = await replyFromCabinetAction(fd);
      if (!res.ok) {
        toast.error(
          res.messages?.join(' ') ??
            errorMessageRu(res.error, 'Не удалось отправить сообщение — попробуйте ещё раз.')
        );
        return;
      }
      setText('');
      toast.success('Сообщение отправлено — менеджер ответит здесь.');
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="cabinet-reply-form">
      <label className="block text-sm font-medium text-[#111111]" htmlFor="cabinet-reply">
        Написать менеджеру
      </label>
      <Textarea
        id="cabinet-reply"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Опишите вопрос — менеджер увидит сообщение в работе и ответит здесь"
      />
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      <Button
        size="sm"
        loading={busy}
        disabled={text.trim().length === 0}
        onClick={() => void send()}
      >
        Отправить
      </Button>
    </div>
  );
}
