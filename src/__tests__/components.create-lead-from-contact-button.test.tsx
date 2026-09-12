// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({ createLeadFromContactAction: vi.fn() }));
vi.mock('@/server-actions/contacts', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { CreateLeadFromContactButton } from '@/components/manager/contacts/create-lead-from-contact-button';

/**
 * «Создать лид» из карточки контакта (этап 1 ТЗ 12.09.2026, `У-179`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.12): человек вводит только
 * тему и заметку; успех ведёт в карточку лида; отказ валидатора лида показывает
 * его слова, прочие коды — словарь формы.
 */
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

function open() {
  render(<CreateLeadFromContactButton contactId="c1" />);
  // Кнопка-триггер и кнопка отправки в диалоге называются одинаково — берём первую (вне диалога).
  fireEvent.click(screen.getAllByRole('button', { name: 'Создать лид' })[0]);
  return within(openDialog());
}

describe('CreateLeadFromContactButton', () => {
  it('открывает «Новый лид из контакта»; пустая тема → ошибка без action; «Отмена» закрывает', async () => {
    const dialog = open();
    expect(dialog.getByRole('heading', { name: 'Новый лид из контакта' })).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Тема'), { target: { value: '   ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe('Укажите тему лида.'));
    expect(actions.createLeadFromContactAction).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it('тема и заметка → action; успех → тост, закрытие и переход в карточку лида', async () => {
    actions.createLeadFromContactAction.mockResolvedValue({ ok: true, leadId: 'l7' });
    const dialog = open();
    fireEvent.change(dialog.getByLabelText('Тема'), { target: { value: ' Обучение по ОТ ' } });
    fireEvent.change(dialog.getByLabelText('Заметка'), { target: { value: ' 12 человек ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() =>
      expect(actions.createLeadFromContactAction).toHaveBeenCalledWith({
        contactId: 'c1',
        subject: 'Обучение по ОТ',
        notes: '12 человек',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Лид создан'));
    expect(nav.push).toHaveBeenCalledWith('/manager/leads/l7');
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it('без заметки поле не отправляется; ответ со словами валидатора → показываем их', async () => {
    actions.createLeadFromContactAction.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['У контакта нет телефона.', 'Укажите почту.'],
    });
    const dialog = open();
    fireEvent.change(dialog.getByLabelText('Тема'), { target: { value: 'Тема' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() =>
      expect(actions.createLeadFromContactAction).toHaveBeenCalledWith({
        contactId: 'c1',
        subject: 'Тема',
      })
    );
    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toBe('У контакта нет телефона. Укажите почту.')
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(openDialog()).toBeTruthy();
  });

  it('пустой список messages → код переводится словарём формы', async () => {
    actions.createLeadFromContactAction.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: [],
    });
    const dialog = open();
    fireEvent.change(dialog.getByLabelText('Тема'), { target: { value: 'Тема' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe('Укажите тему лида.'));
  });

  it('ответ без messages → код переводится словарём формы', async () => {
    actions.createLeadFromContactAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    const dialog = open();
    fireEvent.change(dialog.getByLabelText('Тема'), { target: { value: 'Тема' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toBe('Нет права создавать лиды.')
    );
  });
});
