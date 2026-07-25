'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Field, Dialog } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { createDealAction, updateDealAction } from '@/server-actions/deals';

/**
 * Этап 6 (PR-1) — создание/редактирование сделки (по образцу task-dialog).
 * Валидационные сообщения сервиса показываются списком (role="alert").
 */

export type DealDialogOption = { id: string; name: string };

/** Минимум для префилла формы редактирования (id-поля, не имена — см. DealCard). */
export type DealDialogTarget = {
  id: string;
  title: string;
  amount: string | null;
  organizationId: string | null;
  managerId: string | null;
  expectedCloseAt: Date | null;
};

function dateValue(d: Date | null): string {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

export function DealDialog({
  target,
  organizations,
  managers,
  currentUserId,
  onClose,
  onSaved
}: {
  target: DealDialogTarget | null;
  organizations: DealDialogOption[];
  managers: DealDialogOption[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (target) fd.set('id', target.id);
    setSubmitting(true);
    setMessages([]);
    const res = target ? await updateDealAction(fd) : await createDealAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      if (res.error === 'validation' && res.messages?.length) {
        setMessages(res.messages);
        return;
      }
      toast.error(errorMessageRu(res.error, 'Не удалось сохранить сделку.'));
      return;
    }
    toast.success(target ? 'Сделка обновлена.' : 'Сделка создана.');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={target ? 'Сделка' : 'Новая сделка'} size="md" busy={submitting}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {messages.length > 0 && (
          <ul role="alert" className="text-sm text-red-600 list-disc pl-5 space-y-0.5">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <Field htmlFor="dl-title" label="Название">
          <Input id="dl-title" name="title" required maxLength={200} defaultValue={target?.title ?? ''} autoFocus />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field htmlFor="dl-amount" label="Сумма, ₽">
            <Input id="dl-amount" name="amount" inputMode="decimal" placeholder="0.00" defaultValue={target?.amount ?? ''} />
          </Field>
          <Field htmlFor="dl-close" label="Ожидаемое закрытие">
            <Input id="dl-close" name="expectedCloseAt" type="date" defaultValue={dateValue(target?.expectedCloseAt ?? null)} />
          </Field>
        </div>
        <Field htmlFor="dl-org" label="Организация (необязательно)">
          <Select id="dl-org" name="organizationId" defaultValue={target?.organizationId ?? ''}>
            <option value="">— не привязана —</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="dl-manager" label="Ответственный">
          <Select id="dl-manager" name="managerId" defaultValue={target?.managerId ?? currentUserId}>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Сохраняю…' : target ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Кнопка «+ Сделка» с монтируемым диалогом создания — для страниц досок. */
export function NewDealButton({
  organizations,
  managers,
  currentUserId
}: {
  organizations: DealDialogOption[];
  managers: DealDialogOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Сделка
      </Button>
      {open && (
        <DealDialog
          target={null}
          organizations={organizations}
          managers={managers}
          currentUserId={currentUserId}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </>
  );
}
