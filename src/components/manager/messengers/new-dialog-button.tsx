'use client';
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Select } from '@/components/ui';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { startDialogAction } from '@/server-actions/messengers';
import { DIALOG_CHANNEL_LABELS } from '@/lib/services/messengers/channels';
import type { DialogCandidate } from '@/lib/services/messengers/start';

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Этот человек вне вашей зоны видимости.',
  not_found: 'Человек не найден — обновите страницу.',
  validation: 'Выберите, кому и как написать.',
  // `У-216`: пока код был без подписи, любой отказ выглядел как «Не удалось».
  no_messenger_channel: 'Адрес в этом канале неизвестен — выберите другой способ связи.',
};

function keyOf(c: DialogCandidate): string {
  return `${c.kind}:${c.id}`;
}

/**
 * Единственный доступный способ связи — выбираем его сразу: человеку останется
 * одна кнопка. Если доступных несколько или ни одного — выбор за человеком.
 */
function onlyAvailable(c: DialogCandidate | undefined): string {
  const open = c?.channels.filter((ch) => ch.available) ?? [];
  return open.length === 1 ? open[0]!.channel : '';
}

/**
 * «Новый диалог» (Р-М-8): выбрать человека и мессенджер, где его адрес известен.
 * Список кандидатов приходит с сервера уже в скоупе сотрудника; адрес на
 * клиенте не выбирается и не отправляется — только «кто» и «где».
 */
export function NewDialogButton({
  candidates,
  preselect,
  autoOpen = false,
  narrowedToOrg = false,
}: {
  candidates: DialogCandidate[];
  /**
   * Открыть окно сразу. Раньше признаком служил сам `preselect`, но с карточки
   * организации человек приходит без выбранного человека (`?newOrg=`) — и окно
   * не открывалось бы, хотя он только что нажал «Написать первым».
   */
  autoOpen?: boolean;
  /**
   * Список сужен до одной организации (`?newOrg=`). Нужен только ради честного
   * пустого состояния: «у этой организации нет людей» и «ни у кого нет адреса»
   * — разные беды, и лечатся они по-разному.
   */
  narrowedToOrg?: boolean;
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
  const [open, setOpen] = useState(autoOpen);
  const [personKey, setPersonKey] = useState(preselected ? keyOf(preselected) : '');
  const [channel, setChannel] = useState(onlyAvailable(preselected));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const person = candidates.find((c) => keyOf(c) === personKey) ?? null;
  const channels = person?.channels ?? [];
  // Причина показывается под списком, когда выбранный человек недоступен весь:
  // иначе единственным объяснением было бы «в списке ничего не выбирается».
  // Один и тот же текст не повторяем: у выключенных каналов причина общая
  // («канал не подключён»), и без этого человек читал бы её столько раз,
  // сколько каналов выключено, — да ещё и с одинаковым ключом в списке.
  const blockedReasons = [...new Set(channels.filter((c) => !c.available).map((c) => c.reason))];
  const nothingAvailable = channels.length > 0 && channels.every((c) => !c.available);

  function close() {
    setOpen(false);
    setError(null);
  }

  function choosePerson(key: string) {
    setPersonKey(key);
    setError(null);
    setChannel(onlyAvailable(candidates.find((c) => keyOf(c) === key)));
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
            {narrowedToOrg
              ? 'У этой организации пока нет ни контактов, ни пользователей кабинета — писать некому. Добавьте контакт в карточке организации и укажите ему мессенджер или почту.'
              : 'Пока некому написать первым: ни у одного клиента не известен адрес для связи. Он появляется, когда клиент привязывает бота в личных настройках или пишет сам, а у контакта — когда в карточке указан мессенджер или почта.'}
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
            <Field htmlFor="new-dialog-channel" label="Как написать">
              <Select
                id="new-dialog-channel"
                value={channel}
                disabled={pending || !person}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="">Выберите способ связи…</option>
                {/*
                  `У-216`: недоступный способ ВИДЕН, но не выбирается. Раньше
                  его просто не было в списке, и человек не мог понять, почему
                  Telegram есть у одного клиента и нет у другого.
                */}
                {channels.map((c) => (
                  <option key={c.channel} value={c.channel} disabled={!c.available}>
                    {DIALOG_CHANNEL_LABELS[c.channel]}
                    {c.available ? '' : ' — недоступно'}
                  </option>
                ))}
              </Select>
            </Field>
            {person && blockedReasons.length > 0 && (
              <div
                className={
                  nothingAvailable
                    ? 'rounded-lg border border-amber-200 bg-amber-50 p-3'
                    : 'rounded-lg bg-gray-50 p-3'
                }
              >
                <p className="text-xs font-medium text-gray-700">
                  {nothingAvailable
                    ? 'Написать этому человеку сейчас нельзя:'
                    : 'Почему часть способов недоступна:'}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-gray-600">
                  {blockedReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
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
