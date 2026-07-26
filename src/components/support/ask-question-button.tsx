'use client';

import React, { useState } from 'react';
import { Button, Input, Textarea, Field, Dialog } from '@/components/ui';
import { toast } from '@/lib/ui/toast';

/**
 * Этап 9 (ФТ-11.1) — «Задать вопрос» в шапке кабинетов партнёра и
 * организации. Вопрос уходит в общий поток обращений (канал «кабинет») и
 * попадает сотрудникам в «Обращения» и «Входящие в работу». Клиент получает
 * короткий код обращения.
 */

const ERRORS: Record<string, string> = {
  too_large: 'Файл слишком большой.',
  invalid_mime: 'Такой тип файла не поддерживается.',
  storage: 'Не удалось загрузить файл. Попробуйте позже.',
  forbidden: 'Недоступно для вашей роли.'
};

export function AskQuestionButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setMessages([]);
    const res = await fetch('/api/support/question', { method: 'POST', body: fd }).catch(() => null);
    setBusy(false);

    if (!res || !res.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: string; messages?: string[] } | null;
      if (data?.messages?.length) {
        setMessages(data.messages);
        return;
      }
      toast.error(ERRORS[data?.error ?? ''] ?? 'Не удалось отправить обращение.');
      return;
    }

    const data = (await res.json().catch(() => null)) as { code?: string } | null;
    toast.success(data?.code ? `Обращение ${data.code} принято — мы ответим в кабинете.` : 'Обращение принято.');
    setOpen(false);
  }

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className={className ?? 'text-xs text-gray-400 hover:text-[#F97316] transition-colors px-2 py-1 border border-gray-700 rounded hover:border-[#F97316]'}
      >
        Задать вопрос
      </button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title='Задать вопрос' size='md' busy={busy}>
          <form onSubmit={handleSubmit} className='space-y-4'>
            <p className='text-sm text-gray-600'>
              Опишите вопрос — он попадёт менеджеру. Ответ придёт уведомлением в кабинет.
            </p>
            <Field htmlFor='q-subject' label='Тема'>
              <Input id='q-subject' name='subject' required maxLength={200} autoFocus />
            </Field>
            <Field htmlFor='q-body' label='Вопрос'>
              <Textarea id='q-body' name='body' required rows={5} maxLength={5000} />
            </Field>
            <Field htmlFor='q-file' label='Файл (необязательно)'>
              <input
                id='q-file'
                name='file'
                type='file'
                className='block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-[#F3F4F6] file:px-3 file:py-1.5 file:text-sm'
              />
            </Field>
            {messages.length > 0 && (
              <ul role='alert' className='text-sm text-red-600 list-disc pl-5 space-y-0.5'>
                {messages.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <div className='flex justify-end gap-2'>
              <Button type='button' variant='secondary' onClick={() => setOpen(false)} disabled={busy}>
                Отмена
              </Button>
              <Button type='submit' disabled={busy}>
                {busy ? 'Отправляю…' : 'Отправить'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
