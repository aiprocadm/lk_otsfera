'use client';
import React, { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { listMergeCandidatesAction, mergeContactsAction } from '@/server-actions/contacts';
import type { MergeCandidate } from '@/lib/services/contacts/merge';
import { contactHref, type ContactsCabinet } from '@/lib/navigation/contactsHrefs';

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет права на справочник контактов.',
  not_found: 'Контакт не найден — обновите страницу.',
};

/** Кого предложить сразу — владелец занятого канала из подсказки формы (`У-180`). */
export type MergePreselect = { contactId: string; name: string };

/**
 * Объединение дублей (`У-181`): текущий контакт — главный, выбранный —
 * второй; все связи переезжают к главному, второй уходит в архив. Кандидаты
 * ищутся по мере ввода через server action (скоуп — на сервере).
 */
export function MergeContactsDialog({
  cabinet,
  primaryId,
  primaryName,
  open,
  onClose,
  preselect,
}: {
  cabinet: ContactsCabinet;
  primaryId: string;
  primaryName: string;
  open: boolean;
  onClose: () => void;
  preselect?: MergePreselect | undefined;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [secondaryId, setSecondaryId] = useState(preselect?.contactId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      void listMergeCandidatesAction({
        excludeId: primaryId,
        ...(q.trim() ? { q: q.trim() } : {}),
      }).then((res) => {
        if (res.ok) setCandidates(res.items);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [open, q, primaryId]);

  const chosen =
    candidates.find((c) => c.id === secondaryId) ??
    (preselect && preselect.contactId === secondaryId ? preselect : null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!secondaryId) {
      setError('Выберите, какой контакт объединить с этим.');
      return;
    }
    startTransition(async () => {
      const result = await mergeContactsAction({ primaryId, secondaryId });
      if (result.ok) {
        toast.success('Контакты объединены');
        onClose();
        router.push(contactHref(cabinet, primaryId));
        router.refresh();
        return;
      }
      setError(resolveErrorText(result.error, ERROR_LABEL));
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Объединить контакты" busy={pending} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-gray-600">
          Главным останется <span className="font-medium text-[#111111]">{primaryName}</span>: к
          нему переедут каналы, диалоги, звонки, письма, заказы и сделки второго контакта, а второй
          уйдёт в архив.
        </p>
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Найти второй контакт по имени"
          aria-label="Поиск контакта для объединения"
          disabled={pending}
        />
        <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Кандидаты">
          {preselect && !candidates.some((c) => c.id === preselect.contactId) && (
            <li>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="secondary"
                  value={preselect.contactId}
                  checked={secondaryId === preselect.contactId}
                  onChange={() => setSecondaryId(preselect.contactId)}
                  disabled={pending}
                />
                <span className="font-medium">{preselect.name}</span>
              </label>
            </li>
          )}
          {candidates.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="secondary"
                  value={c.id}
                  checked={secondaryId === c.id}
                  onChange={() => setSecondaryId(c.id)}
                  disabled={pending}
                />
                <span className="min-w-0">
                  <span className="font-medium">{c.name}</span>
                  {c.organization ? ` — ${c.organization.name}` : ''}
                  {c.channels.length > 0 && (
                    <span className="block text-xs text-gray-500">
                      {c.channels.map((ch) => ch.value).join(' · ')}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
          {candidates.length === 0 && !preselect && (
            <li className="text-xs text-gray-500">Похожих контактов не найдено — уточните имя.</li>
          )}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button type="submit" loading={pending} disabled={pending || !chosen}>
            Объединить
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Кнопка меню карточки «Объединить». */
export function MergeContactsButton({
  cabinet,
  primaryId,
  primaryName,
}: {
  cabinet: ContactsCabinet;
  primaryId: string;
  primaryName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Объединить
      </Button>
      <MergeContactsDialog
        cabinet={cabinet}
        primaryId={primaryId}
        primaryName={primaryName}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
