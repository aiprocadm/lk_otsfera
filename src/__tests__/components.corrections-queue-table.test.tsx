// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { resolveCorrectionAction } = vi.hoisted(() => ({ resolveCorrectionAction: vi.fn() }));
vi.mock('@/server-actions/commission/corrections', () => ({ resolveCorrectionAction }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

import {
  CorrectionsQueueTable,
  type CorrectionRow,
} from '@/components/commission/corrections-queue-table';

const row: CorrectionRow = {
  id: 'c1',
  partnerName: 'ООО Ромашка',
  amount: '1000',
  commissionAmount: '150',
  rate: '0.15',
  originalPeriodFrom: '2026-01-01',
  originalPeriodTo: '2026-01-31',
};

describe('CorrectionsQueueTable', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    resolveCorrectionAction.mockReset();
    toastSuccess.mockClear();

    // jsdom has no native <dialog> support (see the Dialog exemplar) — mock
    // showModal()/close() to toggle the `open` attribute so testing-library's
    // role queries can see dialog content.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('renders an EmptyState when there are no rows', () => {
    render(React.createElement(CorrectionsQueueTable, { rows: [] }));
    expect(screen.getByText('Очередь пуста — нет корректировок, требующих решения.')).toBeTruthy();
  });

  it('renders a row with partner, period, amounts, and action buttons', () => {
    render(React.createElement(CorrectionsQueueTable, { rows: [row] }));
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Применить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Списать' })).toBeTruthy();
  });

  it('apply flow: opens dialog without a reason field, submits, shows success toast, calls onResolved + router.refresh', async () => {
    resolveCorrectionAction.mockResolvedValue({ ok: true });
    render(React.createElement(CorrectionsQueueTable, { rows: [row] }));

    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(await screen.findByText('Применить корректировку')).toBeTruthy();
    // No reason field for apply
    expect(screen.queryByLabelText('Причина списания')).toBeNull();

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Применить' }));

    await waitFor(() => expect(resolveCorrectionAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Корректировка применена'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    // Row disappears (resolved) -> empty state shows
    await waitFor(() =>
      expect(screen.getByText('Очередь пуста — нет корректировок, требующих решения.')).toBeTruthy()
    );
  });

  it('waive flow: requires a reason, submit button disabled until filled, then submits with reason', async () => {
    resolveCorrectionAction.mockResolvedValue({ ok: true });
    render(React.createElement(CorrectionsQueueTable, { rows: [row] }));

    fireEvent.click(screen.getByRole('button', { name: 'Списать' }));
    expect(await screen.findByText('Списать корректировку')).toBeTruthy();

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    const submitBtn = within(dialogEl).getByRole('button', { name: 'Списать' });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    const textarea = screen.getByPlaceholderText('Почему корректировка списывается…');
    fireEvent.change(textarea, { target: { value: 'Ошибка расчёта' } });

    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submitBtn);

    await waitFor(() => expect(resolveCorrectionAction).toHaveBeenCalledTimes(1));
    const fd = resolveCorrectionAction.mock.calls[0][0] as FormData;
    expect(fd.get('correctionId')).toBe('c1');
    expect(fd.get('action')).toBe('waive');
    expect(fd.get('reason')).toBe('Ошибка расчёта');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Корректировка списана'));
  });

  it('waive submit button stays disabled (blocks the click) while the reason is empty', async () => {
    render(React.createElement(CorrectionsQueueTable, { rows: [row] }));
    fireEvent.click(screen.getByRole('button', { name: 'Списать' }));
    await screen.findByText('Списать корректировку');

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    const submitBtn = within(dialogEl).getByRole('button', { name: 'Списать' });
    fireEvent.click(submitBtn);
    expect(resolveCorrectionAction).not.toHaveBeenCalled();
  });

  it('error path: shows inline error message via errorMessageRu, does not resolve the row', async () => {
    resolveCorrectionAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(CorrectionsQueueTable, { rows: [row] }));

    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await screen.findByText('Применить корректировку');
    const dialogEl1 = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl1).getByRole('button', { name: 'Применить' }));

    expect(await screen.findByText('Нет прав на загрузку.')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    // Row is still present (not resolved)
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
  });

  it('error path: falls back to the raw code when errorMessageRu has no mapping', async () => {
    resolveCorrectionAction.mockResolvedValue({ ok: false, error: 'weird_code' });
    render(React.createElement(CorrectionsQueueTable, { rows: [row] }));

    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await screen.findByText('Применить корректировку');
    const dialogEl2 = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl2).getByRole('button', { name: 'Применить' }));

    expect(await screen.findByText('Ошибка: weird_code')).toBeTruthy();
  });

  it('cancel button closes the dialog without submitting', async () => {
    render(React.createElement(CorrectionsQueueTable, { rows: [row] }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await screen.findByText('Применить корректировку');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(resolveCorrectionAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Применить корректировку')).toBeNull());
  });
});
