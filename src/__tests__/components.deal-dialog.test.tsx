// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { createDealAction, updateDealAction } = vi.hoisted(() => ({
  createDealAction: vi.fn(),
  updateDealAction: vi.fn()
}));
vi.mock('@/server-actions/deals', () => ({ createDealAction, updateDealAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DealDialog, NewDealButton, type DealDialogTarget } from '@/components/deals/deal-dialog';

const organizations = [{ id: 'org-1', name: 'ООО Ромашка' }];
const managers = [
  { id: 'u-me', name: 'Я Сам' },
  { id: 'm-2', name: 'Пётр' }
];

const target: DealDialogTarget = {
  id: 'deal-1',
  title: 'Сделка Ромашка',
  amount: '150.50',
  organizationId: 'org-1',
  managerId: 'm-2',
  expectedCloseAt: new Date('2026-08-15T00:00:00.000Z')
};

function renderCreate(overrides: Partial<React.ComponentProps<typeof DealDialog>> = {}) {
  return render(
    React.createElement(DealDialog, {
      target: null,
      organizations,
      managers,
      currentUserId: 'u-me',
      onClose,
      onSaved,
      ...overrides
    })
  );
}

const onClose = vi.fn();
const onSaved = vi.fn();

describe('DealDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  describe('create mode', () => {
    it('shows "Новая сделка", empty title, and defaults the manager to currentUserId', async () => {
      renderCreate();
      expect(await screen.findByText('Новая сделка')).toBeTruthy();
      expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('Ответственный') as HTMLSelectElement).value).toBe('u-me');
      expect((screen.getByLabelText('Организация (необязательно)') as HTMLSelectElement).value).toBe('');
    });

    it('submit calls createDealAction with title/amount/expectedCloseAt/organizationId/managerId', async () => {
      createDealAction.mockResolvedValue({ ok: true, id: 'new-deal' });
      renderCreate();
      await screen.findByText('Новая сделка');

      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новая продажа' } });
      fireEvent.change(screen.getByLabelText('Сумма, ₽'), { target: { value: '999.99' } });
      fireEvent.change(screen.getByLabelText('Ожидаемое закрытие'), { target: { value: '2026-09-01' } });
      fireEvent.change(screen.getByLabelText('Организация (необязательно)'), { target: { value: 'org-1' } });
      fireEvent.change(screen.getByLabelText('Ответственный'), { target: { value: 'm-2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

      await waitFor(() => expect(createDealAction).toHaveBeenCalledTimes(1));
      const fd = createDealAction.mock.calls[0][0] as FormData;
      expect(fd.get('title')).toBe('Новая продажа');
      expect(fd.get('amount')).toBe('999.99');
      expect(fd.get('expectedCloseAt')).toBe('2026-09-01');
      expect(fd.get('organizationId')).toBe('org-1');
      expect(fd.get('managerId')).toBe('m-2');
      expect(fd.get('id')).toBeNull();
      expect(updateDealAction).not.toHaveBeenCalled();
    });

    it('submit without touching the manager select sends currentUserId as managerId', async () => {
      createDealAction.mockResolvedValue({ ok: true, id: 'new-deal' });
      renderCreate();
      await screen.findByText('Новая сделка');
      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

      await waitFor(() => expect(createDealAction).toHaveBeenCalledTimes(1));
      const fd = createDealAction.mock.calls[0][0] as FormData;
      expect(fd.get('managerId')).toBe('u-me');
    });

    it('success: toasts "Сделка создана." and calls onSaved', async () => {
      createDealAction.mockResolvedValue({ ok: true, id: 'new-deal' });
      renderCreate();
      await screen.findByText('Новая сделка');
      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Сделка создана.'));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });

    it('validation error: shows the service messages as a role="alert" list, no toast', async () => {
      createDealAction.mockResolvedValue({
        ok: false,
        error: 'validation',
        messages: ['Укажите название сделки', 'Сумма — число, до двух знаков после запятой']
      });
      renderCreate();
      await screen.findByText('Новая сделка');
      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

      const item = await screen.findByText('Укажите название сделки');
      expect(item.closest('ul')?.getAttribute('role')).toBe('alert');
      expect(screen.getByText('Сумма — число, до двух знаков после запятой')).toBeTruthy();
      expect(toastError).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('non-validation error: toasts the mapped russian message, keeps the dialog', async () => {
      createDealAction.mockResolvedValue({ ok: false, error: 'forbidden' });
      renderCreate();
      await screen.findByText('Новая сделка');
      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('unmapped error code falls back to "Не удалось сохранить сделку."', async () => {
      createDealAction.mockResolvedValue({ ok: false, error: 'weird_code' });
      renderCreate();
      await screen.findByText('Новая сделка');
      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось сохранить сделку.'));
    });

    it('cancel button calls onClose without submitting', async () => {
      renderCreate();
      await screen.findByText('Новая сделка');
      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(createDealAction).not.toHaveBeenCalled();
    });
  });

  describe('edit mode (target)', () => {
    it('shows "Сделка" and pre-fills all fields from the target', async () => {
      renderCreate({ target });
      expect(await screen.findByText('Сделка')).toBeTruthy();
      expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe('Сделка Ромашка');
      expect((screen.getByLabelText('Сумма, ₽') as HTMLInputElement).value).toBe('150.50');
      expect((screen.getByLabelText('Ожидаемое закрытие') as HTMLInputElement).value).toBe('2026-08-15');
      expect((screen.getByLabelText('Организация (необязательно)') as HTMLSelectElement).value).toBe('org-1');
      expect((screen.getByLabelText('Ответственный') as HTMLSelectElement).value).toBe('m-2');
    });

    it('submit calls updateDealAction with the target id and toasts "Сделка обновлена."', async () => {
      updateDealAction.mockResolvedValue({ ok: true });
      renderCreate({ target });
      await screen.findByText('Сделка');
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(updateDealAction).toHaveBeenCalledTimes(1));
      const fd = updateDealAction.mock.calls[0][0] as FormData;
      expect(fd.get('id')).toBe('deal-1');
      expect(fd.get('title')).toBe('Сделка Ромашка');
      expect(createDealAction).not.toHaveBeenCalled();
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Сделка обновлена.'));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });
  });

  describe('NewDealButton', () => {
    it('opens the create dialog on click and closes it on cancel', async () => {
      render(React.createElement(NewDealButton, { organizations, managers, currentUserId: 'u-me' }));
      expect(screen.queryByText('Новая сделка')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '+ Сделка' }));
      expect(await screen.findByText('Новая сделка')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
      await waitFor(() => expect(screen.queryByText('Новая сделка')).toBeNull());
    });

    it('closes the dialog and refreshes the router after a successful save', async () => {
      createDealAction.mockResolvedValue({ ok: true, id: 'new-deal' });
      render(React.createElement(NewDealButton, { organizations, managers, currentUserId: 'u-me' }));
      fireEvent.click(screen.getByRole('button', { name: '+ Сделка' }));
      const dlg = (await screen.findByText('Новая сделка')).closest('dialog') as HTMLElement;

      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Через кнопку' } });
      fireEvent.click(within(dlg).getByRole('button', { name: 'Создать' }));

      await waitFor(() => expect(createDealAction).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByText('Новая сделка')).toBeNull());
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });
  });
});
