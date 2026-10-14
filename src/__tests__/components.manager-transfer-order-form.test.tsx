// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { transferOrderAction } = vi.hoisted(() => ({ transferOrderAction: vi.fn() }));
vi.mock('@/server-actions/manager/orderAssignment', () => ({ transferOrderAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ManagerTransferOrderForm } from '@/components/manager/manager-transfer-order-form';

/** «Передать заказ» (`У-283`): выбор коллеги, отправка, честные отказы. */
const CANDIDATES = [
  { id: 'u2', name: 'Петрова Анна', email: 'petrova@x.ru' },
  { id: 'u3', name: null, email: 'nobody@x.ru' },
];

beforeEach(() => vi.clearAllMocks());

describe('ManagerTransferOrderForm', () => {
  it('без выбора кнопка неактивна; выбрали — передаём, тост с именем, страница обновлена', async () => {
    transferOrderAction.mockResolvedValue({ ok: true, changed: true });
    render(<ManagerTransferOrderForm orderId="ord-1" candidates={CANDIDATES} />);
    const btn = screen.getByRole('button', { name: 'Передать' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Кому передать заказ'), { target: { value: 'u2' } });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(transferOrderAction).toHaveBeenCalledWith({ orderId: 'ord-1', toUserId: 'u2' })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заказ передан: Петрова Анна.'));
    expect(refresh).toHaveBeenCalled();
  });

  it('у кандидата без имени в тосте — почта', async () => {
    transferOrderAction.mockResolvedValue({ ok: true, changed: true });
    render(<ManagerTransferOrderForm orderId="ord-1" candidates={CANDIDATES} />);
    fireEvent.change(screen.getByLabelText('Кому передать заказ'), { target: { value: 'u3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Передать' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заказ передан: nobody@x.ru.'));
  });

  it('отказ сервера — по-русски, без обновления', async () => {
    transferOrderAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<ManagerTransferOrderForm orderId="ord-1" candidates={CANDIDATES} />);
    fireEvent.change(screen.getByLabelText('Кому передать заказ'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Передать' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Передать можно только свой заказ. Обновите страницу.'
      )
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('коллег нет — объясняем, что передать некому, без пустого селекта', () => {
    render(<ManagerTransferOrderForm orderId="ord-1" candidates={[]} />);
    expect(screen.getByText(/передать заказ некому/)).toBeTruthy();
    expect(screen.queryByLabelText('Кому передать заказ')).toBeNull();
  });
});
