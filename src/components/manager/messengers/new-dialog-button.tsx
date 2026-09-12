'use client';
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Select } from '@/components/ui';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { startDialogAction } from '@/server-actions/messengers';
import { MESSENGER_LABELS, type MessengerChannel } from '@/lib/services/messengers/channels';
import type { DialogCandidate } from '@/lib/services/messengers/start';

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Этот человек вне вашей зоны видимости.',
  not_found: 'Человек не найден — обновите страницу.',
  validation: 'Выберите, кому и в каком мессенджере написать.',
};

function keyOf(c: DialogCandidate): string {
  return `${c.kind}:${c.id}`;
}

/**
 * «Новый диалог» (Р-М-8): выбрать человека и мессенджер, где его адрес известен.
 * Список кандидатов приходит с сервера уже в скоупе сотрудника; адрес на
 * клиенте не выбирается и не отправляется — только «кто» и «где».
 */
export function NewDialogButton({
  candidates,
  preselect,
}: {
  candidates: DialogCandidate[];
  /**
   * Этап 1 ТЗ 12.09.2026 (`У-179`): кнопка «Написать» в карточке контакта ведёт
   * сюда с `?new=<contactId>` — диалог открыт сразу, человек уже выбран, если
   * он есть среди кандидатов (иначе форма открыта пустой, как обычно).
   */
  preselect?: string | undefined;
}) {
  const router = useRouter();
  const preselected = preselect
    ? candidates.find((c) => c.kind === 'contact' && c.id === preselect)
    : undefined;
  const [open, setOpen] = useState(Boolean(preselect));
  const [personKey, setPersonKey] = useState(preselected ? keyOf(preselected) : '');
  const [channel, setChannel] = useState(
    preselected && preselected.channels.length === 1 ? preselected.channels[0]! : ''
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const person = candidates.find((c) => keyOf(c) === personKey) ?? null;
  const channels: MessengerChannel[] = person?.channels ?? [];

  function close() {
    setOpen(false);
    setError(null);
  }

  function choosePerson(key: string) {
    setPersonKey(key);
    setError(null);
    const next = candidates.find((c) => keyOf(c) === key);
    // Один мессенджер — выбираем его сразу, человеку останется одна кнопка.
    setChannel(next && next.channels.length === 1 ? next.channels[0]! : '');
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!person || !channel) {
      setError(ERROR_LABEL.validation!);
      return;
    }
    startTransition(async () => {
      const result = await startDialogAction({ kind: person.kind, id: person.id, channel });
      if (result.ok) {
        setOpen(false);
        router.push(`/manager/messengers/${result.dialogId}`);
        return;
      }
      setError(resolveErrorText(result.error, ERROR_LABEL));
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Новый диалог</Button>
      <Dialog open={open} onClose={close} title="Новый диалог" busy={pending} error={error}>
        {candidates.length === 0 ? (
          <p className="text-sm text-gray-600">
            Пока некому написать первым: у клиентов нет привязанных мессенджеров. Адрес появляется,
            когда клиент привязывает бота в личных настройках или пишет ему сам, а у контакта —
            когда в карточке указан мессенджер.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field htmlFor="new-dialog-person" label="Кому">
              <Select
                id="new-dialog-person"
                value={personKey}
                disabled={pending}
                onChange={(e) => choosePerson(e.target.value)}
              >
                <option value="">Выберите человека…</option>
                {candidates.map((c) => (
                  <option key={keyOf(c)} value={keyOf(c)}>
                    {c.name}
                    {c.organizationName ? ` — ${c.organizationName}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="new-dialog-channel" label="Мессенджер">
              <Select
                id="new-dialog-channel"
                value={channel}
                disabled={pending || !person}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="">Выберите мессенджер…</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {MESSENGER_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                Отмена
              </Button>
              <Button type="submit" loading={pending} disabled={pending}>
                Открыть диалог
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
