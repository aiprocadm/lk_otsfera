// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { replyAction, toastError, toastSuccess, refresh } = vi.hoisted(() => ({
  replyAction: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/server-actions/cabinetDialogs', () => ({ replyFromCabinetAction: replyAction }));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { CabinetReplyForm } from '@/components/cabinet-dialogs/cabinet-reply-form';

/** Поле «Написать менеджеру» (`У-234`). */
beforeEach(() => {
  vi.clearAllMocks();
  replyAction.mockResolvedValue({ ok: true });
});

describe('CabinetReplyForm', () => {
  it('пустое поле — кнопка недоступна; с текстом отправляет и очищает поле', async () => {
    render(React.createElement(CabinetReplyForm, {}));
    const btn = screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const area = screen.getByLabelText('Написать менеджеру') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Здравствуйте' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(replyAction).toHaveBeenCalled());
    expect((replyAction.mock.calls[0][0] as FormData).get('text')).toBe('Здравствуйте');
    await waitFor(() => expect(area.value).toBe(''));
    expect(toastSuccess).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('отказ сервиса: тексты проверки или русский код; текст сохраняется', async () => {
    render(React.createElement(CabinetReplyForm, {}));
    const area = screen.getByLabelText('Написать менеджеру') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Текст' } });
    replyAction.mockResolvedValueOnce({
      ok: false,
      error: 'validation',
      messages: ['Опишите вопрос'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Опишите вопрос'));
    expect(area.value).toBe('Текст');

    replyAction.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));

    replyAction.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('подсказка про чужой канал показывается, когда она есть', () => {
    render(React.createElement(CabinetReplyForm, { hint: 'Ответ уйдёт в переписку кабинета' }));
    expect(screen.getByText('Ответ уйдёт в переписку кабинета')).toBeTruthy();
  });
});
