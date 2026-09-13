'use client';
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, EmptyState } from '@/components/ui';
import { MentionTextarea, type MentionOption } from '@/components/ui/mention-textarea';
import { fmtDateTime } from '@/lib/format';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import {
  addOrganizationNoteAction,
  editOrganizationNoteAction,
  pinOrganizationNoteAction,
  removeOrganizationNoteAction,
} from '@/server-actions/organizationNotes';
import type { OrganizationNoteView } from '@/lib/services/organizationNotes/list';
import { NOTE_BODY_MAX } from '@/lib/services/organizationNotes/policy';

const ERROR_LABEL: Record<string, string> = {
  forbidden:
    'Нет права на это действие: свою заметку правит автор в течение суток, чужие правит и удаляет руководитель или администратор.',
  not_found: 'Заметка не найдена — обновите страницу.',
  invalid: 'Заметка не может быть пустой.',
};

type NoteAction = () => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * Вкладка «Заметки» карточки организации (`У-183`, `Р-Б-8`): закреплённые
 * сверху, поле ввода с подсказкой имён после `@`, правка своей заметки (сутки),
 * закрепление (до трёх), удаление руководителем. Права рисуются по флагам из
 * сервиса (`canEdit`, `canDelete`) — запрет держит сервер.
 */
export function OrgNotesSection({
  organizationId,
  pinned,
  notes,
  colleagues,
}: {
  organizationId: string;
  pinned: OrganizationNoteView[];
  notes: OrganizationNoteView[];
  colleagues: MentionOption[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();

  function run(task: NoteAction, done: string) {
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        toast.success(done);
        router.refresh();
        return;
      }
      toast.error(resolveErrorText(result.error, ERROR_LABEL));
    });
  }

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) {
      toast.error(ERROR_LABEL.invalid!);
      return;
    }
    startTransition(async () => {
      const result = await addOrganizationNoteAction({ organizationId, body });
      if (result.ok) {
        toast.success('Заметка добавлена');
        setDraft('');
        router.refresh();
        return;
      }
      toast.error(resolveErrorText(result.error, ERROR_LABEL));
    });
  }

  const all = [...pinned, ...notes];

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-2">
        <label htmlFor="org-note-draft" className="text-xs text-gray-500">
          Новая заметка — видна только сотрудникам, клиент её не увидит
        </label>
        <MentionTextarea
          id="org-note-draft"
          value={draft}
          onChange={setDraft}
          colleagues={colleagues}
          rows={3}
          maxLength={NOTE_BODY_MAX}
          disabled={pending}
          placeholder="О чём договорились, что важно помнить… (@ — упомянуть коллегу)"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-[#111111] outline-none focus:border-orange-400"
        />
        <div className="flex justify-end">
          <Button type="submit" loading={pending} disabled={pending}>
            Добавить заметку
          </Button>
        </div>
      </form>

      {all.length === 0 ? (
        <EmptyState
          icon="📝"
          message="Заметок пока нет — запишите, о чём договорились с клиентом, и коллеги увидят это в карточке."
        />
      ) : (
        <ul className="space-y-3" aria-label="Заметки">
          {all.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              organizationId={organizationId}
              colleagues={colleagues}
              pending={pending}
              run={run}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteCard({
  note,
  organizationId,
  colleagues,
  pending,
  run,
}: {
  note: OrganizationNoteView;
  organizationId: string;
  colleagues: MentionOption[];
  pending: boolean;
  run: (task: NoteAction, done: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isPinned = note.pinnedAt !== null;

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = text.trim();
    if (!body) {
      toast.error(ERROR_LABEL.invalid!);
      return;
    }
    run(async () => {
      const result = await editOrganizationNoteAction({ noteId: note.id, organizationId, body });
      if (result.ok) setEditing(false);
      return result;
    }, 'Заметка сохранена');
  }

  return (
    <li
      className={`rounded-lg border p-3 ${isPinned ? 'border-orange-200 bg-orange-50' : 'border-gray-200'}`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{note.author?.name ?? '—'}</span>
        <span>{fmtDateTime(note.createdAt)}</span>
        {isPinned && <Badge tone="warning">Важное</Badge>}
      </div>
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <MentionTextarea
            value={text}
            onChange={setText}
            colleagues={colleagues}
            rows={3}
            maxLength={NOTE_BODY_MAX}
            disabled={pending}
            aria-label="Текст заметки"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-[#111111] outline-none focus:border-orange-400"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setText(note.body);
              }}
            >
              Отмена
            </Button>
            <Button type="submit" size="sm" loading={pending} disabled={pending}>
              Сохранить
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-[#111111]">{note.body}</p>
      )}
      {!editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  pinOrganizationNoteAction({ noteId: note.id, organizationId, pinned: !isPinned }),
                isPinned ? 'Заметка откреплена' : 'Заметка закреплена'
              )
            }
          >
            {isPinned ? 'Открепить' : 'Закрепить'}
          </Button>
          {note.canEdit && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              Изменить
            </Button>
          )}
          {note.canDelete && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              Удалить
            </Button>
          )}
        </div>
      )}
      {note.canDelete && (
        <Dialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Удалить заметку?"
          busy={pending}
          size="sm"
        >
          <p className="text-sm text-gray-600">
            Заметка исчезнет из карточки; её текст останется в журнале действий.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              loading={pending}
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await removeOrganizationNoteAction({
                    noteId: note.id,
                    organizationId,
                  });
                  if (result.ok) setConfirmDelete(false);
                  return result;
                }, 'Заметка удалена')
              }
            >
              Удалить
            </Button>
          </div>
        </Dialog>
      )}
    </li>
  );
}
