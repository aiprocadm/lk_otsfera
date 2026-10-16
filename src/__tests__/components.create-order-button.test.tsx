// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * «Создать заказ» без лида (этап 6 ТЗ 13.10.2026, `У-306`): окно с
 * организацией, названием и видом работ; после создания — карточка заказа;
 * без своих организаций — объяснение, что сделать.
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const { createOrderAction } = vi.hoisted(() => ({ createOrderAction: vi.fn() }));
vi.mock('@/server-actions/orders/create', () => ({ createOrderAction }));

const { showModal, close } = vi.hoisted(() => ({ showModal: vi.fn(), close: vi.fn() }));
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
  showModal();
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute('open');
  close();
};

import { CreateOrderButton } from '@/components/manager/create-order-button';

const ORGS = [{ id: 'o1', name: 'ООО Ромашка' }];

function fill() {
  fireEvent.change(screen.getByLabelText('Организация *'), { target: { value: 'o1' } });
  fireEvent.change(screen.getByLabelText('Название заказа *'), {
    target: { value: 'Обучение по ОТ' },
  });
  fireEvent.change(screen.getByLabelText('Вид работ'), {
    target: { value: 'document_development' },
  });
}

beforeEach(() => vi.clearAllMocks());

describe('CreateOrderButton', () => {
  it('создаёт заказ и ведёт в его карточку', async () => {
    createOrderAction.mockResolvedValue({ ok: true, orderId: 'ord-9' });
    render(<CreateOrderButton organizations={ORGS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/manager/orders/ord-9'));
    expect(createOrderAction).toHaveBeenCalledWith({
      organizationId: 'o1',
      title: 'Обучение по ОТ',
      serviceType: 'document_development',
    });
  });

  it('чужая организация и прочие отказы — объяснение в окне', async () => {
    createOrderAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<CreateOrderButton organizations={ORGS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(
      await screen.findByText('Эта организация вам недоступна — выберите из списка.')
    ).toBeTruthy();
    createOrderAction.mockResolvedValue({ ok: false, error: 'validation' });
    fireEvent.change(screen.getByLabelText('Вид работ'), { target: { value: 'training' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() =>
      expect(createOrderAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ serviceType: 'training' })
      )
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('без своих организаций — что сделать, а не пустая форма', () => {
    render(<CreateOrderButton organizations={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    expect(screen.getByText(/создайте организацию в разделе «Организации»/)).toBeTruthy();
    expect(screen.queryByLabelText('Организация *')).toBeNull();
  });

  it('«Отмена» закрывает окно', () => {
    render(<CreateOrderButton organizations={ORGS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(close).toHaveBeenCalled();
  });
});
