'use client';
import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, EmptyState, Input, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import {
  addChannelAction,
  removeChannelAction,
  setPrimaryChannelAction,
} from '@/server-actions/contacts';
import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNEL_TYPES,
  isContactChannelType,
} from '@/lib/services/contacts/channelLabels';
import type { ContactCardChannel } from '@/lib/services/contacts/get';
import { contactHref, type ContactsCabinet } from '@/lib/navigation/contactsHrefs';
import { MergeContactsDialog, type MergePreselect } from './merge-contacts-dialog';

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет права на справочник контактов.',
  not_found: 'Канал или контакт не найдены — обновите страницу.',
  invalid: 'Введите номер или адрес.',
};

/**
 * Блок «Каналы» карточки (`У-180`): список с признаком основного, добавление и
 * удаление. Канал пользователя кабинета помечен и не редактируется — он
 * меняется в профиле пользователя. Занятый канал — подсказка с именем владельца
 * и кнопками «Открыть» / «Объединить» (спека §3.4–§3.5).
 */
export function ContactChannels({
  cabinet,
  contactId,
  contactName,
  channels,
}: {
  cabinet: ContactsCabinet;
  contactId: string;
  contactName: string;
  channels: ContactCardChannel[];
}) {
  const router = useRouter();
  const [type, setType] = useState<string>('phone');
  const [value, setValue] = useState('');
  const [error, setError] = useState<React.ReactNode>(null);
  const [conflict, setConflict] = useState<MergePreselect | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        toast.success(done);
        router.refresh();
        return;
      }
      setError(resolveErrorText(result.error, ERROR_LABEL));
    });
  }

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || !isContactChannelType(type)) {
      setError(ERROR_LABEL.invalid);
      return;
    }
    setError(null);
    setConflict(null);
    startTransition(async () => {
      const result = await addChannelAction({ contactId, type, value: trimmed });
      if (result.ok) {
        toast.success('Канал добавлен');
        setValue('');
        router.refresh();
        return;
      }
      if (result.error === 'contact_channel_taken') {
        setConflict(result.conflict);
        setError(
          <>
            Этот канал уже у контакта «{result.conflict.name}».{' '}
            <Link href={contactHref(cabinet, result.conflict.contactId)} className="underline">
              Открыть
            </Link>
          </>
        );
        return;
      }
      setError(resolveErrorText(result.error, ERROR_LABEL));
    });
  }

  return (
    <section aria-labelledby="contact-channels-title" className="space-y-3">
      <h2 id="contact-channels-title" className="text-sm font-semibold text-[#111111]">
        Каналы связи
      </h2>
      {channels.length === 0 ? (
        <EmptyState
          icon="☎"
          message="Каналов пока нет — добавьте телефон, почту или мессенджер, чтобы письма и звонки этого человека находили карточку сами."
        />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {channels.map((ch) => (
            <li key={ch.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-gray-500">
                {CONTACT_CHANNEL_LABELS[ch.type]}
              </span>
              <span className="min-w-0 flex-1 break-all font-medium text-[#111111]">
                {ch.value}
              </span>
              {ch.isPrimary && <Badge tone="neutral">Основной</Badge>}
              {ch.locked && (
                <span title="Данные пользователя кабинета — меняются в его профиле">
                  <Badge tone="warning">Из кабинета</Badge>
                </span>
              )}
              {!ch.isPrimary && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => setPrimaryChannelAction({ channelId: ch.id }),
                      'Основной канал изменён'
                    )
                  }
                >
                  Сделать основным
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || ch.locked}
                title={
                  ch.locked
                    ? 'Это данные пользователя кабинета — меняются в его профиле'
                    : undefined
                }
                onClick={() => run(() => removeChannelAction({ channelId: ch.id }), 'Канал удалён')}
              >
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Тип
          <Select value={type} onChange={(e) => setType(e.target.value)} disabled={pending}>
            {CONTACT_CHANNEL_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTACT_CHANNEL_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-gray-500">
          Номер или адрес
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={200}
            disabled={pending}
            placeholder="+7 921 000-00-00 или name@company.ru"
          />
        </label>
        <Button type="submit" variant="secondary" loading={pending} disabled={pending}>
          Добавить канал
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
          {conflict && (
            <>
              {' '}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setMergeOpen(true)}
                disabled={pending}
              >
                Объединить
              </Button>
            </>
          )}
        </p>
      )}
      {conflict && (
        <MergeContactsDialog
          cabinet={cabinet}
          primaryId={contactId}
          primaryName={contactName}
          open={mergeOpen}
          onClose={() => setMergeOpen(false)}
          preselect={conflict}
        />
      )}
    </section>
  );
}
