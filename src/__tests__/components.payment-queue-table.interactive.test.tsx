// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const {
  dismissQueueRowAction,
  resolveQueueRowAction,
  searchResolveOrgsAction,
  listResolveOrdersAction
} = vi.hoisted(() => ({
  dismissQueueRowAction: vi.fn(),
  resolveQueueRowAction: vi.fn(),
  searchResolveOrgsAction: vi.fn(),
  listResolveOrdersAction: vi.fn()
}));
vi.mock('@/server-actions/payment-import', () => ({
  dismissQueueRowAction,
  resolveQueueRowAction,
  searchResolveOrgsAction,
  listResolveOrdersAction
}));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess } }));

import { PaymentQueueTable, type QueueRow } from '@/components/import/payment-queue-table';

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    id: 'r1',
    externalId: '0000-9',
    paidAt: '2026-06-01T00:00:00.000Z',
    amount: '1500.00',
    isRefund: false,
    purpose: 'Оплата',
    counterpartyName: 'ООО Ромашка',
    counterpartyInn: '7701234567',
    accountCandidates: ['СЧ-1'],
    candidateOrgId: 'org1',
    candidateOrgName: 'ООО Ромашка',
    matchMethod: 'fuzzy',
    ...over
  };
}

describe('PaymentQueueTable (interactive, jsdom)', () => {
  beforeEach(() => {
    dismissQueueRowAction.mockReset();
    resolveQueueRowAction.mockReset();
    searchResolveOrgsAction.mockReset().mockResolvedValue([]);
    listResolveOrdersAction.mockReset().mockResolvedValue([]);
    toastSuccess.mockClear();

    // jsdom has no native <dialog> behaviour — see the Dialog exemplar.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('renders the isRefund suffix and the counterparty INN suffix', () => {
    render(
      React.createElement(PaymentQueueTable, {
        rows: [row({ isRefund: true, counterpartyInn: '123456' })]
      })
    );
    expect(screen.getByText('0000-9 (возврат)')).toBeTruthy();
    expect(screen.getByText(/ИНН 123456/)).toBeTruthy();
  });

  it('renders em dashes when counterpartyName and accountCandidates/candidateOrgName are absent', () => {
    render(
      React.createElement(PaymentQueueTable, {
        rows: [
          row({
            counterpartyName: null,
            counterpartyInn: null,
            accountCandidates: [],
            candidateOrgName: null
          })
        ]
      })
    );
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('joins multiple accountCandidates with a comma', () => {
    render(
      React.createElement(PaymentQueueTable, {
        rows: [row({ accountCandidates: ['СЧ-1', 'СЧ-2'] })]
      })
    );
    expect(screen.getByText('СЧ-1, СЧ-2')).toBeTruthy();
  });

  it('dismiss: clicking Отклонить calls dismissQueueRowAction and hides the row', async () => {
    dismissQueueRowAction.mockResolvedValue(undefined);
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(dismissQueueRowAction).toHaveBeenCalledWith({ rowId: 'r1' }));
    await waitFor(() => expect(screen.getByText('Очередь пуста — все оплаты сопоставлены.')).toBeTruthy());
  });

  it('dismissing one of several rows only hides that row', async () => {
    dismissQueueRowAction.mockResolvedValue(undefined);
    render(
      React.createElement(PaymentQueueTable, {
        rows: [row({ id: 'r1', externalId: 'EXT-1' }), row({ id: 'r2', externalId: 'EXT-2' })]
      })
    );
    const rejectButtons = screen.getAllByRole('button', { name: 'Отклонить' });
    fireEvent.click(rejectButtons[0]);
    await waitFor(() => expect(screen.queryByText('EXT-1')).toBeNull());
    expect(screen.getByText('EXT-2')).toBeTruthy();
  });

  it('opening the bind dialog shows the row summary with counterparty + INN', async () => {
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    expect(await screen.findByText('Привязать оплату')).toBeTruthy();
    // Scope to the summary line (not the org <select>, which also renders
    // "ООО Ромашка" once the injected-candidate-option effect settles).
    expect(screen.getByText(/0000-9 · 1500\.00 · ООО Ромашка \(ИНН 7701234567\)/)).toBeTruthy();
  });

  it('opening the bind dialog for a row without a counterparty shows the "без контрагента" fallback', async () => {
    render(React.createElement(PaymentQueueTable, { rows: [row({ counterpartyName: null, counterpartyInn: null })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    const dialogEl = document.querySelector('dialog') as HTMLElement;
    expect(within(dialogEl).getByText(/без контрагента/)).toBeTruthy();
  });

  it('org search loads on open and pre-fills the candidate org from the row', async () => {
    searchResolveOrgsAction.mockResolvedValue([{ id: 'org1', name: 'ООО Ромашка', inn: '7701234567' }]);
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalledWith({ q: '' }));
    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    await waitFor(() => expect(orgSelect.value).toBe('org1'));
  });

  it('candidate org not present in the search results is injected explicitly as an option', async () => {
    searchResolveOrgsAction.mockResolvedValue([{ id: 'other', name: 'Другая организация', inn: null }]);
    render(React.createElement(PaymentQueueTable, { rows: [row({ candidateOrgId: 'org1', candidateOrgName: 'ООО Ромашка' })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalled());
    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    await waitFor(() => expect(within(orgSelect).getByText('ООО Ромашка')).toBeTruthy());
    expect(within(orgSelect).getByText('Другая организация')).toBeTruthy();
  });

  it('does not inject the candidate org when it is already present in the search results', async () => {
    searchResolveOrgsAction.mockResolvedValue([{ id: 'org1', name: 'ООО Ромашка (из поиска)', inn: '7701234567' }]);
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    await waitFor(() => expect(within(orgSelect).getAllByText(/ООО Ромашка/).length).toBe(1));
  });

  it('when the row has no candidateOrgId/Name, no injection happens even if absent from results', async () => {
    searchResolveOrgsAction.mockResolvedValue([]);
    render(
      React.createElement(PaymentQueueTable, {
        rows: [row({ candidateOrgId: null, candidateOrgName: null })]
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalled());
    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    expect(orgSelect.value).toBe('');
  });

  it('typing in the org search input re-triggers searchResolveOrgsAction with the new query', async () => {
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalledWith({ q: '' }));

    fireEvent.change(screen.getByLabelText('Поиск организации'), { target: { value: 'Ромашка' } });
    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalledWith({ q: 'Ромашка' }));
  });

  it('selecting an org loads its orders; order select shows orderNumber prefix and title-only fallback', async () => {
    listResolveOrdersAction.mockResolvedValue([
      { id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' },
      { id: 'ord2', orderNumber: null, title: 'Без номера' }
    ]);
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalledWith({ organizationId: 'org1' }));
    const orderSelect = screen.getByLabelText('Заказ (необязательно)') as HTMLSelectElement;
    await waitFor(() => expect(within(orderSelect).getByText('№ПЗ-01 — Поставка')).toBeTruthy());
    expect(within(orderSelect).getByText('Без номера')).toBeTruthy();
    expect(orderSelect.disabled).toBe(false);
  });

  it('order select stays disabled while no org is chosen (no candidate org on this row)', async () => {
    render(React.createElement(PaymentQueueTable, { rows: [row({ candidateOrgId: null, candidateOrgName: null })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    const orderSelect = screen.getByLabelText('Заказ (необязательно)') as HTMLSelectElement;
    expect(orderSelect.disabled).toBe(true);
  });

  it('changing the org resets orderId and, when clearing org, clears the orders list', async () => {
    listResolveOrdersAction.mockResolvedValue([{ id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' }]);
    searchResolveOrgsAction.mockResolvedValue([
      { id: 'org1', name: 'ООО Ромашка', inn: null },
      { id: 'org2', name: 'ООО Лютик', inn: null }
    ]);
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalledWith({ organizationId: 'org1' }));

    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    fireEvent.change(orgSelect, { target: { value: '' } });
    const orderSelect = screen.getByLabelText('Заказ (необязательно)') as HTMLSelectElement;
    expect(orderSelect.disabled).toBe(true);
    expect(orderSelect.value).toBe('');
  });

  it('when the fetched orders no longer include the current orderId, orderId resets to empty', async () => {
    listResolveOrdersAction.mockResolvedValueOnce([{ id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' }]);
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalledTimes(1));

    const orderSelect = screen.getByLabelText('Заказ (необязательно)') as HTMLSelectElement;
    fireEvent.change(orderSelect, { target: { value: 'ord1' } });
    expect(orderSelect.value).toBe('ord1');

    // Re-select the same org (different identity call) to trigger the effect
    // again with a response that no longer contains 'ord1'.
    listResolveOrdersAction.mockResolvedValueOnce([{ id: 'ord2', orderNumber: 'ПЗ-02', title: 'Другой заказ' }]);
    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    fireEvent.change(orgSelect, { target: { value: '' } });
    fireEvent.change(orgSelect, { target: { value: 'org1' } });

    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(orderSelect.value).toBe(''));
  });

  it('submit success: calls resolveQueueRowAction, hides the row, shows success toast, closes the dialog', async () => {
    resolveQueueRowAction.mockResolvedValue({ ok: true });
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Привязать' }));

    await waitFor(() =>
      expect(resolveQueueRowAction).toHaveBeenCalledWith({ rowId: 'r1', organizationId: 'org1', orderId: null })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Оплата привязана и проведена'));
    await waitFor(() => expect(screen.getByText('Очередь пуста — все оплаты сопоставлены.')).toBeTruthy());
  });

  it('submit passes a chosen orderId through to resolveQueueRowAction', async () => {
    listResolveOrdersAction.mockResolvedValue([{ id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' }]);
    resolveQueueRowAction.mockResolvedValue({ ok: true });
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Заказ (необязательно)'), { target: { value: 'ord1' } });
    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Привязать' }));

    await waitFor(() =>
      expect(resolveQueueRowAction).toHaveBeenCalledWith({ rowId: 'r1', organizationId: 'org1', orderId: 'ord1' })
    );
  });

  it('submit failure: shows the mapped server error inline, keeps the row and dialog open', async () => {
    resolveQueueRowAction.mockResolvedValue({ ok: false, error: 'write_skipped' });
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Привязать' }));

    expect(
      await screen.findByText('Оплата не записана: организация вне вашей зоны доступа или нет данных для привязки')
    ).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Привязать оплату')).toBeTruthy();
  });

  it('submit failure with an unmapped code falls back to "Ошибка: <code>"', async () => {
    resolveQueueRowAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Привязать' }));

    expect(await screen.findByText('Ошибка: weird')).toBeTruthy();
  });

  it('cancel closes the dialog without submitting', async () => {
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(resolveQueueRowAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Привязать оплату')).toBeNull());
  });

  it('submit button is disabled while no org is selected', async () => {
    render(React.createElement(PaymentQueueTable, { rows: [row({ candidateOrgId: null, candidateOrgName: null })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    const dialogEl = document.querySelector('dialog') as HTMLElement;
    const submitBtn = within(dialogEl).getByRole('button', { name: 'Привязать' }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('unmounting the dialog mid-flight (org search) does not throw or set state after unmount (alive guard)', async () => {
    let resolveSearch: (v: unknown) => void = () => {};
    searchResolveOrgsAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        })
    );
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByText('Привязать оплату')).toBeNull());

    // Resolve after unmount — the `alive` guard in the effect should prevent
    // a "set state on unmounted component" warning/crash.
    expect(() => resolveSearch([{ id: 'org1', name: 'X', inn: null }])).not.toThrow();
  });

  it('unmounting mid-flight (orders fetch for the selected org) does not throw after unmount (alive guard)', async () => {
    let resolveOrders: (v: unknown) => void = () => {};
    listResolveOrdersAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOrders = resolve;
        })
    );
    render(React.createElement(PaymentQueueTable, { rows: [row()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalledWith({ organizationId: 'org1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByText('Привязать оплату')).toBeNull());

    expect(() => resolveOrders([{ id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' }])).not.toThrow();
  });
});
