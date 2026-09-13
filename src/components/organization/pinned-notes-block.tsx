import React from 'react';
import Link from 'next/link';
import { fmtDateTime } from '@/lib/format';
import type { OrganizationNoteView } from '@/lib/services/organizationNotes/list';

/**
 * Блок «Важное» на «Обзоре» карточки организации (`У-183`): закреплённые
 * заметки (не больше трёх) — то, что сотрудник должен увидеть первым. Пустой
 * блок не рисуется: закрепить нечего — значит, ничего и не важно.
 */
export function PinnedNotesBlock({
  notes,
  notesHref,
}: {
  notes: OrganizationNoteView[];
  notesHref: string;
}) {
  if (notes.length === 0) return null;
  return (
    <section
      aria-labelledby="org-pinned-notes"
      className="rounded-lg border border-orange-200 bg-orange-50 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="org-pinned-notes" className="text-sm font-semibold text-[#111111]">
          Важное
        </h2>
        <Link href={notesHref} className="text-xs text-gray-500 hover:text-orange-600">
          Все заметки →
        </Link>
      </div>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="text-sm text-[#111111]">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <p className="text-xs text-gray-500">
              {n.author?.name ?? '—'} · {fmtDateTime(n.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
