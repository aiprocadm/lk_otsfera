// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { AskQuestionButton } from '@/components/support/ask-question-button';

// Этап 9 (ФТ-11.1) — кнопка и модалка «Задать вопрос».
const fetchMock = vi.fn();

function openDialog() {
  render(<AskQuestionButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Задать вопрос' }));
}

/** Поля обязательные — заполняем перед сабмитом (иначе форма не отправится). */
function fillAndSubmit(subject = 'Тема', body = 'Текст') {
  fireEvent.change(screen.getByLabelText('Тема'), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText('Вопрос'), { target: { value: body } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('AskQuestionButton', () => {
  it('модалка открывается по кнопке и закрывается «Отменой»', () => {
    openDialog();
    expect(screen.getByLabelText('Тема')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByLabelText('Тема')).toBeNull();
  });

  it('Escape закрывает модалку так же, как «Отмена»', () => {
    // У кнопки «Отмена» свой обработчик, а Escape идёт через onClose самого
    // диалога — это две разные точки закрытия, и обе должны работать.
    openDialog();
    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    fireEvent(
      dialog as HTMLDialogElement,
      new Event('cancel', { bubbles: false, cancelable: true })
    );
    expect(screen.queryByLabelText('Тема')).toBeNull();
  });

  it('успешная отправка: POST на роут, toast с кодом, модалка закрыта', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ code: 'ОБР-3F7A2C' }) });
    openDialog();
    fireEvent.change(screen.getByLabelText('Тема'), { target: { value: 'Тема' } });
    fireEvent.change(screen.getByLabelText('Вопрос'), { target: { value: 'Текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/support/question',
        expect.objectContaining({ method: 'POST' })
      )
    );
    const body = fetchMock.mock.calls[0]![1].body as FormData;
    expect(body.get('subject')).toBe('Тема');
    expect(body.get('body')).toBe('Текст');
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Обращение ОБР-3F7A2C принято — мы ответим в кабинете.'
      )
    );
    expect(screen.queryByLabelText('Тема')).toBeNull();
  });

  it('успех без кода → нейтральный toast', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    openDialog();
    fillAndSubmit();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Обращение принято.'));
  });

  it('ошибка с messages → список role=alert, модалка открыта', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'validation', messages: ['Укажите тему обращения'] }),
    });
    openDialog();
    fillAndSubmit();
    await waitFor(() => {
      const alerts = screen
        .getAllByRole('alert')
        .map((a) => a.textContent)
        .join(' ');
      expect(alerts).toContain('Укажите тему обращения');
    });
    expect(screen.getByLabelText('Тема')).toBeTruthy();
  });

  it('маппинг кодов ошибок и сетевой сбой → toast', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'too_large' }) });
    openDialog();
    fillAndSubmit();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Файл слишком большой.'));

    toastError.mockClear();
    fetchMock.mockResolvedValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось отправить обращение.'));
  });

  it('кастомный className применяется к кнопке (светлая шапка org)', () => {
    render(<AskQuestionButton className="org-btn" />);
    expect(screen.getByRole('button', { name: 'Задать вопрос' }).className).toBe('org-btn');
  });
});
