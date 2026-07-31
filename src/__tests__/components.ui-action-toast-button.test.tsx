// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ActionToastButton } from '@/components/ui/action-toast-button';

describe('ActionToastButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('рендерит кнопку с label; кнопка активна', () => {
    render(<ActionToastButton label="Сделать" successText="Готово" action={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Сделать' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('disabled-проп прокидывается в Button', () => {
    render(<ActionToastButton label="Сделать" successText="Готово" action={vi.fn()} disabled />);
    expect((screen.getByRole('button', { name: 'Сделать' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('клик вызывает action; успех — success-тост с successText', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<ActionToastButton label="Сделать" successText="Готово" action={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Сделать' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Готово'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('ошибка с кодом из errorLabels — контекстная дельта', async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: 'custom_code' });
    render(
      <ActionToastButton
        label="Сделать"
        successText="Готово"
        errorLabels={{ custom_code: 'Контекстный текст' }}
        action={action}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сделать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Контекстный текст'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('код вне errorLabels падает в общий словарь errorMessageRu (validation)', async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: 'validation' });
    render(<ActionToastButton label="Сделать" successText="Готово" action={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Сделать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Проверьте поля формы.'));
  });

  it('неизвестный код — fallback resolveErrorText «Ошибка: <code>»', async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: 'mystery' });
    render(<ActionToastButton label="Сделать" successText="Готово" action={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Сделать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Ошибка: mystery'));
  });

  it('кнопка disabled во время pending — double-submit невозможен', async () => {
    let resolveAction!: (v: { ok: true }) => void;
    const action = vi.fn().mockImplementation(
      () =>
        new Promise<{ ok: true }>((r) => {
          resolveAction = r;
        })
    );
    render(<ActionToastButton label="Сделать" successText="Готово" action={action} />);

    const button = screen.getByRole('button', { name: 'Сделать' }) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(button.disabled).toBe(true));
    expect(toastSuccess).not.toHaveBeenCalled();

    resolveAction({ ok: true });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(toastSuccess).toHaveBeenCalledWith('Готово');
  });
});
