// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { moveFunnelLeadAction } = vi.hoisted(() => ({ moveFunnelLeadAction: vi.fn() }));
vi.mock('@/server-actions/funnel', () => ({ moveFunnelLeadAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { FunnelBoard } from '@/components/funnel/funnel-board';
import type { FunnelBoard as FunnelBoardData } from '@/lib/services/funnel/board';

const board: FunnelBoardData = {
  stages: [],
  columns: [
    {
      stage: {
        id: 'stage-new',
        name: 'Новый лид',
        position: 0,
        statusAnchor: 'new',
        isTerminal: false,
        color: null,
      },
      cards: [
        {
          id: 'lead-1',
          clientCompanyName: 'ООО Ромашка',
          subject: 'Обучение по ОТ',
          estimatedAmount: '5000',
          organizationName: null,
          assignedManagerName: 'Иван',
          createdAt: new Date('2026-01-01'),
        },
      ],
    },
    {
      stage: {
        id: 'stage-review',
        name: 'В работе',
        position: 1,
        statusAnchor: 'in_review',
        isTerminal: false,
        color: null,
      },
      cards: [],
    },
  ],
};

function dataTransfer(id: string) {
  const store: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      store[type] = value;
      if (id) store['text/plain'] = id;
    },
    getData: (type: string) => store[type] ?? id,
  };
}

describe('FunnelBoard', () => {
  beforeEach(() => {
    refresh.mockClear();
    moveFunnelLeadAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('renders columns with card counts, card fields, and the empty-column placeholder', () => {
    render(React.createElement(FunnelBoard, { board }));
    expect(screen.getByText('Новый лид')).toBeTruthy();
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    expect(screen.getByText('Обучение по ОТ')).toBeTruthy();
    expect(screen.getByText('5000 ₽')).toBeTruthy();
    expect(screen.getByText('Иван')).toBeTruthy();
    expect(screen.getByText('Пусто')).toBeTruthy();
  });

  it('renders a color strip on EVERY column (stable layout): stage color when set, transparent placeholder otherwise', () => {
    const colored: FunnelBoardData = {
      stages: [],
      columns: [
        { stage: { ...board.columns[0].stage, color: '#22C55E' }, cards: [] },
        { stage: board.columns[1].stage, cards: [] }, // color: null → transparent placeholder
      ],
    };
    render(React.createElement(FunnelBoard, { board: colored }));
    const strips = screen.getAllByTestId('stage-color-strip');
    expect(strips).toHaveLength(2); // placeholder всегда — заголовки колонок не «прыгают»
    // jsdom normalizes background values; compare against the same serialization.
    const probe = document.createElement('div');
    probe.style.background = '#22C55E';
    expect(strips[0].getAttribute('style')).toBe(probe.getAttribute('style'));
    probe.style.background = 'transparent';
    expect(strips[1].getAttribute('style')).toBe(probe.getAttribute('style'));
    expect(strips.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('renders "—" for a null estimatedAmount and "без менеджера" for a null assignedManagerName', () => {
    const b: FunnelBoardData = {
      stages: [],
      columns: [
        {
          stage: board.columns[0].stage,
          cards: [
            { ...board.columns[0].cards[0], estimatedAmount: null, assignedManagerName: null },
          ],
        },
      ],
    };
    render(React.createElement(FunnelBoard, { board: b }));
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('без менеджера')).toBeTruthy();
  });

  it('drag over a column highlights it, drag leave un-highlights it', () => {
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    fireEvent.dragOver(column, { dataTransfer: dataTransfer('') });
    expect(column.className).toContain('ring-2');
    fireEvent.dragLeave(column);
    expect(column.className).not.toContain('ring-2');
  });

  it('dragging a card sets its id on the dataTransfer (onDragStart)', () => {
    render(React.createElement(FunnelBoard, { board }));
    const card = screen.getByText('ООО Ромашка').closest('article') as HTMLElement;
    const dt = dataTransfer('');
    const setDataSpy = vi.spyOn(dt, 'setData');
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(setDataSpy).toHaveBeenCalledWith('text/plain', 'lead-1');
  });

  it('closing the reason dialog via the "×" button (Dialog onClose) clears it without resubmitting', async () => {
    moveFunnelLeadAction.mockResolvedValue({ ok: false, error: 'reason_required' });
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('lead-1') });
    await screen.findByText('Причина отказа');

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    await waitFor(() => expect(dialogEl.hasAttribute('open')).toBe(false));
    expect(moveFunnelLeadAction).toHaveBeenCalledTimes(1);
  });

  it('drag-leaving a column that is not the currently-highlighted one leaves the highlight untouched', () => {
    render(React.createElement(FunnelBoard, { board }));
    const firstColumn = screen.getByText('Новый лид').closest('div')!.parentElement as HTMLElement;
    const secondColumn = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;

    fireEvent.dragOver(firstColumn, { dataTransfer: dataTransfer('') });
    expect(firstColumn.className).toContain('ring-2');

    // Leaving the second (non-highlighted) column must not clear the first's highlight
    fireEvent.dragLeave(secondColumn);
    expect(firstColumn.className).toContain('ring-2');
  });

  it('dropping a card with no dragged id (empty text/plain) does not call the move action', () => {
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    const dt = { setData: () => {}, getData: () => '' };
    fireEvent.drop(column, { dataTransfer: dt });
    expect(moveFunnelLeadAction).not.toHaveBeenCalled();
  });

  it('drop success: calls moveFunnelLeadAction with leadId/toStageId, toasts success, refreshes', async () => {
    moveFunnelLeadAction.mockResolvedValue({ ok: true });
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('lead-1') });

    await waitFor(() => expect(moveFunnelLeadAction).toHaveBeenCalledTimes(1));
    const fd = moveFunnelLeadAction.mock.calls[0][0] as FormData;
    expect(fd.get('leadId')).toBe('lead-1');
    expect(fd.get('toStageId')).toBe('stage-review');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Карточка перемещена.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('drop error (reason_required): opens the reason dialog instead of toasting', async () => {
    moveFunnelLeadAction.mockResolvedValue({ ok: false, error: 'reason_required' });
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('lead-1') });

    expect(await screen.findByText('Причина отказа')).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('drop error (known code): toasts the mapped MOVE_ERRORS message', async () => {
    moveFunnelLeadAction.mockResolvedValue({ ok: false, error: 'invalid_stage' });
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('lead-1') });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Неизвестная стадия.'));
  });

  it('drop error (unmapped code): falls back to the generic message', async () => {
    moveFunnelLeadAction.mockResolvedValue({ ok: false, error: 'weird_code' });
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('lead-1') });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось переместить карточку.')
    );
  });

  it('reason dialog: submitting with a reason resubmits the move including the reason, then closes', async () => {
    moveFunnelLeadAction
      .mockResolvedValueOnce({ ok: false, error: 'reason_required' })
      .mockResolvedValueOnce({ ok: true });
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('lead-1') });
    await screen.findByText('Причина отказа');

    const input = screen.getByPlaceholderText('Укажите причину отказа');
    fireEvent.change(input, { target: { value: 'Клиент отказался' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    await waitFor(() => expect(moveFunnelLeadAction).toHaveBeenCalledTimes(2));
    const fd = moveFunnelLeadAction.mock.calls[1][0] as FormData;
    expect(fd.get('reason')).toBe('Клиент отказался');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Карточка перемещена.'));
  });

  it('reason dialog: cancel button closes without resubmitting', async () => {
    moveFunnelLeadAction.mockResolvedValue({ ok: false, error: 'reason_required' });
    render(React.createElement(FunnelBoard, { board }));
    const column = screen.getByText('В работе').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('lead-1') });
    await screen.findByText('Причина отказа');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    await waitFor(() => expect(dialogEl.hasAttribute('open')).toBe(false));
    expect(moveFunnelLeadAction).toHaveBeenCalledTimes(1);
  });
});
