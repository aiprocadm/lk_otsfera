// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { assignOrderManagerLeaderAction } = vi.hoisted(() => ({
  assignOrderManagerLeaderAction: vi.fn()
}));
vi.mock('@/server-actions/manager/orderAssignment', () => ({ assignOrderManagerLeaderAction }));

import { LeaderAssignOrderManagerForm } from '@/components/leader/leader-assign-order-manager-form';

const CANDIDATES = [
  { id: 'm1', email: 'zed@x.com', name: null },
  { id: 'm2', email: 'anna@x.com', name: 'Anna' },
];

const THREE_CANDIDATES = [
  { id: 'm1', email: 'zed@x.com', name: null },
  { id: 'm2', email: 'anna@x.com', name: 'Anna' },
  { id: 'm3', email: 'bob@x.com', name: 'Bob' },
];

// Обе перестановки (named, nameless): обе стороны ?? в компараторе выполняются
// независимо от порядка обхода сортировки.
const MANY_CANDIDATES = [
  { id: 'x1', email: 'nameless-a@x.com', name: null },
  { id: 'x2', email: 'nameless-b@x.com', name: null },
  { id: 'x3', email: 'carl@x.com', name: 'Carl' },
  { id: 'x4', email: 'dana@x.com', name: 'Dana' },
];

describe('LeaderAssignOrderManagerForm', () => {
  beforeEach(() => {
    assignOrderManagerLeaderAction.mockReset();
  });

  it('рендерит опцию «Без менеджера» и сортирует: текущий первым, дальше по алфавиту', () => {
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels[0]).toBe('— Без менеджера —');
    // m1 (текущий) первым среди кандидатов, хотя email z > a
    expect(optionLabels[1]).toBe('zed@x.com');
    expect(optionLabels[2]).toBe('Anna (anna@x.com)');
    expect(select.value).toBe('m1');
  });

  it('без текущего менеджера сортирует по алфавиту name/email', () => {
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: null,
        candidates: CANDIDATES,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels[1]).toBe('Anna (anna@x.com)');
    expect(optionLabels[2]).toBe('zed@x.com');
  });

  it('сортирует смешанный набор named/nameless без текущего (обе стороны ?? компаратора)', () => {
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: null,
        candidates: MANY_CANDIDATES,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    // Алфавит по (name ?? email): Carl, Dana, nameless-a@x.com, nameless-b@x.com
    expect(optionLabels.slice(1)).toEqual([
      'Carl (carl@x.com)',
      'Dana (dana@x.com)',
      'nameless-a@x.com',
      'nameless-b@x.com',
    ]);
  });

  it('текущий менеджер в середине списка выходит первым (ветка b.id на 3 кандидатах)', () => {
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm3',
        candidates: THREE_CANDIDATES,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    // m3 (текущий, «Bob») первым; остальные по алфавиту (Anna, затем zed@).
    expect(optionLabels[1]).toBe('Bob (bob@x.com)');
    expect(optionLabels[2]).toBe('Anna (anna@x.com)');
    expect(optionLabels[3]).toBe('zed@x.com');
  });

  it('submit заблокирован, пока выбор совпадает с currentManagerId', () => {
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    const submit = screen.getByRole('button', { name: 'Сохранить' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('currentManagerId=null трактуется как пустая строка: выбор «» оставляет submit disabled', () => {
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: null,
        candidates: CANDIDATES,
      })
    );
    const submit = screen.getByRole('button', { name: 'Сохранить' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('успех (changed): зовёт экшен объектом {orderId, managerUserId} и показывает «Менеджер обновлён.»', async () => {
    assignOrderManagerLeaderAction.mockResolvedValue({ ok: true, changed: true });
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveProperty('textContent', 'Менеджер обновлён.')
    );
    expect(assignOrderManagerLeaderAction).toHaveBeenCalledWith({
      orderId: 'o1',
      managerUserId: 'm2',
    });
  });

  it('успех (unchanged): показывает «Без изменений.»', async () => {
    assignOrderManagerLeaderAction.mockResolvedValue({ ok: true, changed: false });
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveProperty('textContent', 'Без изменений.')
    );
  });

  it('выбор «— Без менеджера —» отправляет managerUserId: null', async () => {
    assignOrderManagerLeaderAction.mockResolvedValue({ ok: true, changed: true });
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(assignOrderManagerLeaderAction).toHaveBeenCalled());
    expect(assignOrderManagerLeaderAction).toHaveBeenCalledWith({
      orderId: 'o1',
      managerUserId: null,
    });
  });

  it('ошибка invalid_manager: центральный текст «Менеджер не найден или недоступен.»', async () => {
    assignOrderManagerLeaderAction.mockResolvedValue({ ok: false, error: 'invalid_manager' });
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'Менеджер не найден или недоступен.'
      )
    );
  });

  it('ошибка order_not_found: центральный текст «Заказ не найден.»', async () => {
    assignOrderManagerLeaderAction.mockResolvedValue({ ok: false, error: 'order_not_found' });
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Заказ не найден.')
    );
  });

  it('ошибка forbidden: локальная дельта «Нет доступа к этому заказу.» (центральный текст — про загрузку)', async () => {
    assignOrderManagerLeaderAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Нет доступа к этому заказу.')
    );
  });

  it('ошибка validation: локальная дельта «Проверьте выбор менеджера.»', async () => {
    assignOrderManagerLeaderAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Проверьте выбор менеджера.')
    );
  });

  it('busy-состояние: на кнопке «Сохраняем…» до резолва экшена', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    assignOrderManagerLeaderAction.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );
    render(
      React.createElement(LeaderAssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeTruthy());
    resolvePromise({ ok: true, changed: true });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
