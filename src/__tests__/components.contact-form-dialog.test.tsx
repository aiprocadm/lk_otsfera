// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  createContactAction: vi.fn(),
  updateContactAction: vi.fn(),
}));
vi.mock('@/server-actions/contacts', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { ContactFormDialog } from '@/components/manager/contacts/contact-form-dialog';

/**
 * Форма контакта (этап 1 ТЗ 12.09.2026, `У-180`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.3–§3.4): создание из списка
 * с первым каналом и правка из карточки. Пустое имя останавливает форму до
 * server action; занятый канал — подсказка с именем владельца и ссылкой
 * «Открыть», а не ошибка базы.
 */
const ORGS = [
  { id: 'o1', name: 'Ромашка' },
  { id: 'o2', name: 'Лютик' },
];

const EDITABLE = {
  id: 'c1',
  name: 'Иванов Иван',
  position: 'Директор',
  note: 'Звонить после обеда',
  organizationId: 'o2',
};

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

function openDialog(): HTMLElement {
  return document.querySelector('dialog[open]') as HTMLElement;
}

describe('ContactFormDialog — создание', () => {
  it('кнопка «Добавить контакт» открывает «Новый контакт» с полями канала; пустое имя → ошибка без action', async () => {
    render(<ContactFormDialog cabinet="manager" mode="create" orgOptions={ORGS} />);
    expect(openDialog()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить контакт' }));
    const dialog = within(openDialog());
    expect(dialog.getByRole('heading', { name: 'Новый контакт' })).toBeTruthy();
    expect(dialog.getByLabelText('Канал связи')).toBeTruthy();
    expect(dialog.getByLabelText('Номер или адрес')).toBeTruthy();
    // Поле «Заметка» есть и при создании (ревью PR-2): ветка с заметкой в createContactAction — живая.
    expect(dialog.queryByLabelText('Заметка')).not.toBeNull();
    const org = dialog.getByLabelText('Организация') as HTMLSelectElement;
    expect(Array.from(org.options).map((o) => o.textContent)).toEqual([
      'Без организации',
      'Ромашка',
      'Лютик',
    ]);

    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: '   ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }));
    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toBe('Укажите имя контакта.')
    );
    expect(actions.createContactAction).not.toHaveBeenCalled();

    // «Отмена» закрывает окно и стирает ошибку.
    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it('все поля и канал → createContactAction; успех → тост, закрытие и переход в карточку', async () => {
    actions.createContactAction.mockResolvedValue({ ok: true, contactId: 'c9' });
    render(<ContactFormDialog cabinet="manager" mode="create" orgOptions={ORGS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить контакт' }));
    const dialog = within(openDialog());
    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: ' Петров Пётр ' } });
    fireEvent.change(dialog.getByLabelText('Должность'), { target: { value: ' Бухгалтер ' } });
    fireEvent.change(dialog.getByLabelText('Организация'), { target: { value: 'o1' } });
    fireEvent.change(dialog.getByLabelText('Канал связи'), { target: { value: 'email' } });
    fireEvent.change(dialog.getByLabelText('Номер или адрес'), {
      target: { value: ' petrov@romashka.ru ' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(actions.createContactAction).toHaveBeenCalledWith({
        name: 'Петров Пётр',
        position: 'Бухгалтер',
        organizationId: 'o1',
        channels: [{ type: 'email', value: 'petrov@romashka.ru' }],
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Контакт создан'));
    expect(nav.push).toHaveBeenCalledWith('/manager/contacts/c9');
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it('только имя: без должности, организации и канала; отказ → текст из словаря формы', async () => {
    actions.createContactAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<ContactFormDialog cabinet="manager" mode="create" orgOptions={ORGS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить контакт' }));
    const dialog = within(openDialog());
    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: 'Сидоров' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }));
    await waitFor(() =>
      expect(actions.createContactAction).toHaveBeenCalledWith({
        name: 'Сидоров',
        organizationId: null,
        channels: [],
      })
    );
    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toBe(
        'Нет права на справочник контактов — обратитесь к администратору.'
      )
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('занятый канал → подсказка с именем владельца и ссылкой «Открыть» в свой кабинет', async () => {
    actions.createContactAction.mockResolvedValue({
      ok: false,
      error: 'contact_channel_taken',
      conflict: { contactId: 'c2', name: 'Пётр Петров' },
    });
    render(<ContactFormDialog cabinet="leader" mode="create" orgOptions={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить контакт' }));
    const dialog = within(openDialog());
    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: 'Сидоров' } });
    fireEvent.change(dialog.getByLabelText('Номер или адрес'), {
      target: { value: '+7 921 000-00-00' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }));
    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toContain(
        'Этот канал уже у контакта «Пётр Петров».'
      )
    );
    expect(actions.createContactAction).toHaveBeenCalledWith({
      name: 'Сидоров',
      organizationId: null,
      channels: [{ type: 'phone', value: '+7 921 000-00-00' }],
    });
    expect(dialog.getByRole('link', { name: 'Открыть' }).getAttribute('href')).toBe(
      '/leader/contacts/c2'
    );
    expect(openDialog()).toBeTruthy();
  });

  it('неизвестный тип канала (не из словаря) → канал не отправляется', async () => {
    actions.createContactAction.mockResolvedValue({ ok: true, contactId: 'c9' });
    render(<ContactFormDialog cabinet="manager" mode="create" orgOptions={ORGS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить контакт' }));
    const dialog = within(openDialog());
    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: 'Сидоров' } });
    // jsdom: значение вне списка опций даёт '' — тип не проходит isContactChannelType.
    fireEvent.change(dialog.getByLabelText('Канал связи'), { target: { value: 'fax' } });
    fireEvent.change(dialog.getByLabelText('Номер или адрес'), { target: { value: '12345' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }));
    await waitFor(() =>
      expect(actions.createContactAction).toHaveBeenCalledWith({
        name: 'Сидоров',
        organizationId: null,
        channels: [],
      })
    );
  });

  it('заметка из состояния уходит в createContactAction (из формы создания её не ввести — фиксируем контракт)', async () => {
    // Ветка `note.trim() ? { note } : {}` в пути создания недостижима через
    // интерфейс: поле «Заметка» есть только в режиме правки. Единственный способ
    // получить непустую заметку в состоянии — переключить тот же экземпляр из
    // правки в создание; тест закрепляет, что заметка при этом не теряется.
    actions.createContactAction.mockResolvedValue({ ok: true, contactId: 'c9' });
    const { rerender } = render(
      <ContactFormDialog
        cabinet="manager"
        mode="edit"
        orgOptions={ORGS}
        contact={{ ...EDITABLE, note: null }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    fireEvent.change(within(openDialog()).getByLabelText('Заметка'), {
      target: { value: ' важное ' },
    });
    rerender(<ContactFormDialog cabinet="manager" mode="create" orgOptions={ORGS} />);
    const dialog = within(openDialog());
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }));
    await waitFor(() =>
      expect(actions.createContactAction).toHaveBeenCalledWith({
        name: 'Иванов Иван',
        position: 'Директор',
        note: 'важное',
        organizationId: 'o2',
        channels: [],
      })
    );
  });
});

describe('ContactFormDialog — правка', () => {
  it('поля предзаполнены, вместо канала — заметка; успех → updateContactAction, тост, refresh, закрытие', async () => {
    actions.updateContactAction.mockResolvedValue({ ok: true, contactId: 'c1' });
    render(
      <ContactFormDialog cabinet="manager" mode="edit" orgOptions={ORGS} contact={EDITABLE} />
    );
    const trigger = screen.getByRole('button', { name: 'Изменить' });
    expect(trigger.className).toContain('border-gray-200');
    fireEvent.click(trigger);
    const dialog = within(openDialog());
    expect(dialog.getByRole('heading', { name: 'Изменить контакт' })).toBeTruthy();
    expect((dialog.getByLabelText('Имя') as HTMLInputElement).value).toBe('Иванов Иван');
    expect((dialog.getByLabelText('Должность') as HTMLInputElement).value).toBe('Директор');
    expect((dialog.getByLabelText('Организация') as HTMLSelectElement).value).toBe('o2');
    expect((dialog.getByLabelText('Заметка') as HTMLTextAreaElement).value).toBe(
      'Звонить после обеда'
    );
    expect(dialog.queryByLabelText('Канал связи')).toBeNull();
    expect(dialog.queryByLabelText('Номер или адрес')).toBeNull();

    fireEvent.change(dialog.getByLabelText('Заметка'), { target: { value: ' новая заметка ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(actions.updateContactAction).toHaveBeenCalledWith({
        id: 'c1',
        name: 'Иванов Иван',
        position: 'Директор',
        note: 'новая заметка',
        organizationId: 'o2',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Контакт сохранён'));
    expect(nav.refresh).toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it('пустые должность, заметка и организация уходят как null; отказ → текст словаря', async () => {
    actions.updateContactAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(
      <ContactFormDialog
        cabinet="admin"
        mode="edit"
        orgOptions={ORGS}
        contact={{ ...EDITABLE, position: null, note: null, organizationId: null }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = within(openDialog());
    expect((dialog.getByLabelText('Должность') as HTMLInputElement).value).toBe('');
    expect((dialog.getByLabelText('Организация') as HTMLSelectElement).value).toBe('');
    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: ' Иванов И. ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(actions.updateContactAction).toHaveBeenCalledWith({
        id: 'c1',
        name: 'Иванов И.',
        position: null,
        note: null,
        organizationId: null,
      })
    );
    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toBe(
        'Контакт или организация не найдены — обновите страницу.'
      )
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(openDialog()).toBeTruthy();
  });

  it('имя из пробелов при правке → ошибка без action', async () => {
    render(
      <ContactFormDialog cabinet="manager" mode="edit" orgOptions={ORGS} contact={EDITABLE} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = within(openDialog());
    // Совсем пустое поле останавливает сам браузер (`required`); пробелы он пропускает — ловит форма.
    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: '   ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toBe('Укажите имя контакта.')
    );
    expect(actions.updateContactAction).not.toHaveBeenCalled();
  });
});

describe('ContactFormDialog — предвыбор организации (У-182, вкладка «Контакты» карточки)', () => {
  it('defaultOrganizationId в режиме создания предвыбирает организацию и уходит в createContactAction', async () => {
    actions.createContactAction.mockResolvedValue({ ok: true, contactId: 'c9' });
    render(
      <ContactFormDialog
        cabinet="manager"
        mode="create"
        orgOptions={ORGS}
        defaultOrganizationId="o1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Добавить контакт' }));
    const dialog = within(openDialog());
    expect((dialog.getByLabelText('Организация') as HTMLSelectElement).value).toBe('o1');
    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: 'Сидоров' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }));
    await waitFor(() =>
      expect(actions.createContactAction).toHaveBeenCalledWith({
        name: 'Сидоров',
        organizationId: 'o1',
        channels: [],
      })
    );
  });

  it('в режиме правки приоритет у организации контакта', () => {
    render(
      <ContactFormDialog
        cabinet="manager"
        mode="edit"
        orgOptions={ORGS}
        contact={EDITABLE}
        defaultOrganizationId="o1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect((within(openDialog()).getByLabelText('Организация') as HTMLSelectElement).value).toBe(
      'o2'
    );
  });
});
