// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { createDealStageAction, updateDealStageAction, deleteDealStageAction } = vi.hoisted(() => ({
  createDealStageAction: vi.fn(),
  updateDealStageAction: vi.fn(),
  deleteDealStageAction: vi.fn(),
}));
vi.mock('@/server-actions/deals', () => ({
  createDealStageAction,
  updateDealStageAction,
  deleteDealStageAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DealStageConfig } from '@/components/deals/deal-stage-config';
import type { DealStageView } from '@/lib/services/deals/stages';

const stages: DealStageView[] = [
  {
    id: 's-1',
    name: 'Первый контакт',
    position: 0,
    statusAnchor: 'open',
    isTerminal: false,
    color: null,
  },
  {
    id: 's-2',
    name: 'Победа',
    position: 1,
    statusAnchor: 'won',
    isTerminal: true,
    color: '#22C55E',
  },
  {
    id: 's-3',
    name: 'Поражение',
    position: 2,
    statusAnchor: 'lost',
    isTerminal: true,
    color: null,
  },
];

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('DealStageConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  describe('listing', () => {
    it('renders the stage rows with positions, anchor labels and the terminal flag', () => {
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      expect(screen.getByText('Стадии сделок')).toBeTruthy();

      const row1 = rowOf('Первый контакт');
      expect(within(row1).getByText('0')).toBeTruthy();
      expect(within(row1).getByText('В работе')).toBeTruthy(); // якорь open → подпись
      expect(within(row1).getByText('—')).toBeTruthy(); // не терминальная

      const row2 = rowOf('Победа');
      expect(within(row2).getByText('Выиграна')).toBeTruthy();
      expect(within(row2).getByText('Да')).toBeTruthy();

      const row3 = rowOf('Поражение');
      expect(within(row3).getByText('Проиграна')).toBeTruthy();
    });

    it('незнакомый якорь показывается как есть, без пустой ячейки', () => {
      // Якоря когда-нибудь расширят. Таблица обязана показать сырое значение,
      // а не пустоту — иначе настройщик не поймёт, что за стадия перед ним.
      const withUnknown: DealStageView[] = [
        {
          id: 's-x',
          name: 'Заморожена',
          position: 3,
          statusAnchor: 'on_hold' as never,
          isTerminal: false,
          color: null,
        },
      ];
      render(React.createElement(DealStageConfig, { stages: withUnknown, isDefault: false }));
      expect(within(rowOf('Заморожена')).getByText('on_hold')).toBeTruthy();
    });

    it('custom stages: shows edit/delete buttons per row', () => {
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      expect(screen.getAllByRole('button', { name: 'Изменить' })).toHaveLength(3);
      expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(3);
      expect(screen.queryByText('по умолчанию')).toBeNull();
    });

    it('default stages: shows the "по умолчанию" hint instead of the action buttons', () => {
      render(React.createElement(DealStageConfig, { stages, isDefault: true }));
      expect(screen.getAllByText('по умолчанию')).toHaveLength(3);
      expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
      expect(screen.getByText(/Сейчас используются стадии по умолчанию/)).toBeTruthy();
    });
  });

  describe('create', () => {
    it('opens the "Новая стадия" dialog with anchor options and submits createDealStageAction', async () => {
      createDealStageAction.mockResolvedValue({ ok: true, id: 's-new' });
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      fireEvent.click(screen.getByRole('button', { name: '+ Стадия' }));
      expect(await screen.findByText('Новая стадия')).toBeTruthy();

      // Якоря-подписи в селекте
      const anchor = screen.getByLabelText(
        'Якорь статуса (переход lifecycle)'
      ) as HTMLSelectElement;
      const labels = Array.from(anchor.options).map((o) => o.textContent);
      expect(labels).toEqual(['В работе', 'Выиграна', 'Проиграна']);
      expect(anchor.value).toBe('open');

      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Переговоры' } });
      fireEvent.change(screen.getByLabelText('Позиция (порядок колонки)'), {
        target: { value: '5' },
      });
      fireEvent.change(anchor, { target: { value: 'won' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

      await waitFor(() => expect(createDealStageAction).toHaveBeenCalledTimes(1));
      const fd = createDealStageAction.mock.calls[0][0] as FormData;
      expect(fd.get('name')).toBe('Переговоры');
      expect(fd.get('position')).toBe('5');
      expect(fd.get('statusAnchor')).toBe('won');
      expect(fd.get('id')).toBeNull();
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Стадия создана.'));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('position_taken → russian toast error, no refresh', async () => {
      createDealStageAction.mockResolvedValue({ ok: false, error: 'position_taken' });
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      fireEvent.click(screen.getByRole('button', { name: '+ Стадия' }));
      await screen.findByText('Новая стадия');

      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Дубль' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('Позиция уже занята другим этапом.')
      );
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe('edit', () => {
    it('opens the pre-filled "Изменить стадию" dialog and submits updateDealStageAction with the id', async () => {
      updateDealStageAction.mockResolvedValue({ ok: true });
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      fireEvent.click(within(rowOf('Победа')).getByRole('button', { name: 'Изменить' }));
      expect(await screen.findByText('Изменить стадию')).toBeTruthy();

      expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe('Победа');
      expect((screen.getByLabelText('Позиция (порядок колонки)') as HTMLInputElement).value).toBe(
        '1'
      );
      expect(
        (screen.getByLabelText('Якорь статуса (переход lifecycle)') as HTMLSelectElement).value
      ).toBe('won');
      const terminal = document.querySelector('input[name="isTerminal"]') as HTMLInputElement;
      expect(terminal.checked).toBe(true);

      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Победа!' } });
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(updateDealStageAction).toHaveBeenCalledTimes(1));
      const fd = updateDealStageAction.mock.calls[0][0] as FormData;
      expect(fd.get('id')).toBe('s-2');
      expect(fd.get('name')).toBe('Победа!');
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Стадия обновлена.'));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('«Отмена» в диалоге закрывает его без сохранения', () => {
      // У диалога две точки закрытия: сохранение и отказ. Отказ обязан вернуть
      // экран в исходное состояние, иначе повторно открыть его не получится.
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      fireEvent.click(within(rowOf('Победа')).getByRole('button', { name: 'Изменить' }));
      expect(screen.getByText('Изменить стадию')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

      expect(screen.queryByText('Изменить стадию')).toBeNull();
      expect(updateDealStageAction).not.toHaveBeenCalled();
    });

    it('edit error → mapped russian toast, dialog stays without onSaved refresh', async () => {
      updateDealStageAction.mockResolvedValue({ ok: false, error: 'position_taken' });
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      fireEvent.click(within(rowOf('Первый контакт')).getByRole('button', { name: 'Изменить' }));
      await screen.findByText('Изменить стадию');

      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('Позиция уже занята другим этапом.')
      );
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('calls deleteDealStageAction with the stage id, toasts success and refreshes', async () => {
      deleteDealStageAction.mockResolvedValue({ ok: true });
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      fireEvent.click(within(rowOf('Поражение')).getByRole('button', { name: 'Удалить' }));

      await waitFor(() => expect(deleteDealStageAction).toHaveBeenCalledTimes(1));
      const fd = deleteDealStageAction.mock.calls[0][0] as FormData;
      expect(fd.get('id')).toBe('s-3');
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Стадия удалена.'));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('delete error → mapped russian toast, no refresh', async () => {
      deleteDealStageAction.mockResolvedValue({ ok: false, error: 'forbidden' });
      render(React.createElement(DealStageConfig, { stages, isDefault: false }));
      fireEvent.click(within(rowOf('Первый контакт')).getByRole('button', { name: 'Удалить' }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
