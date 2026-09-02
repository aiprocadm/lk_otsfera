'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Field, Dialog, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { fmtDateTime } from '@/lib/format';
import {
  createDealAction,
  updateDealAction,
  addDealNoteAction,
  listDealNotesAction,
  listDealProposalsAction,
} from '@/server-actions/deals';
import { listLinkedTasksAction } from '@/server-actions/tasks';
import type { DealNoteRow } from '@/lib/services/deals/notes';
import type { ProposalBlockRow } from '@/lib/services/documents/proposalBlocks';
import { ProposalsBlock } from '@/components/documents/proposals-block';
import type { TaskCard } from '@/lib/services/tasks/board';
import { LinkedTasksPanel } from '@/components/tasks/linked-tasks-panel';

/**
 * Этап 6 — создание/редактирование сделки (по образцу task-dialog).
 * Валидационные сообщения сервиса показываются списком (role="alert").
 * PR-2: в режиме редактирования — блок «Заметки» (ленивая подгрузка) и
 * ссылка на заказ, созданный из выигранной сделки.
 */

export type DealDialogOption = { id: string; name: string };

// Дельты поверх errorMessageRu (контекст заметок: центральный not_found — про заказ).
const NOTE_ERRORS: Record<string, string> = {
  not_found: 'Сделка не найдена или недоступна.',
  invalid: 'Заметка не может быть пустой.',
  forbidden: 'Нет доступа.',
};

/** Минимум для префилла формы редактирования (id-поля, не имена — см. DealCard). */
export type DealDialogTarget = {
  id: string;
  title: string;
  amount: string | null;
  organizationId: string | null;
  /** `У-161`: лид, из которого выросла сделка, — адресат КП без организации. */
  leadId: string | null;
  managerId: string | null;
  expectedCloseAt: Date | null;
  orderId: string | null;
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
  tasksEnabled = false,
  onIssueDocument,
  onClose,
  onSaved,
}: {
  target: DealDialogTarget | null;
  organizations: DealDialogOption[];
  managers: DealDialogOption[];
  currentUserId: string;
  /** Этап 7 (ФТ-7.1): блок «Задачи» — только при флаге internal_tasks (пробрасывает страница). */
  tasksEnabled?: boolean | undefined;
  /**
   * `У-145`: «Выпустить документ» из сделки. Обработчик, а не сам диалог
   * выпуска: он открылся бы модалкой поверх модалки — форму показывает доска,
   * закрыв карточку сделки.
   */
  onIssueDocument?: (() => void) | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  // Заметки (только редактирование): null — ещё грузятся.
  const [notes, setNotes] = useState<DealNoteRow[] | null>(null);
  const [proposals, setProposals] = useState<ProposalBlockRow[] | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  // Задачи сделки (ФТ-7.1): null — ещё грузятся; ленивая подгрузка как у заметок.
  const [tasks, setTasks] = useState<TaskCard[] | null>(null);
  const targetId = target?.id ?? null;

  const reloadTasks = React.useCallback((dealId: string) => {
    void listLinkedTasksAction({ dealId }).then((res) => {
      setTasks(res.ok ? res.rows : []);
    });
  }, []);

  useEffect(() => {
    if (!targetId || !tasksEnabled) return;
    reloadTasks(targetId);
  }, [targetId, tasksEnabled, reloadTasks]);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    void listDealNotesAction(targetId).then((res) => {
      if (!cancelled) setNotes(res.ok ? res.rows : []);
    });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  // `У-166`: предложения по сделке — лениво, тем же приёмом, что заметки.
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    void listDealProposalsAction(targetId).then((res) => {
      if (!cancelled) setProposals(res.ok ? res.rows : []);
    });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  async function handleAddNote() {
    const body = noteBody.trim();
    // Причина ignore: половинка `!targetId` недостижима — блок заметок с этой
    // кнопкой рендерится только в режиме редактирования (target есть). Проверка
    // оставлена ради сужения типа targetId: string | null.
    /* v8 ignore next */
    if (!body || !targetId) return;
    setNoteBusy(true);
    const fd = new FormData();
    fd.set('dealId', targetId);
    fd.set('body', body);
    const res = await addDealNoteAction(fd);
    if (!res.ok) {
      setNoteBusy(false);
      toast.error(NOTE_ERRORS[res.error] ?? 'Не удалось добавить заметку.');
      return;
    }
    setNoteBody('');
    const list = await listDealNotesAction(targetId);
    setNotes(list.ok ? list.rows : []);
    setNoteBusy(false);
  }

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
    <Dialog
      open
      onClose={onClose}
      title={target ? 'Сделка' : 'Новая сделка'}
      size="md"
      busy={submitting}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {messages.length > 0 && (
          <ul role="alert" className="text-sm text-red-600 list-disc pl-5 space-y-0.5">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <Field htmlFor="dl-title" label="Название">
          <Input
            id="dl-title"
            name="title"
            required
            maxLength={200}
            defaultValue={target?.title ?? ''}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field htmlFor="dl-amount" label="Сумма, ₽">
            <Input
              id="dl-amount"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={target?.amount ?? ''}
            />
          </Field>
          <Field htmlFor="dl-close" label="Ожидаемое закрытие">
            <Input
              id="dl-close"
              name="expectedCloseAt"
              type="date"
              defaultValue={dateValue(target?.expectedCloseAt ?? null)}
            />
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
          <Select
            id="dl-manager"
            name="managerId"
            defaultValue={target?.managerId ?? currentUserId}
          >
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

      {target && tasksEnabled && (
        <div className="mt-4 border-t border-gray-200 pt-3 space-y-2">
          <h3 className="text-sm font-semibold text-[#111111]">Задачи</h3>
          {tasks === null ? (
            <p className="text-xs text-gray-400">Загружаю задачи…</p>
          ) : (
            <LinkedTasksPanel
              link={{ dealId: target.id }}
              tasks={tasks}
              currentUserId={currentUserId}
              onCreated={() => reloadTasks(target.id)}
            />
          )}
        </div>
      )}

      {/* `У-166`: что уже предложено по этой сделке. Блок общий с карточкой
          организации — правило зеркала (§0.2 ТЗ). */}
      {target && proposals !== null && proposals.length > 0 && (
        <div className="mt-4 border-t border-gray-200 pt-3">
          <ProposalsBlock rows={proposals} hrefBase="/manager/documents" />
        </div>
      )}

      {/* `У-145`, `У-161`: документы выставляются и до заказа — прямо из
          сделки. Контрагент берётся из сделки: есть организация — выпускаем
          весь набор, есть только лид — одно коммерческое предложение (счёт
          клиенту без реквизитов выставлять не на что). */}
      {target && (
        <div className="mt-4 border-t border-gray-200 pt-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#111111]">Документы</h3>
            <p className="text-xs text-gray-500">
              {target.organizationId
                ? 'Счёт, договор, доп. соглашение или коммерческое предложение по этой сделке — без заказа.'
                : target.leadId
                  ? 'Клиент ещё не заведён как организация, поэтому по сделке выставляют только коммерческое предложение.'
                  : // Молчащая кнопка — дефект приёмки (§15): говорим, чего не
                    // хватает и что сделать.
                    'Чтобы выставить документ, привяжите к сделке организацию или заведите её из лида.'}
            </p>
          </div>
          {onIssueDocument && (target.organizationId || target.leadId) && (
            <Button size="sm" variant="secondary" type="button" onClick={onIssueDocument}>
              {target.organizationId ? 'Выпустить документ' : 'Выставить КП'}
            </Button>
          )}
        </div>
      )}

      {target && (
        <div className="mt-4 border-t border-gray-200 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#111111]">Заметки</h3>
            {target.orderId && (
              <a
                href={`/manager/orders/${target.orderId}`}
                className="text-sm text-[#F97316] underline"
              >
                Открыть заказ
              </a>
            )}
          </div>
          {notes === null ? (
            <p className="text-xs text-gray-400">Загружаю заметки…</p>
          ) : notes.length === 0 ? (
            <p className="text-xs text-gray-400">Заметок пока нет.</p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id}>
                  <p className="text-xs text-gray-500">
                    <span className="font-medium text-[#111111]">{n.authorName}</span>{' '}
                    {fmtDateTime(n.createdAt)}
                  </p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-start gap-2">
            <Textarea
              aria-label="Новая заметка"
              placeholder="Новая заметка"
              rows={2}
              value={noteBody}
              disabled={noteBusy}
              onChange={(e) => setNoteBody(e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleAddNote()}
              disabled={noteBusy || !noteBody.trim()}
            >
              {noteBusy ? 'Добавляю…' : 'Добавить'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Кнопка «+ Сделка» с монтируемым диалогом создания — для страниц досок. */
export function NewDealButton({
  organizations,
  managers,
  currentUserId,
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
