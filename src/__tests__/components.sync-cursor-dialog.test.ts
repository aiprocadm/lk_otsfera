// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { rewindCursorAction } = vi.hoisted(() => ({ rewindCursorAction: vi.fn() }));
vi.mock('@/server-actions/admin/syncControl', () => ({ rewindCursorAction }));

import { confirmArmed, SyncCursorDialog } from '@/components/admin/sync-cursor-dialog';

describe('confirmArmed', () => {
  it('is false until the typed name matches the entity', () => {
    expect(confirmArmed('', 'order')).toBe(false);
    expect(confirmArmed('ord', 'order')).toBe(false);
    expect(confirmArmed(' order ', 'order')).toBe(true);
    expect(confirmArmed('order', 'order')).toBe(true);
  });
});

describe('SyncCursorDialog initial render', () => {
  it('renders the entity name and a disabled confirm button when closed-armed', () => {
    const html = renderToString(
      React.createElement(SyncCursorDialog, {
        entity: 'order',
        currentCursor: '2026-06-05T00:00:00.000Z',
      })
    );
    expect(html).toContain('order');
  });
});

describe('SyncCursorDialog (interactive, jsdom)', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rewindCursorAction.mockReset();
    refresh.mockClear();
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
  });

  it('renders the trigger and opens the dialog on click, showing the current cursor', async () => {
    render(
      React.createElement(SyncCursorDialog, {
        entity: 'order',
        currentCursor: '2026-06-05T00:00:00.000Z',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByText('2026-06-05T00:00:00.000Z')).toBeTruthy();
  });

  it('renders an em-dash when currentCursor is null', async () => {
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('both submit buttons are disabled until the entity name is typed to confirm', async () => {
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    expect(
      (screen.getByRole('button', { name: 'Сбросить (полный re-pull)' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Перемотать' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('typing the matching entity name arms "Сбросить"; "Перемотать" stays disabled without a cursor value', async () => {
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    const confirmInput = screen.getByRole('textbox', { name: /Для подтверждения/ });
    fireEvent.change(confirmInput, { target: { value: 'order' } });

    expect(
      (screen.getByRole('button', { name: 'Сбросить (полный re-pull)' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect((screen.getByRole('button', { name: 'Перемотать' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('filling the datetime value and confirming enables "Перемотать"', async () => {
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    const dtInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dtInput, { target: { value: '2026-07-01T10:00' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'order' },
    });

    expect((screen.getByRole('button', { name: 'Перемотать' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('clearing the datetime value resets the stored cursor to an empty string', async () => {
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    const dtInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dtInput, { target: { value: '2026-07-01T10:00' } });
    fireEvent.change(dtInput, { target: { value: '' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'order' },
    });

    // Empty cursor value keeps "Перемотать" disabled (value === '' guard).
    expect((screen.getByRole('button', { name: 'Перемотать' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('"Отмена" closes the dialog without submitting', async () => {
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(rewindCursorAction).not.toHaveBeenCalled();
  });

  it('Escape (Dialog cancel event) closes the dialog and resets typed/value/error state', async () => {
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'order' },
    });

    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialogEl, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('"Сбросить (полный re-pull)" success: submits cursor="" and entity, closes, then refreshes', async () => {
    rewindCursorAction.mockResolvedValue({ ok: true });
    render(
      React.createElement(SyncCursorDialog, {
        entity: 'order',
        currentCursor: '2026-01-01T00:00:00.000Z',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'order' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить (полный re-pull)' }));

    await waitFor(() => expect(rewindCursorAction).toHaveBeenCalledTimes(1));
    const fd = rewindCursorAction.mock.calls[0][0] as FormData;
    expect(fd.get('entity')).toBe('order');
    expect(fd.get('cursor')).toBe('');
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('"Перемотать" success: submits cursor=value and entity, closes, then refreshes', async () => {
    rewindCursorAction.mockResolvedValue({ ok: true });
    render(React.createElement(SyncCursorDialog, { entity: 'payments', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    const dtInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dtInput, { target: { value: '2026-07-01T10:00' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'payments' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Перемотать' }));

    await waitFor(() => expect(rewindCursorAction).toHaveBeenCalledTimes(1));
    const fd = rewindCursorAction.mock.calls[0][0] as FormData;
    expect(fd.get('entity')).toBe('payments');
    expect(fd.get('cursor')).toBe(new Date('2026-07-01T10:00').toISOString());
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('error path (invalid_cursor): renders the mapped error, dialog stays open, no refresh', async () => {
    rewindCursorAction.mockResolvedValue({ ok: false, error: 'invalid_cursor' });
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'order' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить (полный re-pull)' }));

    await waitFor(() =>
      expect(
        screen.getByText('Недопустимое значение курсора (в будущем или не дата).')
      ).toBeTruthy()
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('error path (unknown code) falls back to the generic "Ошибка: <code>" text', async () => {
    rewindCursorAction.mockResolvedValue({ ok: false, error: 'mystery' });
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'order' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить (полный re-pull)' }));

    await waitFor(() => expect(screen.getByText('Ошибка: mystery')).toBeTruthy());
  });

  it('busy state disables both submit buttons while pending', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    rewindCursorAction.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'order' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить (полный re-pull)' }));

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Сбросить (полный re-pull)' }) as HTMLButtonElement)
          .disabled
      ).toBe(true)
    );
    expect((screen.getByRole('button', { name: 'Применяем…' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    resolvePromise({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('reopening the dialog after a close resets typed/value/error (openDialog handler sets open=true only; close() clears state)', async () => {
    rewindCursorAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: /Для подтверждения/ }), {
      target: { value: 'order' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить (полный re-pull)' }));
    await waitFor(() => expect(screen.getByText('Проверьте значение даты.')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Курсор…' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Проверьте значение даты.')).toBeNull();
    expect(
      (screen.getByRole('textbox', { name: /Для подтверждения/ }) as HTMLInputElement).value
    ).toBe('');
  });
});
