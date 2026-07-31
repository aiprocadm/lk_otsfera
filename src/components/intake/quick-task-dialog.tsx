'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Field, Dialog } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { createTaskAction } from '@/server-actions/tasks';

/**
 * Этап 7 (ФТ-7.5) — быстрая задача из источника (звонок «перезвонить»,
 * обращение, заявка): предзаполненное название + срок + «на себя» (по
 * умолчанию), автопривязка организации источника (если она известна).
 */
export function QuickTaskDialog({
  titlePrefill,
  organizationId,
  currentUserId,
  onClose,
}: {
  titlePrefill: string;
  organizationId: string | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (organizationId) fd.set('linkedOrganizationId', organizationId);
    if (fd.get('assignSelf') === 'on') fd.append('assigneeIds', currentUserId);
    fd.delete('assignSelf');
    setSubmitting(true);
    const res = await createTaskAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось создать задачу.'));
      return;
    }
    toast.success('Задача создана.');
    onClose();
    startTransition(() => router.refresh());
  }

  return (
    <Dialog open onClose={onClose} title="Новая задача" size="sm" busy={submitting}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field htmlFor="qt-title" label="Название">
          <Input
            id="qt-title"
            name="title"
            required
            maxLength={200}
            defaultValue={titlePrefill}
            autoFocus
          />
        </Field>
        <div className="flex items-center gap-3">
          <Field htmlFor="qt-due" label="Срок">
            <Input id="qt-due" name="dueDate" type="date" className="w-40" />
          </Field>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none mt-5">
            <input type="checkbox" name="assignSelf" defaultChecked className="h-4 w-4 rounded" />
            на себя
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Создаю…' : 'Создать'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
