// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const {
  moveDealAction,
  createDealAction,
  updateDealAction,
  winDealAction,
  addDealNoteAction,
  listDealNotesAction,
} = vi.hoisted(() => ({
  moveDealAction: vi.fn(),
  createDealAction: vi.fn(),
  updateDealAction: vi.fn(),
  winDealAction: vi.fn(),
  addDealNoteAction: vi.fn(),
  listDealNotesAction: vi.fn(),
}));
vi.mock('@/server-actions/deals', () => ({
  moveDealAction,
  createDealAction,
  updateDealAction,
  winDealAction,
  addDealNoteAction,
  listDealNotesAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DealBoard } from '@/components/deals/deal-board';
import type { DealBoard as DealBoardData, DealCard } from '@/lib/services/deals/board';

const cardOpen: DealCard = {
  id: 'deal-1',
  title: 'Сделка Ромашка',
  amount: '100.00',
  organizationId: 'org-1',
  organizationName: 'ООО Ромашка',
  managerId: 'm-1',
  managerName: 'Иван',
  status: 'open',
  orderId: null,
  expectedCloseAt: new Date('2026-08-15'),
  createdAt: new Date('2026-01-01'),
};

const cardNoAmount: DealCard = {
  id: 'deal-2',
  title: 'Сделка Лютик',
  amount: '250.00',
  organizationId: null,
  organizationName: null,
  managerId: null,
  managerName: null,
  status: 'open',
  orderId: null,
  expectedCloseAt: null,
  createdAt: new Date('2026-02-01'),
};

const cardWon: DealCard = {
  id: 'deal-won',
  title: 'Выигранная сделка',
  amount: null,
  organizationId: null,
  organizationName: null,
  managerId: 'm-1',
  managerName: 'Иван',
  status: 'won',
  orderId: 'order-77',
  expectedCloseAt: null,
  createdAt: new Date('2026-03-01'),
};

const stNew = {
  id: 'st-new',
  name: 'Новая',
  position: 0,
  statusAnchor: 'open' as const,
  isTerminal: false,
  color: null,
};
const stWork = {
  id: 'st-work',
  name: 'В работе',
  position: 1,
  statusAnchor: 'open' as const,
  isTerminal: false,
  color: null,
};
const stWon = {
  id: 'st-won',
  name: 'Выиграна',
  position: 2,
  statusAnchor: 'won' as const,
  isTerminal: true,
  color: null,
};
const stLost = {
  id: 'st-lost',
  name: 'Проиграна',
  position: 3,
  statusAnchor: 'lost' as const,
  isTerminal: true,
  color: null,
};

const board: DealBoardData = {
  stages: [stNew, stWork, stWon, stLost],
  columns: [
    { stage: stNew, cards: [cardOpen, cardNoAmount] },
    { stage: stWork, cards: [] },
    { stage: stWon, cards: [cardWon] },
    { stage: stLost, cards: [] },
  ],
};

const organizations = [{ id: 'org-1', name: 'ООО Ромашка' }];
const managers = [
  { id: 'm-1', name: 'Иван' },
  { id: 'u-me', name: 'Я Сам' },
];

function dataTransfer(id: string) {
  const store: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? id,
  };
}

function columnOf(stageName: string): HTMLElement {
  return screen.getByText(stageName).closest('div')!.parentElement as HTMLElement;
}

function dialogOf(text: string): HTMLDialogElement {
  return screen.getByText(text).closest('dialog') as HTMLDialogElement;
}

describe('DealBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Диалог редактирования лениво грузит заметки (PR-2) — пустой список по умолчанию.
    listDealNotesAction.mockResolvedValue({ ok: true, rows: [] });
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  describe('rendering', () => {
    it('renders column names, card counters, column amount sums and the empty placeholder', () => {
      render(React.createElement(DealBoard, { board }));
      expect(screen.getByText('Новая')).toBeTruthy();
      expect(screen.getByText('В работе')).toBeTruthy();
      expect(screen.getByText('Выиграна')).toBeTruthy();
      expect(screen.getByText('Проиграна')).toBeTruthy();
      // Счётчики: 2 карточки в первой, 0 в пустых, 1 в won
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getAllByText('0')).toHaveLength(2);
      expect(screen.getByText('1')).toBeTruthy();
      // Сумма колонки: 100 + 250 = 350 ₽
      expect(screen.getByText('350 ₽')).toBeTruthy();
      // Пустые колонки («В работе» и «Проиграна»)
      expect(screen.getAllByText('Пусто')).toHaveLength(2);
    });

    it('renders card fields: title, org name, amount, manager, and null-fallbacks', () => {
      render(React.createElement(DealBoard, { board }));
      expect(screen.getByText('Сделка Ромашка')).toBeTruthy();
      expect(screen.getByText('ООО Ромашка')).toBeTruthy();
      expect(screen.getByText('100 ₽')).toBeTruthy();
      expect(screen.getByText('250 ₽')).toBeTruthy();
      expect(screen.getAllByText('Иван').length).toBeGreaterThan(0);
      // null managerName → «без ответственного»
      expect(screen.getByText('без ответственного')).toBeTruthy();
      // null amount у карточки won и у колонок без сумм → «—»
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
  });

  describe('dnd: drop on an open stage', () => {
    it('calls moveDealAction with dealId/toStageId, toasts success and refreshes', async () => {
      moveDealAction.mockResolvedValue({ ok: true });
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('В работе'), { dataTransfer: dataTransfer('deal-1') });

      await waitFor(() => expect(moveDealAction).toHaveBeenCalledTimes(1));
      const fd = moveDealAction.mock.calls[0][0] as FormData;
      expect(fd.get('dealId')).toBe('deal-1');
      expect(fd.get('toStageId')).toBe('st-work');
      expect(fd.get('lostReason')).toBeNull();
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Карточка перемещена.'));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('dragging a card sets its id on the dataTransfer (onDragStart)', () => {
      render(React.createElement(DealBoard, { board }));
      const card = screen.getByText('Сделка Ромашка').closest('article') as HTMLElement;
      const dt = dataTransfer('');
      const spy = vi.spyOn(dt, 'setData');
      fireEvent.dragStart(card, { dataTransfer: dt });
      expect(spy).toHaveBeenCalledWith('text/plain', 'deal-1');
    });

    it('dragOver подсвечивает колонку, dragLeave снимает подсветку', () => {
      // Подсветка колонки — единственный сигнал «сюда можно бросить карточку».
      render(React.createElement(DealBoard, { board }));
      const target = columnOf('В работе');

      fireEvent.dragOver(target);
      expect(target.className).toContain('ring-2');

      fireEvent.dragLeave(target);
      expect(target.className).not.toContain('ring-2');

      // dragLeave чужой колонки не сбивает подсветку текущей.
      fireEvent.dragOver(target);
      fireEvent.dragLeave(columnOf('Новая'));
      expect(target.className).toContain('ring-2');
    });

    it('карточка с нечисловой суммой не ломает сумму колонки', () => {
      // Суммы приходят строками; мусор в одной карточке не должен превращать
      // итог колонки в NaN на экране.
      const dirty: DealBoardData = {
        ...board,
        columns: [
          { stage: stNew, cards: [cardOpen, { ...cardOpen, id: 'd-bad', amount: 'мусор' }] },
          ...board.columns.slice(1),
        ],
      };
      render(React.createElement(DealBoard, { board: dirty }));
      expect(document.body.textContent).not.toContain('NaN');
    });

    it('drop with an empty dragged id does not call the action', () => {
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('В работе'), { dataTransfer: dataTransfer('') });
      expect(moveDealAction).not.toHaveBeenCalled();
    });
  });

  describe('dnd: drop on the lost stage', () => {
    it('opens the reason dialog without calling the action yet', () => {
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('Проиграна'), { dataTransfer: dataTransfer('deal-1') });
      expect(dialogOf('Причина проигрыша').hasAttribute('open')).toBe(true);
      expect(moveDealAction).not.toHaveBeenCalled();
    });

    it('submitting an empty reason does not call the action (required input)', () => {
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('Проиграна'), { dataTransfer: dataTransfer('deal-1') });
      const input = screen.getByPlaceholderText('Укажите причину проигрыша') as HTMLInputElement;
      expect(input.required).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Отметить проигранной' }));
      expect(moveDealAction).not.toHaveBeenCalled();
    });

    it('submitting with a reason calls the action with lostReason and closes the dialog', async () => {
      moveDealAction.mockResolvedValue({ ok: true });
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('Проиграна'), { dataTransfer: dataTransfer('deal-1') });

      fireEvent.change(screen.getByPlaceholderText('Укажите причину проигрыша'), {
        target: { value: 'Клиент отказался' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Отметить проигранной' }));

      await waitFor(() => expect(moveDealAction).toHaveBeenCalledTimes(1));
      const fd = moveDealAction.mock.calls[0][0] as FormData;
      expect(fd.get('dealId')).toBe('deal-1');
      expect(fd.get('toStageId')).toBe('st-lost');
      expect(fd.get('lostReason')).toBe('Клиент отказался');
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Карточка перемещена.'));
      await waitFor(() => expect(dialogOf('Причина проигрыша').hasAttribute('open')).toBe(false));
    });

    it('Escape закрывает диалог причины/подтверждения/редактирования (onClose)', async () => {
      // У каждой кнопки закрытия свой обработчик, а Escape идёт через onClose
      // самого диалога — это отдельные точки, обе должны работать.
      render(
        React.createElement(DealBoard, { board, organizations, managers, currentUserId: 'u-me' })
      );

      // Диалог причины проигрыша.
      fireEvent.drop(columnOf('Проиграна'), { dataTransfer: dataTransfer('d-open') });
      const lost = dialogOf('Причина проигрыша');
      fireEvent(lost, new Event('cancel', { bubbles: false, cancelable: true }));
      await waitFor(() => expect(lost.hasAttribute('open')).toBe(false));

      // Подтверждение выигрыша.
      fireEvent.drop(columnOf('Выиграна'), { dataTransfer: dataTransfer('d-open') });
      const won = dialogOf('Отметить сделку выигранной?');
      fireEvent(won, new Event('cancel', { bubbles: false, cancelable: true }));
      await waitFor(() => expect(won.hasAttribute('open')).toBe(false));

      // Редактирование карточки.
      fireEvent.click(screen.getByText('Сделка Ромашка'));
      const edit = dialogOf('Сделка');
      fireEvent(edit, new Event('cancel', { bubbles: false, cancelable: true }));
      await waitFor(() => expect(edit.hasAttribute('open')).toBe(false));
      expect(moveDealAction).not.toHaveBeenCalled();
    });

    it('cancel closes the reason dialog without calling the action', async () => {
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('Проиграна'), { dataTransfer: dataTransfer('deal-1') });
      fireEvent.click(
        within(dialogOf('Причина проигрыша')).getByRole('button', { name: 'Отмена' })
      );
      await waitFor(() => expect(dialogOf('Причина проигрыша').hasAttribute('open')).toBe(false));
      expect(moveDealAction).not.toHaveBeenCalled();
    });
  });

  describe('dnd: drop on the won stage (PR-2: winDealAction создаёт заказ)', () => {
    it('opens the confirmation dialog; confirm calls winDealAction, toasts a link to the order and refreshes', async () => {
      winDealAction.mockResolvedValue({ ok: true, orderId: 'order-9' });
      render(React.createElement(DealBoard, { board }));

      fireEvent.drop(columnOf('Выиграна'), { dataTransfer: dataTransfer('deal-1') });
      const dlg = dialogOf('Отметить сделку выигранной?');
      expect(dlg.hasAttribute('open')).toBe(true);
      expect(screen.getByText('Из выигранной сделки сразу будет создан заказ.')).toBeTruthy();
      expect(winDealAction).not.toHaveBeenCalled();
      expect(moveDealAction).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Выиграна — создать заказ' }));
      await waitFor(() => expect(winDealAction).toHaveBeenCalledTimes(1));
      const fd = winDealAction.mock.calls[0][0] as FormData;
      expect(fd.get('dealId')).toBe('deal-1');
      expect(fd.get('toStageId')).toBe('st-won');
      expect(moveDealAction).not.toHaveBeenCalled();

      // Тост — JSX со ссылкой на созданный заказ.
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
      const { container } = render(React.createElement('div', null, toastSuccess.mock.calls[0][0]));
      const link = container.querySelector('a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/manager/orders/order-9');
      expect(container.textContent).toContain('заказ создан');

      await waitFor(() => expect(dlg.hasAttribute('open')).toBe(false));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('org_required keeps the dialog open and shows the russian message inline (no toast)', async () => {
      winDealAction.mockResolvedValue({ ok: false, error: 'org_required' });
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('Выиграна'), { dataTransfer: dataTransfer('deal-1') });

      fireEvent.click(screen.getByRole('button', { name: 'Выиграна — создать заказ' }));
      await waitFor(() => expect(winDealAction).toHaveBeenCalledTimes(1));

      const dlg = dialogOf('Отметить сделку выигранной?');
      await waitFor(() =>
        expect(
          within(dlg).getByText(
            'У сделки не указана организация — откройте сделку и привяжите организацию.'
          )
        ).toBeTruthy()
      );
      expect(dlg.hasAttribute('open')).toBe(true);
      expect(toastError).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it.each([
      ['not_found', 'Сделка не найдена или недоступна.'],
      ['lifecycle_violation', 'Такой переход недопустим: сделка уже завершена.'],
      ['forbidden', 'Нет доступа.'],
    ])('error %s → closes the dialog and toasts "%s"', async (code, message) => {
      winDealAction.mockResolvedValue({ ok: false, error: code });
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('Выиграна'), { dataTransfer: dataTransfer('deal-1') });

      fireEvent.click(screen.getByRole('button', { name: 'Выиграна — создать заказ' }));
      await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
      await waitFor(() =>
        expect(dialogOf('Отметить сделку выигранной?').hasAttribute('open')).toBe(false)
      );
      expect(refresh).not.toHaveBeenCalled();
    });

    it('unmapped error code falls back to the generic win message', async () => {
      winDealAction.mockResolvedValue({ ok: false, error: 'weird_code' });
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('Выиграна'), { dataTransfer: dataTransfer('deal-1') });

      fireEvent.click(screen.getByRole('button', { name: 'Выиграна — создать заказ' }));
      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось создать заказ.'));
    });

    it('cancel closes the won dialog without calling the action', async () => {
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('Выиграна'), { dataTransfer: dataTransfer('deal-1') });
      const dlg = dialogOf('Отметить сделку выигранной?');
      expect(dlg.hasAttribute('open')).toBe(true);
      fireEvent.click(within(dlg).getByRole('button', { name: 'Отмена' }));
      await waitFor(() => expect(dlg.hasAttribute('open')).toBe(false));
      expect(winDealAction).not.toHaveBeenCalled();
      expect(moveDealAction).not.toHaveBeenCalled();
    });
  });

  describe('move errors', () => {
    it.each([
      ['not_found', 'Сделка не найдена или недоступна.'],
      ['invalid_stage', 'Неизвестная стадия.'],
      ['lifecycle_violation', 'Такой переход недопустим: сделка уже завершена.'],
      ['forbidden', 'Нет доступа.'],
    ])('error %s → russian toast "%s"', async (code, message) => {
      moveDealAction.mockResolvedValue({ ok: false, error: code });
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('В работе'), { dataTransfer: dataTransfer('deal-1') });
      await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
      expect(refresh).not.toHaveBeenCalled();
    });

    it('error reason_required → opens the reason dialog instead of toasting (5th code)', async () => {
      moveDealAction.mockResolvedValue({ ok: false, error: 'reason_required' });
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('В работе'), { dataTransfer: dataTransfer('deal-1') });
      await waitFor(() => expect(dialogOf('Причина проигрыша').hasAttribute('open')).toBe(true));
      expect(toastError).not.toHaveBeenCalled();
    });

    it('unmapped error code falls back to the generic message', async () => {
      moveDealAction.mockResolvedValue({ ok: false, error: 'weird_code' });
      render(React.createElement(DealBoard, { board }));
      fireEvent.drop(columnOf('В работе'), { dataTransfer: dataTransfer('deal-1') });
      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('Не удалось переместить карточку.')
      );
    });
  });

  describe('card click → edit dialog', () => {
    const editProps = { board, organizations, managers, currentUserId: 'u-me' };

    it('clicking an open card opens the edit dialog with the title pre-filled', async () => {
      render(React.createElement(DealBoard, editProps));
      fireEvent.click(screen.getByText('Сделка Ромашка').closest('article') as HTMLElement);
      expect(await screen.findByText('Сделка')).toBeTruthy();
      const title = screen.getByLabelText('Название') as HTMLInputElement;
      expect(title.value).toBe('Сделка Ромашка');
    });

    it('clicking a completed (won) card does not open the dialog', () => {
      render(React.createElement(DealBoard, editProps));
      fireEvent.click(screen.getByText('Выигранная сделка').closest('article') as HTMLElement);
      expect(screen.queryByLabelText('Название')).toBeNull();
    });

    it('without organizations/managers/currentUserId props a card click does nothing', () => {
      render(React.createElement(DealBoard, { board }));
      fireEvent.click(screen.getByText('Сделка Ромашка').closest('article') as HTMLElement);
      expect(screen.queryByLabelText('Название')).toBeNull();
    });

    it('saving from the edit dialog closes it and refreshes the router', async () => {
      updateDealAction.mockResolvedValue({ ok: true });
      render(React.createElement(DealBoard, editProps));
      fireEvent.click(screen.getByText('Сделка Ромашка').closest('article') as HTMLElement);
      await screen.findByText('Сделка');

      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
      await waitFor(() => expect(updateDealAction).toHaveBeenCalledTimes(1));
      const fd = updateDealAction.mock.calls[0][0] as FormData;
      expect(fd.get('id')).toBe('deal-1');
      await waitFor(() => expect(screen.queryByLabelText('Название')).toBeNull());
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });
  });
});
