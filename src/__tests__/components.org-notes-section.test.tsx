// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  addOrganizationNoteAction: vi.fn(),
  editOrganizationNoteAction: vi.fn(),
  pinOrganizationNoteAction: vi.fn(),
  removeOrganizationNoteAction: vi.fn(),
}));
vi.mock('@/server-actions/organizationNotes', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { OrgNotesSection } from '@/components/organization/org-notes-section';
import type { MentionOption } from '@/components/ui/mention-textarea';
import { fmtDateTime } from '@/lib/format';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import type { OrganizationNoteView } from '@/lib/services/organizationNotes/list';

/**
 * Вкладка «Заметки» карточки организации (этап 1 ТЗ 12.09.2026, `У-183`;
 * спека 2026-09-12-stage1-contacts-and-notes-design §3.6): закреплённые сверху
 * с бейджем «Важное», поле новой заметки с подсказкой имён, правка своей
 * заметки на месте, закрепление/открепление, удаление через подтверждение.
 * Кнопки прав рисуются по флагам из сервиса; пустой текст останавливается до
 * server action; отказ любого действия переводится словарём в тост.
 */
const COLLEAGUES: MentionOption[] = [
  { id: 'u1', name: 'Петров Пётр' },
  { id: 'u2', name: 'Иван Сидоров' },
];

const EMPTY_TEXT = 'Заметка не может быть пустой.';
const FORBIDDEN_TEXT =
  'Нет права на это действие: свою заметку правит автор в течение суток, чужие правит и удаляет руководитель или администратор.';

function note(overrides: Partial<OrganizationNoteView> & { id: string }): OrganizationNoteView {
  return {
    body: `Текст ${overrides.id}`,
    createdAt: new Date('2026-09-10T09:00:00Z'),
    updatedAt: new Date('2026-09-10T09:00:00Z'),
    pinnedAt: null,
    author: { id: 'u1', name: 'Иван Иванов' },
    mentionUserIds: [],
    canEdit: false,
    canDelete: false,
    ...overrides,
  };
}

/** Закреплённая, своя, с правом удаления — руководитель смотрит свою заметку. */
const PINNED = note({
  id: 'n1',
  body: 'Договорились о скидке',
  pinnedAt: new Date('2026-09-11T10:00:00Z'),
  canEdit: true,
  canDelete: true,
});
/** Чужая, без автора (сотрудник удалён) — рядовому менеджеру доступно только закрепить. */
const PLAIN = note({ id: 'n2', body: 'Позвонить в понедельник', author: null });
/** Автор без имени. */
const NAMELESS = note({
  id: 'n3',
  body: 'Счета — на бухгалтерию',
  author: { id: 'u9', name: null },
});

beforeAll(() => {
  // Нативный <dialog> в jsdom не умеет showModal — как в остальных тестах примитива Dialog.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => vi.clearAllMocks());

function renderSection(pinned: OrganizationNoteView[], notes: OrganizationNoteView[]) {
  return render(
    <OrgNotesSection organizationId="o1" pinned={pinned} notes={notes} colleagues={COLLEAGUES} />
  );
}

function draft(): HTMLTextAreaElement {
  return screen.getByLabelText(/Новая заметка/) as HTMLTextAreaElement;
}

function cards(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Заметки' })).getAllByRole('listitem');
}

/** Карточка заметки по её тексту. */
function card(body: string): HTMLElement {
  return screen.getByText(body).closest('li') as HTMLElement;
}

function openDialog(): HTMLElement {
  return document.querySelector('dialog[open]') as HTMLElement;
}

describe('OrgNotesSection — список', () => {
  it('без заметок — подсказка, списка нет, поле ввода есть', () => {
    renderSection([], []);
    expect(screen.getByText(/Заметок пока нет/).textContent).toContain(
      'коллеги увидят это в карточке'
    );
    expect(screen.queryByRole('list', { name: 'Заметки' })).toBeNull();
    expect(draft().value).toBe('');
    expect(screen.getByRole('button', { name: 'Добавить заметку' })).toBeTruthy();
  });

  it('закреплённые первыми с бейджем «Важное» и подсветкой; автор и дата; без автора или имени — прочерк', () => {
    renderSection([PINNED], [PLAIN, NAMELESS]);
    const [first, second, third] = cards();
    expect(first.textContent).toContain('Договорились о скидке');
    expect(within(first).getByText('Важное')).toBeTruthy();
    expect(first.className).toContain('border-orange-200');
    expect(within(first).getByText('Иван Иванов')).toBeTruthy();
    expect(within(first).getByText(fmtDateTime(PINNED.createdAt))).toBeTruthy();

    expect(second.textContent).toContain('Позвонить в понедельник');
    expect(within(second).queryByText('Важное')).toBeNull();
    expect(second.className).not.toContain('border-orange-200');
    expect(within(second).getByText('—')).toBeTruthy();
    expect(within(third).getByText('—')).toBeTruthy();
  });

  it('«Изменить» и «Удалить» есть только при правах; «Закрепить»/«Открепить» — у всех', () => {
    renderSection([PINNED], [PLAIN]);
    const mine = card('Договорились о скидке');
    expect(within(mine).getByRole('button', { name: 'Открепить' })).toBeTruthy();
    expect(within(mine).getByRole('button', { name: 'Изменить' })).toBeTruthy();
    expect(within(mine).getByRole('button', { name: 'Удалить' })).toBeTruthy();

    const foreign = card('Позвонить в понедельник');
    expect(within(foreign).getByRole('button', { name: 'Закрепить' })).toBeTruthy();
    expect(within(foreign).queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(within(foreign).queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(foreign.querySelector('dialog')).toBeNull();
  });
});

describe('OrgNotesSection — добавление', () => {
  it('пустой текст → тост без action', () => {
    renderSection([], []);
    fireEvent.change(draft(), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));
    expect(toastMock.error).toHaveBeenCalledWith(EMPTY_TEXT);
    expect(actions.addOrganizationNoteAction).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('успех → action с обрезанным текстом, тост, refresh, поле очищено', async () => {
    actions.addOrganizationNoteAction.mockResolvedValue({ ok: true });
    renderSection([], []);
    fireEvent.change(draft(), { target: { value: '  Новая заметка  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));
    await waitFor(() =>
      expect(actions.addOrganizationNoteAction).toHaveBeenCalledWith({
        organizationId: 'o1',
        body: 'Новая заметка',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Заметка добавлена'));
    expect(nav.refresh).toHaveBeenCalled();
    await waitFor(() => expect(draft().value).toBe(''));
  });

  it('отказ → тост из словаря, текст остаётся, refresh не зовётся', async () => {
    actions.addOrganizationNoteAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    renderSection([], []);
    fireEvent.change(draft(), { target: { value: 'Заметка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(FORBIDDEN_TEXT));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(draft().value).toBe('Заметка');
  });

  it('`@` в поле новой заметки подсказывает коллег', () => {
    renderSection([], []);
    fireEvent.change(draft(), { target: { value: 'Передать @Пе' } });
    expect(screen.getByRole('button', { name: '@Петров Пётр' })).toBeTruthy();
  });
});

describe('OrgNotesSection — правка своей заметки', () => {
  it('«Изменить» открывает форму с текстом; «Отмена» возвращает исходный текст', () => {
    renderSection([PINNED], []);
    const mine = card('Договорились о скидке');
    fireEvent.click(within(mine).getByRole('button', { name: 'Изменить' }));
    const field = within(mine).getByLabelText('Текст заметки') as HTMLTextAreaElement;
    expect(field.value).toBe('Договорились о скидке');
    // Пока правим — кнопки действий спрятаны, абзаца с текстом нет.
    expect(within(mine).queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: 'Открепить' })).toBeNull();
    // Текст живёт в textarea (React кладёт value и в содержимое) — абзаца с ним быть не должно.
    expect(within(mine).queryByText('Договорились о скидке', { selector: 'p' })).toBeNull();

    fireEvent.change(field, { target: { value: 'Другой текст' } });
    fireEvent.click(within(mine).getByRole('button', { name: 'Отмена' }));
    expect(within(mine).queryByLabelText('Текст заметки')).toBeNull();
    expect(within(mine).getByText('Договорились о скидке')).toBeTruthy();

    fireEvent.click(within(mine).getByRole('button', { name: 'Изменить' }));
    expect((within(mine).getByLabelText('Текст заметки') as HTMLTextAreaElement).value).toBe(
      'Договорились о скидке'
    );
  });

  it('«Сохранить» → editOrganizationNoteAction с обрезанным текстом; успех закрывает форму', async () => {
    actions.editOrganizationNoteAction.mockResolvedValue({ ok: true });
    renderSection([PINNED], []);
    const mine = card('Договорились о скидке');
    fireEvent.click(within(mine).getByRole('button', { name: 'Изменить' }));
    fireEvent.change(within(mine).getByLabelText('Текст заметки'), {
      target: { value: '  Скидка 15 %  ' },
    });
    fireEvent.click(within(mine).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(actions.editOrganizationNoteAction).toHaveBeenCalledWith({
        noteId: 'n1',
        organizationId: 'o1',
        body: 'Скидка 15 %',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Заметка сохранена'));
    expect(nav.refresh).toHaveBeenCalled();
    await waitFor(() => expect(within(mine).queryByLabelText('Текст заметки')).toBeNull());
  });

  it('пустой текст при сохранении → тост без action', () => {
    renderSection([PINNED], []);
    const mine = card('Договорились о скидке');
    fireEvent.click(within(mine).getByRole('button', { name: 'Изменить' }));
    fireEvent.change(within(mine).getByLabelText('Текст заметки'), { target: { value: '  ' } });
    fireEvent.click(within(mine).getByRole('button', { name: 'Сохранить' }));
    expect(toastMock.error).toHaveBeenCalledWith(EMPTY_TEXT);
    expect(actions.editOrganizationNoteAction).not.toHaveBeenCalled();
    expect(within(mine).getByLabelText('Текст заметки')).toBeTruthy();
  });

  it('отказ при сохранении → тост из словаря, форма остаётся открытой', async () => {
    actions.editOrganizationNoteAction.mockResolvedValue({ ok: false, error: 'not_found' });
    renderSection([PINNED], []);
    const mine = card('Договорились о скидке');
    fireEvent.click(within(mine).getByRole('button', { name: 'Изменить' }));
    fireEvent.change(within(mine).getByLabelText('Текст заметки'), {
      target: { value: 'Скидка 15 %' },
    });
    fireEvent.click(within(mine).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Заметка не найдена — обновите страницу.')
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(within(mine).getByLabelText('Текст заметки')).toBeTruthy();
  });
});

describe('OrgNotesSection — закрепить / открепить', () => {
  it('«Открепить» у закреплённой → pinned:false и тост об откреплении', async () => {
    actions.pinOrganizationNoteAction.mockResolvedValue({ ok: true });
    renderSection([PINNED], []);
    fireEvent.click(
      within(card('Договорились о скидке')).getByRole('button', { name: 'Открепить' })
    );
    await waitFor(() =>
      expect(actions.pinOrganizationNoteAction).toHaveBeenCalledWith({
        noteId: 'n1',
        organizationId: 'o1',
        pinned: false,
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Заметка откреплена'));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('«Закрепить» у обычной → pinned:true и тост о закреплении', async () => {
    actions.pinOrganizationNoteAction.mockResolvedValue({ ok: true });
    renderSection([], [PLAIN]);
    fireEvent.click(
      within(card('Позвонить в понедельник')).getByRole('button', { name: 'Закрепить' })
    );
    await waitFor(() =>
      expect(actions.pinOrganizationNoteAction).toHaveBeenCalledWith({
        noteId: 'n2',
        organizationId: 'o1',
        pinned: true,
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Заметка закреплена'));
  });

  it('отказ с кодом вне словаря вкладки → общий перевод кода', async () => {
    actions.pinOrganizationNoteAction.mockResolvedValue({ ok: false, error: 'pin_limit' });
    renderSection([], [PLAIN]);
    fireEvent.click(
      within(card('Позвонить в понедельник')).getByRole('button', { name: 'Закрепить' })
    );
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(resolveErrorText('pin_limit'))
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

describe('OrgNotesSection — удаление', () => {
  it('«Удалить» открывает подтверждение; «Отмена» и «×» закрывают без action', async () => {
    renderSection([PINNED], []);
    const mine = card('Договорились о скидке');
    expect(openDialog()).toBeNull();

    fireEvent.click(within(mine).getByRole('button', { name: 'Удалить' }));
    let dialog = within(openDialog());
    expect(dialog.getByRole('heading', { name: 'Удалить заметку?' })).toBeTruthy();
    expect(dialog.getByText(/останется в журнале действий/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(openDialog()).toBeNull());

    fireEvent.click(within(mine).getByRole('button', { name: 'Удалить' }));
    dialog = within(openDialog());
    fireEvent.click(dialog.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(actions.removeOrganizationNoteAction).not.toHaveBeenCalled();
  });

  it('подтверждение → removeOrganizationNoteAction; успех закрывает окно, тост, refresh', async () => {
    actions.removeOrganizationNoteAction.mockResolvedValue({ ok: true });
    renderSection([PINNED], []);
    fireEvent.click(within(card('Договорились о скидке')).getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(openDialog()).getByRole('button', { name: 'Удалить' }));
    await waitFor(() =>
      expect(actions.removeOrganizationNoteAction).toHaveBeenCalledWith({
        noteId: 'n1',
        organizationId: 'o1',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Заметка удалена'));
    expect(nav.refresh).toHaveBeenCalled();
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it('отказ → тост из словаря, окно остаётся открытым', async () => {
    actions.removeOrganizationNoteAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    renderSection([PINNED], []);
    fireEvent.click(within(card('Договорились о скидке')).getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(openDialog()).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(FORBIDDEN_TEXT));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(openDialog()).toBeTruthy();
  });
});
