// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import { PinnedNotesBlock } from '@/components/organization/pinned-notes-block';
import { fmtDateTime } from '@/lib/format';
import type { OrganizationNoteView } from '@/lib/services/organizationNotes/list';

/**
 * Блок «Важное» на «Обзоре» карточки организации (этап 1 ТЗ 12.09.2026,
 * `У-183`; спека 2026-09-12-stage1-contacts-and-notes-design §3.6):
 * закреплённые заметки с автором и датой, ссылка на вкладку «Заметки»; когда
 * закрепить нечего — блок не рисуется вовсе.
 */
function note(overrides: Partial<OrganizationNoteView> & { id: string }): OrganizationNoteView {
  return {
    body: `Заметка ${overrides.id}`,
    createdAt: new Date('2026-09-10T09:00:00Z'),
    updatedAt: new Date('2026-09-10T09:00:00Z'),
    pinnedAt: new Date('2026-09-11T10:00:00Z'),
    author: { id: 'u1', name: 'Иван Иванов' },
    mentionUserIds: [],
    canEdit: false,
    canDelete: false,
    ...overrides,
  };
}

const NOTES: OrganizationNoteView[] = [
  note({ id: 'n1', body: 'Договорились о скидке 10 %' }),
  note({ id: 'n2', body: 'Счета — только на бухгалтерию', author: null }),
  note({ id: 'n3', body: 'Звонить после 14:00', author: { id: 'u2', name: null } }),
];

describe('PinnedNotesBlock', () => {
  it('без закреплённых заметок не рисуется', () => {
    const { container } = render(
      <PinnedNotesBlock notes={[]} notesHref="/manager/organizations/o1?tab=notes" />
    );
    expect(container.innerHTML).toBe('');
  });

  it('заголовок «Важное», ссылка «Все заметки →» на вкладку и тела заметок', () => {
    render(<PinnedNotesBlock notes={NOTES} notesHref="/manager/organizations/o1?tab=notes" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Важное' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Все заметки →' }).getAttribute('href')).toBe(
      '/manager/organizations/o1?tab=notes'
    );
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent)).toEqual(
      ['Договорились о скидке 10 %', 'Счета — только на бухгалтерию', 'Звонить после 14:00']
    );
  });

  it('подпись: автор и дата; без автора или без имени — прочерк', () => {
    render(<PinnedNotesBlock notes={NOTES} notesHref="/leader/organizations/o1?tab=notes" />);
    const when = fmtDateTime(new Date('2026-09-10T09:00:00Z'));
    const captions = screen
      .getAllByRole('listitem')
      .map((li) => li.querySelectorAll('p')[1]?.textContent);
    expect(captions).toEqual([`Иван Иванов · ${when}`, `— · ${when}`, `— · ${when}`]);
  });
});
