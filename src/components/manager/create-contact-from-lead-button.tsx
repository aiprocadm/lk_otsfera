'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { contactHref } from '@/lib/navigation/contactsHrefs';
import { createContactAction } from '@/server-actions/contacts';

type Props = {
  name: string;
  phone: string | null;
  email: string | null;
  organizationId: string | null;
};

/**
 * «Создать контакт из данных лида» (`У-180`, спека 04 §«карточка лида»).
 *
 * Форма без полей — как у «Завести организацию» рядом: имя, телефон и почта
 * уже показаны на карточке над кнопкой, организация — та, к которой привязан
 * лид. Переспрашивать то, что видно, незачем; поправить можно в карточке
 * контакта, куда кнопка и ведёт. Если телефон или почта уже у другого
 * контакта компании — не ошибка, а ответ «вот он»: открываем его карточку.
 */
export function CreateContactFromLeadButton({ name, phone, email, organizationId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    const res = await createContactAction({
      name,
      organizationId,
      channels: [
        ...(phone ? [{ type: 'phone' as const, value: phone }] : []),
        ...(email ? [{ type: 'email' as const, value: email }] : []),
      ],
    });
    setBusy(false);
    if (!res.ok) {
      if (res.error === 'contact_channel_taken') {
        toast.success(
          `Этот телефон или почта уже у контакта «${res.conflict.name}» — открываю его.`
        );
        startTransition(() => router.push(contactHref('manager', res.conflict.contactId)));
        return;
      }
      toast.error(errorMessageRu(res.error, 'Не удалось создать контакт.'));
      return;
    }
    toast.success('Контакт создан.');
    startTransition(() => router.push(contactHref('manager', res.contactId)));
  }

  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={run}>
      Создать контакт из данных лида
    </Button>
  );
}
