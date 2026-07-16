// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { archiveInboundMessageAction, restoreInboundMessageAction } = vi.hoisted(() => ({
  archiveInboundMessageAction: vi.fn(),
  restoreInboundMessageAction: vi.fn()
}));
vi.mock('@/server-actions/inbound', () => ({ archiveInboundMessageAction, restoreInboundMessageAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { InboxArchiveButton } from '@/components/manager/inbox-archive-button';

describe('InboxArchiveButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mode=archive: кнопка «В архив», клик зовёт archive-экшен, успех — success-тост', async () => {
    archiveInboundMessageAction.mockResolvedValue({ ok: true });
    render(<InboxArchiveButton inboundMessageId='im-1' mode='archive' />);

    fireEvent.click(screen.getByRole('button', { name: 'В архив' }));

    await waitFor(() =>
      expect(archiveInboundMessageAction).toHaveBeenCalledWith({ inboundMessageId: 'im-1' })
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Обращение перемещено в архив')
    );
    expect(restoreInboundMessageAction).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('mode=restore: кнопка «Вернуть», клик зовёт restore-экшен, успех — success-тост', async () => {
    restoreInboundMessageAction.mockResolvedValue({ ok: true });
    render(<InboxArchiveButton inboundMessageId='im-2' mode='restore' />);

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));

    await waitFor(() =>
      expect(restoreInboundMessageAction).toHaveBeenCalledWith({ inboundMessageId: 'im-2' })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Обращение восстановлено'));
    expect(archiveInboundMessageAction).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('forbidden — локальная дельта текста поверх errorMessageRu', async () => {
    archiveInboundMessageAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<InboxArchiveButton inboundMessageId='im-1' mode='archive' />);

    fireEvent.click(screen.getByRole('button', { name: 'В архив' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет доступа к обращению'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('код вне локальной дельты падает в errorMessageRu (validation)', async () => {
    restoreInboundMessageAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(<InboxArchiveButton inboundMessageId='im-1' mode='restore' />);

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Проверьте поля формы.'));
  });

  it('кнопка disabled во время pending — double-submit невозможен', async () => {
    let resolveAction!: (v: { ok: true }) => void;
    archiveInboundMessageAction.mockImplementation(
      () => new Promise<{ ok: true }>((r) => { resolveAction = r; })
    );
    render(<InboxArchiveButton inboundMessageId='im-1' mode='archive' />);

    const button = screen.getByRole('button', { name: 'В архив' }) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(button.disabled).toBe(true));
    expect(toastSuccess).not.toHaveBeenCalled();

    resolveAction({ ok: true });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(toastSuccess).toHaveBeenCalledWith('Обращение перемещено в архив');
  });
});
