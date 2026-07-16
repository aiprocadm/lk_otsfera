// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { claimOrderAction } = vi.hoisted(() => ({ claimOrderAction: vi.fn() }));
vi.mock('@/server-actions/manager/orderAssignment', () => ({ claimOrderAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ClaimOrderButton } from '@/components/manager/claim-order-button';

describe('ClaimOrderButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('managerId != null — кнопка не рендерится (заказ уже закреплён)', () => {
    const { container } = render(<ClaimOrderButton orderId='o1' managerId='m1' />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('managerId === null — рендерит кнопку «Взять в работу»', () => {
    render(<ClaimOrderButton orderId='o1' managerId={null} />);
    const button = screen.getByRole('button', { name: 'Взять в работу' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('клик вызывает экшен с orderId; успех — success-тост', async () => {
    claimOrderAction.mockResolvedValue({ ok: true, changed: true });
    render(<ClaimOrderButton orderId='o1' managerId={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() => expect(claimOrderAction).toHaveBeenCalledWith({ orderId: 'o1' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заказ закреплён за вами'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('already_assigned — локальная дельта поверх errorMessageRu (контекст самозабора)', async () => {
    claimOrderAction.mockResolvedValue({ ok: false, error: 'already_assigned' });
    render(<ClaimOrderButton orderId='o1' managerId={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Заказ уже взят другим менеджером')
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('код вне локальной дельты падает в общий словарь errorMessageRu (not_found)', async () => {
    claimOrderAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<ClaimOrderButton orderId='o1' managerId={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Заказ не найден.'));
  });

  it('кнопка disabled во время pending — double-submit невозможен', async () => {
    let resolveAction!: (v: { ok: true; changed: boolean }) => void;
    claimOrderAction.mockImplementation(
      () => new Promise<{ ok: true; changed: boolean }>((r) => { resolveAction = r; })
    );
    render(<ClaimOrderButton orderId='o1' managerId={null} />);

    const button = screen.getByRole('button', { name: 'Взять в работу' }) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(button.disabled).toBe(true));
    expect(toastSuccess).not.toHaveBeenCalled();

    resolveAction({ ok: true, changed: true });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(toastSuccess).toHaveBeenCalledWith('Заказ закреплён за вами');
  });
});
