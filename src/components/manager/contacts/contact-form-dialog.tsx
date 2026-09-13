'use client';
import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { createContactAction, updateContactAction } from '@/server-actions/contacts';
import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNEL_TYPES,
  isContactChannelType,
} from '@/lib/services/contacts/channelLabels';
import type { ContactOrgOption } from '@/lib/services/contacts/orgOptions';
import { contactHref, type ContactsCabinet } from '@/lib/navigation/contactsHrefs';

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет права на справочник контактов — обратитесь к администратору.',
  not_found: 'Контакт или организация не найдены — обновите страницу.',
  invalid: 'Укажите имя контакта.',
  validation: 'Проверьте поля формы.',
};

type EditableContact = {
  id: string;
  name: string;
  position: string | null;
  note: string | null;
  organizationId: string | null;
};

type Props = {
  cabinet: ContactsCabinet;
  orgOptions: ContactOrgOption[];
  /** `У-182`: из вкладки «Контакты» карточки организации — она уже выбрана. */
  defaultOrganizationId?: string | undefined;
} & ({ mode: 'create' } | { mode: 'edit'; contact: EditableContact });

/**
 * Форма контакта (`У-180`): создание из списка (имя, должность, организация,
 * первый канал) и правка из карточки. Занятый канал — не ошибка базы, а
 * подсказка с именем владельца и ссылкой «Открыть» (спека §3.4).
 */
export function ContactFormDialog(props: Props) {
  const { cabinet, orgOptions, defaultOrganizationId } = props;
  const editing = props.mode === 'edit' ? props.contact : null;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<React.ReactNode>(null);
  const [name, setName] = useState(editing?.name ?? '');
  const [position, setPosition] = useState(editing?.position ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  // Правка — организация контакта (в том числе «без»), создание — предвыбор.
  const [organizationId, setOrganizationId] = useState(
    editing ? (editing.organizationId ?? '') : (defaultOrganizationId ?? '')
  );
  const [channelType, setChannelType] = useState<string>('phone');
  const [channelValue, setChannelValue] = useState('');

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(ERROR_LABEL.invalid);
      return;
    }
    startTransition(async () => {
      if (editing) {
        const result = await updateContactAction({
          id: editing.id,
          name: trimmed,
          position: position.trim() || null,
          note: note.trim() || null,
          organizationId: organizationId || null,
        });
        if (result.ok) {
          toast.success('Контакт сохранён');
          close();
          router.refresh();
          return;
        }
        setError(resolveErrorText(result.error, ERROR_LABEL));
        return;
      }
      const value = channelValue.trim();
      const result = await createContactAction({
        name: trimmed,
        ...(position.trim() ? { position: position.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        organizationId: organizationId || null,
        channels: value && isContactChannelType(channelType) ? [{ type: channelType, value }] : [],
      });
      if (result.ok) {
        toast.success('Контакт создан');
        close();
        router.push(contactHref(cabinet, result.contactId));
        return;
      }
      if (result.error === 'contact_channel_taken') {
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

  const idPrefix = editing ? `contact-edit-${editing.id}` : 'contact-create';

  return (
    <>
      <Button variant={editing ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
        {editing ? 'Изменить' : 'Добавить контакт'}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={editing ? 'Изменить контакт' : 'Новый контакт'}
        busy={pending}
        error={error}
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field htmlFor={`${idPrefix}-name`} label="Имя">
            <Input
              id={`${idPrefix}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              disabled={pending}
              placeholder="Иванов Иван Иванович"
            />
          </Field>
          <Field htmlFor={`${idPrefix}-position`} label="Должность">
            <Input
              id={`${idPrefix}-position`}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              maxLength={200}
              disabled={pending}
              placeholder="Специалист по охране труда"
            />
          </Field>
          <Field
            htmlFor={`${idPrefix}-org`}
            label="Организация"
            hint="Контакт без организации — это человек «с улицы»; привязать можно позже."
          >
            <Select
              id={`${idPrefix}-org`}
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              disabled={pending}
            >
              <option value="">Без организации</option>
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor={`${idPrefix}-note`} label="Заметка">
            <Textarea
              id={`${idPrefix}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={4000}
              disabled={pending}
            />
          </Field>
          {!editing && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Field htmlFor={`${idPrefix}-channel-type`} label="Канал связи">
                <Select
                  id={`${idPrefix}-channel-type`}
                  value={channelType}
                  onChange={(e) => setChannelType(e.target.value)}
                  disabled={pending}
                >
                  {CONTACT_CHANNEL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CONTACT_CHANNEL_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                htmlFor={`${idPrefix}-channel-value`}
                label="Номер или адрес"
                hint="Можно оставить пустым и добавить каналы в карточке."
              >
                <Input
                  id={`${idPrefix}-channel-value`}
                  value={channelValue}
                  onChange={(e) => setChannelValue(e.target.value)}
                  maxLength={200}
                  disabled={pending}
                  placeholder="+7 921 000-00-00"
                />
              </Field>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Отмена
            </Button>
            <Button type="submit" loading={pending} disabled={pending}>
              {editing ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
