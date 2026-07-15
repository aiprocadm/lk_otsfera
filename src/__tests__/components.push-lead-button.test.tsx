// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { pushLeadToOneCAction } = vi.hoisted(() => ({ pushLeadToOneCAction: vi.fn() }));
vi.mock('@/server-actions/manager/leads', () => ({ pushLeadToOneCAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { PushLeadButton } from '@/components/manager/push-lead-button';

describe('PushLeadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('рендерит secondary-кнопку «Отправить в 1С»', () => {
    render(<PushLeadButton leadId='l1' />);
    const button = screen.getByRole('button', { name: 'Отправить в 1С' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('клик вызывает экшен с leadId; успех — success-тост', async () => {
    pushLeadToOneCAction.mockResolvedValue({ ok: true });
    render(<PushLeadButton leadId='l1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить в 1С' }));

    await waitFor(() => expect(pushLeadToOneCAction).toHaveBeenCalledWith({ leadId: 'l1' }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Лид поставлен в очередь отправки в 1С')
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('already_pushed — локальная дельта текста поверх errorMessageRu', async () => {
    pushLeadToOneCAction.mockResolvedValue({ ok: false, error: 'already_pushed' });
    render(<PushLeadButton leadId='l1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить в 1С' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Лид уже отправлен в 1С'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('queue_unavailable — общий словарь errorMessageRu (дельта не нужна)', async () => {
    pushLeadToOneCAction.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    render(<PushLeadButton leadId='l1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить в 1С' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Фоновая обработка недоступна. Попробуйте позже.')
    );
  });

  it('код вне локальной дельты падает в errorMessageRu (validation)', async () => {
    pushLeadToOneCAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(<PushLeadButton leadId='l1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить в 1С' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Проверьте поля формы.'));
  });

  it('кнопка disabled во время pending — double-submit невозможен', async () => {
    let resolveAction!: (v: { ok: true }) => void;
    pushLeadToOneCAction.mockImplementation(
      () => new Promise<{ ok: true }>((r) => { resolveAction = r; })
    );
    render(<PushLeadButton leadId='l1' />);

    const button = screen.getByRole('button', { name: 'Отправить в 1С' }) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(button.disabled).toBe(true));
    expect(toastSuccess).not.toHaveBeenCalled();

    resolveAction({ ok: true });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(toastSuccess).toHaveBeenCalledWith('Лид поставлен в очередь отправки в 1С');
  });
});
