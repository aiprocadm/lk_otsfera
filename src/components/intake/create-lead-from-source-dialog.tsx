'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Textarea, Field, Dialog } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { createLeadFromInboundAction, createLeadFromCallAction } from '@/server-actions/intake';

/**
 * Этап 7 (ФТ-1.6) — «Создать лид» из обращения/звонка: предзаполненная
 * редактируемая форма (валидация — та же, что у ручного лида; ошибки сервиса
 * списком role="alert"). Успех → переход на карточку лида.
 */

export type LeadSourceKind = 'inbound' | 'call';

export type LeadPrefill = {
  companyName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  subject: string;
};

const CONVERT_ERRORS: Record<string, string> = {
  already_converted: 'Из этого источника лид уже создан.',
  not_found: 'Источник не найден или недоступен.',
  forbidden: 'Нет доступа.',
};

export function CreateLeadFromSourceDialog({
  kind,
  sourceId,
  prefill,
  onClose,
}: {
  kind: LeadSourceKind;
  sourceId: string;
  prefill: LeadPrefill;
  onClose: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('sourceId', sourceId);
    setSubmitting(true);
    setMessages([]);
    const action = kind === 'inbound' ? createLeadFromInboundAction : createLeadFromCallAction;
    const res = await action(fd);
    setSubmitting(false);
    if (!res.ok) {
      if (res.error === 'validation' && res.messages?.length) {
        setMessages(res.messages);
        return;
      }
      toast.error(
        CONVERT_ERRORS[res.error] ?? errorMessageRu(res.error, 'Не удалось создать лид.')
      );
      return;
    }
    toast.success('Лид создан.');
    router.push(`/manager/leads/${res.leadId}`);
  }

  return (
    <Dialog open onClose={onClose} title="Создать лид" size="md" busy={submitting}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {messages.length > 0 && (
          <ul role="alert" className="text-sm text-red-600 list-disc pl-5 space-y-0.5">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <Field htmlFor="ls-company" label="Компания клиента">
          <Input
            id="ls-company"
            name="companyName"
            required
            maxLength={300}
            defaultValue={prefill.companyName}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field htmlFor="ls-contact" label="Контактное лицо">
            <Input
              id="ls-contact"
              name="contactName"
              required
              maxLength={200}
              defaultValue={prefill.contactName}
            />
          </Field>
          <Field htmlFor="ls-inn" label="ИНН (необязательно)">
            <Input id="ls-inn" name="inn" maxLength={12} inputMode="numeric" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field htmlFor="ls-phone" label="Телефон">
            <Input
              id="ls-phone"
              name="contactPhone"
              maxLength={30}
              defaultValue={prefill.contactPhone}
            />
          </Field>
          <Field htmlFor="ls-email" label="Email">
            <Input
              id="ls-email"
              name="contactEmail"
              maxLength={200}
              defaultValue={prefill.contactEmail}
            />
          </Field>
        </div>
        <Field htmlFor="ls-subject" label="Тема">
          <Input
            id="ls-subject"
            name="subject"
            required
            maxLength={300}
            defaultValue={prefill.subject}
          />
        </Field>
        <Field htmlFor="ls-notes" label="Примечание (необязательно)">
          <Textarea id="ls-notes" name="notes" rows={2} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Создаю…' : 'Создать лид'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
