'use client';
import React, { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { archiveContactAction, restoreContactAction } from '@/server-actions/contacts';

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет права на справочник контактов.',
  not_found: 'Контакт не найден — обновите страницу.',
  invalid: 'Этот контакт объединён с другим — вернуть его нельзя, откройте главный.',
};

/** «В архив» / «Вернуть из архива» (`У-180`): контакты не удаляются — история остаётся. */
export function ArchiveContactButton({
  contactId,
  isArchived,
}: {
  contactId: string;
  isArchived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = isArchived
        ? await restoreContactAction({ id: contactId })
        : await archiveContactAction({ id: contactId });
      if (result.ok) {
        toast.success(isArchived ? 'Контакт возвращён из архива' : 'Контакт в архиве');
        router.refresh();
        return;
      }
      toast.error(resolveErrorText(result.error, ERROR_LABEL));
    });
  }

  return (
    <Button variant="secondary" onClick={toggle} loading={pending} disabled={pending}>
      {isArchived ? 'Вернуть из архива' : 'В архив'}
    </Button>
  );
}
