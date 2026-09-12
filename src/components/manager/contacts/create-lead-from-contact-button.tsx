'use client';
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Input, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { createLeadFromContactAction } from '@/server-actions/contacts';

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет права создавать лиды.',
  not_found: 'Контакт не найден — обновите страницу.',
  validation: 'Укажите тему лида.',
};

/**
 * «Создать лид» из карточки контакта (`У-179`): имя, телефон, почта и
 * организация подставляются сервером; человек вводит только тему и заметку.
 * Лиды живут в кабинете менеджера — после создания открываем карточку лида.
 */
export function CreateLeadFromContactButton({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!subject.trim()) {
      setError(ERROR_LABEL.validation!);
      return;
    }
    startTransition(async () => {
      const result = await createLeadFromContactAction({
        contactId,
        subject: subject.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      if (result.ok) {
        toast.success('Лид создан');
        close();
        router.push(`/manager/leads/${result.leadId}`);
        return;
      }
      // Валидатор лида говорит, чего не хватает (например, у контакта нет ни
      // телефона, ни почты) — показываем его слова, а не общий код.
      const detailed =
        'messages' in result && result.messages?.length ? result.messages.join(' ') : null;
      setError(detailed ?? resolveErrorText(result.error, ERROR_LABEL));
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Создать лид
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Новый лид из контакта"
        busy={pending}
        error={error}
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field htmlFor="lead-from-contact-subject" label="Тема">
            <Input
              id="lead-from-contact-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              maxLength={500}
              disabled={pending}
              placeholder="Обучение по охране труда, 12 человек"
            />
          </Field>
          <Field htmlFor="lead-from-contact-notes" label="Заметка">
            <Textarea
              id="lead-from-contact-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={4000}
              disabled={pending}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Отмена
            </Button>
            <Button type="submit" loading={pending} disabled={pending}>
              Создать лид
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
