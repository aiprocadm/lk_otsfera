// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  addChannelAction: vi.fn(),
  removeChannelAction: vi.fn(),
  setPrimaryChannelAction: vi.fn(),
}));
vi.mock('@/server-actions/contacts', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

// Диалог объединения — заглушка: проверяем, что и с чем его открывают.
vi.mock('@/components/manager/contacts/merge-contacts-dialog', () => ({
  MergeContactsDialog: (props: {
    cabinet: string;
    primaryId: string;
    primaryName: string;
    open: boolean;
    onClose: () => void;
    preselect?: { contactId: string; name: string };
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'merge-dialog',
        'data-cabinet': props.cabinet,
        'data-primary': props.primaryId,
        'data-name': props.primaryName,
        'data-open': String(props.open),
        'data-preselect': JSON.stringify(props.preselect ?? null),
      },
      React.createElement('button', { type: 'button', onClick: props.onClose }, 'закрыть заглушку')
    ),
}));

import { ContactChannels } from '@/components/manager/contacts/contact-channels';
import type { ContactCardChannel } from '@/lib/services/contacts/get';

/**
 * Блок «Каналы» карточки контакта (этап 1 ТЗ 12.09.2026, `У-180`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.3–§3.5): список с признаком
 * основного и «из кабинета», смена основного, удаление, добавление; занятый
 * канал — подсказка с именем владельца, ссылкой «Открыть» и кнопкой
 * «Объединить», открывающей диалог объединения с предвыбором.
 */
const CHANNELS: ContactCardChannel[] = [
  { id: 'ch1', type: 'email', value: 'ivan@romashka.ru', isPrimary: true, locked: true },
  { id: 'ch2', type: 'phone', value: '+7 921 000-00-00', isPrimary: false, locked: false },
];

function renderChannels(channels: ContactCardChannel[] = CHANNELS) {
  return render(
    <ContactChannels
      cabinet="manager"
      contactId="c1"
      contactName="Иванов Иван"
      channels={channels}
    />
  );
}

function row(value: string): HTMLElement {
  return screen.getByText(value).closest('li') as HTMLElement;
}

beforeEach(() => vi.clearAllMocks());

describe('ContactChannels — список', () => {
  it('без каналов — подсказка, зачем они нужны; форма добавления есть', () => {
    renderChannels([]);
    expect(screen.getByText(/Каналов пока нет/).textContent).toContain('находили карточку сами');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить канал' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('основной и «из кабинета»: без «Сделать основным», «Удалить» заблокирована с причиной; обычный — обе кнопки', () => {
    renderChannels();
    const locked = row('ivan@romashka.ru');
    expect(locked.textContent).toContain('E-mail');
    expect(locked.textContent).toContain('Основной');
    expect(locked.textContent).toContain('Из кабинета');
    expect(
      locked.querySelector('[title="Данные пользователя кабинета — меняются в его профиле"]')
    ).toBeTruthy();
    expect(locked.querySelector('button')?.textContent).toBe('Удалить');
    const lockedRemove = locked.querySelector('button') as HTMLButtonElement;
    expect(lockedRemove.disabled).toBe(true);
    expect(lockedRemove.title).toBe('Это данные пользователя кабинета — меняются в его профиле');

    const plain = row('+7 921 000-00-00');
    expect(plain.textContent).toContain('Телефон');
    expect(plain.textContent).not.toContain('Основной');
    expect(plain.textContent).not.toContain('Из кабинета');
    const buttons = Array.from(plain.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(['Сделать основным', 'Удалить']);
    expect(buttons[1].disabled).toBe(false);
    expect(buttons[1].hasAttribute('title')).toBe(false);
  });

  it('«Сделать основным» → action, тост и перечитывание страницы', async () => {
    actions.setPrimaryChannelAction.mockResolvedValue({ ok: true, contactId: 'c1' });
    renderChannels();
    fireEvent.click(screen.getByRole('button', { name: 'Сделать основным' }));
    await waitFor(() =>
      expect(actions.setPrimaryChannelAction).toHaveBeenCalledWith({ channelId: 'ch2' })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Основной канал изменён'));
    expect(nav.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('«Удалить» с отказом → текст из словаря формы, без тоста', async () => {
    actions.removeChannelAction.mockResolvedValue({ ok: false, error: 'not_found' });
    renderChannels();
    const buttons = Array.from(row('+7 921 000-00-00').querySelectorAll('button'));
    fireEvent.click(buttons[1]);
    await waitFor(() =>
      expect(actions.removeChannelAction).toHaveBeenCalledWith({ channelId: 'ch2' })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Канал или контакт не найдены — обновите страницу.'
      )
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Объединить' })).toBeNull();
  });
});

describe('ContactChannels — добавление', () => {
  it('пустое значение → ошибка без action', async () => {
    renderChannels();
    fireEvent.change(screen.getByLabelText('Номер или адрес'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить канал' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Введите номер или адрес.')
    );
    expect(actions.addChannelAction).not.toHaveBeenCalled();
  });

  it('неизвестный тип (не из словаря) → та же ошибка без action', async () => {
    renderChannels();
    // jsdom: значение вне списка опций даёт '' — тип не проходит isContactChannelType.
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'fax' } });
    fireEvent.change(screen.getByLabelText('Номер или адрес'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить канал' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Введите номер или адрес.')
    );
    expect(actions.addChannelAction).not.toHaveBeenCalled();
  });

  it('успех → action с типом и обрезанным значением, тост, поле очищено, refresh', async () => {
    actions.addChannelAction.mockResolvedValue({ ok: true, contactId: 'c1' });
    renderChannels();
    const select = screen.getByLabelText('Тип') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Телефон',
      'E-mail',
      'Telegram',
      'WhatsApp',
      'MAX',
    ]);
    fireEvent.change(select, { target: { value: 'telegram' } });
    const input = screen.getByLabelText('Номер или адрес') as HTMLInputElement;
    fireEvent.change(input, { target: { value: ' @ivanov ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить канал' }));
    await waitFor(() =>
      expect(actions.addChannelAction).toHaveBeenCalledWith({
        contactId: 'c1',
        type: 'telegram',
        value: '@ivanov',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Канал добавлен'));
    await waitFor(() => expect(input.value).toBe(''));
    expect(nav.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('занятый канал → имя владельца, «Открыть» и «Объединить», открывающая диалог с предвыбором', async () => {
    actions.addChannelAction.mockResolvedValue({
      ok: false,
      error: 'contact_channel_taken',
      conflict: { contactId: 'c2', name: 'Пётр Петров' },
    });
    renderChannels();
    expect(screen.queryByTestId('merge-dialog')).toBeNull();
    fireEvent.change(screen.getByLabelText('Номер или адрес'), {
      target: { value: '+7 921 111-11-11' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить канал' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Этот канал уже у контакта «Пётр Петров».'
      )
    );
    expect(screen.getByRole('link', { name: 'Открыть' }).getAttribute('href')).toBe(
      '/manager/contacts/c2'
    );
    expect(toastMock.success).not.toHaveBeenCalled();

    // Диалог смонтирован закрытым с предвыбором владельца; «Объединить» открывает.
    const dialog = screen.getByTestId('merge-dialog');
    expect(dialog.getAttribute('data-open')).toBe('false');
    expect(dialog.getAttribute('data-cabinet')).toBe('manager');
    expect(dialog.getAttribute('data-primary')).toBe('c1');
    expect(dialog.getAttribute('data-name')).toBe('Иванов Иван');
    expect(JSON.parse(dialog.getAttribute('data-preselect')!)).toEqual({
      contactId: 'c2',
      name: 'Пётр Петров',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Объединить' }));
    await waitFor(() =>
      expect(screen.getByTestId('merge-dialog').getAttribute('data-open')).toBe('true')
    );
    fireEvent.click(screen.getByRole('button', { name: 'закрыть заглушку' }));
    await waitFor(() =>
      expect(screen.getByTestId('merge-dialog').getAttribute('data-open')).toBe('false')
    );
  });

  it('прочий отказ → текст словаря, без «Объединить» и без диалога', async () => {
    actions.addChannelAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    renderChannels();
    fireEvent.change(screen.getByLabelText('Номер или адрес'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить канал' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Нет права на справочник контактов.')
    );
    expect(screen.queryByRole('button', { name: 'Объединить' })).toBeNull();
    expect(screen.queryByTestId('merge-dialog')).toBeNull();
  });
});
