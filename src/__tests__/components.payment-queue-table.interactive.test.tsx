// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const {
  planQueueOrgCreationAction,
  createOrgsFromQueueRowsAction,
  dismissQueueRowAction,
  resolveQueueRowAction,
  searchResolveOrgsAction,
  listResolveOrdersAction,
  createOrgFromQueueRowAction,
} = vi.hoisted(() => ({
  dismissQueueRowAction: vi.fn(),
  resolveQueueRowAction: vi.fn(),
  searchResolveOrgsAction: vi.fn(),
  listResolveOrdersAction: vi.fn(),
  createOrgFromQueueRowAction: vi.fn(),
  planQueueOrgCreationAction: vi.fn(),
  createOrgsFromQueueRowsAction: vi.fn(),
}));
vi.mock('@/server-actions/payment-import', () => ({
  dismissQueueRowAction,
  resolveQueueRowAction,
  searchResolveOrgsAction,
  listResolveOrdersAction,
  createOrgFromQueueRowAction,
  planQueueOrgCreationAction,
  createOrgsFromQueueRowsAction,
}));

// `У-53`: пакетное создание обновляет список после успеха.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

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
    counterpartyKey: 'РОМАШКА',
    candidateOrgId: 'org1',
    candidateOrgName: 'ООО Ромашка',
    candidateOrderId: null,
    matchMethod: 'fuzzy',
    batchCompanyId: 'co-1',
    ...over,
  };
}

// `У-90`: у таблицы появились обязательные пропсы страницы (счётчик, страница,
// адрес для фильтров) — в тестах они одинаковы и вынесены сюда.
const tableProps = {
  total: 1,
  take: 50,
  skip: 0,
  basePath: '/x',
  searchParams: {} as Record<string, string | string[] | undefined>,
};

describe('PaymentQueueTable (interactive, jsdom)', () => {
  beforeEach(() => {
    dismissQueueRowAction.mockReset();
    resolveQueueRowAction.mockReset();
    searchResolveOrgsAction.mockReset().mockResolvedValue([]);
    listResolveOrdersAction.mockReset().mockResolvedValue([]);
    planQueueOrgCreationAction.mockReset();
    createOrgsFromQueueRowsAction.mockReset();
    refresh.mockClear();
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
        ...tableProps,
        rows: [row({ isRefund: true, counterpartyInn: '123456' })],
      })
    );
    expect(screen.getAllByText('0000-9 (возврат)').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ИНН 123456/).length).toBeGreaterThan(0);
  });

  it('renders em dashes when counterpartyName and accountCandidates/candidateOrgName are absent', () => {
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [
          row({
            counterpartyName: null,
            counterpartyInn: null,
            accountCandidates: [],
            candidateOrgName: null,
          }),
        ],
      })
    );
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('joins multiple accountCandidates with a comma', () => {
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row({ accountCandidates: ['СЧ-1', 'СЧ-2'] })],
      })
    );
    expect(screen.getAllByText('СЧ-1, СЧ-2').length).toBeGreaterThan(0);
  });

  it('dismiss: clicking Отклонить calls dismissQueueRowAction and hides the row', async () => {
    dismissQueueRowAction.mockResolvedValue(undefined);
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Отклонить' })[0]);
    await waitFor(() => expect(dismissQueueRowAction).toHaveBeenCalledWith({ rowId: 'r1' }));
    await waitFor(() =>
      expect(screen.getByText('Очередь пуста — все оплаты сопоставлены.')).toBeTruthy()
    );
  });

  it('dismissing one of several rows only hides that row', async () => {
    dismissQueueRowAction.mockResolvedValue(undefined);
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row({ id: 'r1', externalId: 'EXT-1' }), row({ id: 'r2', externalId: 'EXT-2' })],
      })
    );
    const rejectButtons = screen.getAllByRole('button', { name: 'Отклонить' });
    fireEvent.click(rejectButtons[0]);
    await waitFor(() => expect(screen.queryByText('EXT-1')).toBeNull());
    expect(screen.getAllByText('EXT-2').length).toBeGreaterThan(0);
  });

  it('opening the bind dialog shows the row summary with counterparty + INN', async () => {
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    expect(await screen.findByText('Привязать оплату')).toBeTruthy();
    // Scope to the summary line (not the org <select>, which also renders
    // "ООО Ромашка" once the injected-candidate-option effect settles).
    expect(screen.getByText(/0000-9 · 1500\.00 · ООО Ромашка \(ИНН 7701234567\)/)).toBeTruthy();
  });

  it('opening the bind dialog for a row without a counterparty shows the "без контрагента" fallback', async () => {
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row({ counterpartyName: null, counterpartyInn: null })],
      })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    const dialogEl = document.querySelector('dialog') as HTMLElement;
    expect(within(dialogEl).getByText(/без контрагента/)).toBeTruthy();
  });

  it('org search loads on open and pre-fills the candidate org from the row', async () => {
    searchResolveOrgsAction.mockResolvedValue([
      { id: 'org1', name: 'ООО Ромашка', inn: '7701234567' },
    ]);
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');

    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalledWith({ q: '' }));
    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    await waitFor(() => expect(orgSelect.value).toBe('org1'));
  });

  it('candidate org not present in the search results is injected explicitly as an option', async () => {
    searchResolveOrgsAction.mockResolvedValue([
      { id: 'other', name: 'Другая организация', inn: null },
    ]);
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row({ candidateOrgId: 'org1', candidateOrgName: 'ООО Ромашка' })],
      })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');

    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalled());
    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    await waitFor(() => expect(within(orgSelect).getByText('ООО Ромашка')).toBeTruthy());
    expect(within(orgSelect).getByText('Другая организация')).toBeTruthy();
  });

  it('does not inject the candidate org when it is already present in the search results', async () => {
    searchResolveOrgsAction.mockResolvedValue([
      { id: 'org1', name: 'ООО Ромашка (из поиска)', inn: '7701234567' },
    ]);
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');

    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    await waitFor(() => expect(within(orgSelect).getAllByText(/ООО Ромашка/).length).toBe(1));
  });

  it('when the row has no candidateOrgId/Name, no injection happens even if absent from results', async () => {
    searchResolveOrgsAction.mockResolvedValue([]);
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row({ candidateOrgId: null, candidateOrgName: null })],
      })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalled());
    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    expect(orgSelect.value).toBe('');
  });

  it('typing in the org search input re-triggers searchResolveOrgsAction with the new query', async () => {
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalledWith({ q: '' }));

    fireEvent.change(screen.getByLabelText('Поиск организации'), { target: { value: 'Ромашка' } });
    await waitFor(() => expect(searchResolveOrgsAction).toHaveBeenCalledWith({ q: 'Ромашка' }));
  });

  it('selecting an org loads its orders; order select shows orderNumber prefix and title-only fallback', async () => {
    listResolveOrdersAction.mockResolvedValue([
      { id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' },
      { id: 'ord2', orderNumber: null, title: 'Без номера' },
    ]);
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');

    await waitFor(() =>
      expect(listResolveOrdersAction).toHaveBeenCalledWith({ organizationId: 'org1' })
    );
    const orderSelect = screen.getByLabelText('Заказ (необязательно)') as HTMLSelectElement;
    await waitFor(() => expect(within(orderSelect).getByText('№ПЗ-01 — Поставка')).toBeTruthy());
    expect(within(orderSelect).getByText('Без номера')).toBeTruthy();
    expect(orderSelect.disabled).toBe(false);
  });

  it('order select stays disabled while no org is chosen (no candidate org on this row)', async () => {
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row({ candidateOrgId: null, candidateOrgName: null })],
      })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    const orderSelect = screen.getByLabelText('Заказ (необязательно)') as HTMLSelectElement;
    expect(orderSelect.disabled).toBe(true);
  });

  it('changing the org resets orderId and, when clearing org, clears the orders list', async () => {
    listResolveOrdersAction.mockResolvedValue([
      { id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' },
    ]);
    searchResolveOrgsAction.mockResolvedValue([
      { id: 'org1', name: 'ООО Ромашка', inn: null },
      { id: 'org2', name: 'ООО Лютик', inn: null },
    ]);
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    await waitFor(() =>
      expect(listResolveOrdersAction).toHaveBeenCalledWith({ organizationId: 'org1' })
    );

    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    fireEvent.change(orgSelect, { target: { value: '' } });
    const orderSelect = screen.getByLabelText('Заказ (необязательно)') as HTMLSelectElement;
    expect(orderSelect.disabled).toBe(true);
    expect(orderSelect.value).toBe('');
  });

  it('when the fetched orders no longer include the current orderId, orderId resets to empty', async () => {
    listResolveOrdersAction.mockResolvedValueOnce([
      { id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' },
    ]);
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalledTimes(1));

    const orderSelect = screen.getByLabelText('Заказ (необязательно)') as HTMLSelectElement;
    fireEvent.change(orderSelect, { target: { value: 'ord1' } });
    expect(orderSelect.value).toBe('ord1');

    // Re-select the same org (different identity call) to trigger the effect
    // again with a response that no longer contains 'ord1'.
    listResolveOrdersAction.mockResolvedValueOnce([
      { id: 'ord2', orderNumber: 'ПЗ-02', title: 'Другой заказ' },
    ]);
    const orgSelect = screen.getByLabelText('Организация') as HTMLSelectElement;
    fireEvent.change(orgSelect, { target: { value: '' } });
    fireEvent.change(orgSelect, { target: { value: 'org1' } });

    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(orderSelect.value).toBe(''));
  });

  it('submit success: calls resolveQueueRowAction, hides the row, shows success toast, closes the dialog', async () => {
    resolveQueueRowAction.mockResolvedValue({ ok: true });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Привязать' }));

    await waitFor(() =>
      expect(resolveQueueRowAction).toHaveBeenCalledWith({
        rowId: 'r1',
        organizationId: 'org1',
        orderId: null,
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Оплата привязана и проведена'));
    await waitFor(() =>
      expect(screen.getByText('Очередь пуста — все оплаты сопоставлены.')).toBeTruthy()
    );
  });

  it('submit passes a chosen orderId through to resolveQueueRowAction', async () => {
    listResolveOrdersAction.mockResolvedValue([
      { id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' },
    ]);
    resolveQueueRowAction.mockResolvedValue({ ok: true });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    await waitFor(() => expect(listResolveOrdersAction).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Заказ (необязательно)'), { target: { value: 'ord1' } });
    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Привязать' }));

    await waitFor(() =>
      expect(resolveQueueRowAction).toHaveBeenCalledWith({
        rowId: 'r1',
        organizationId: 'org1',
        orderId: 'ord1',
      })
    );
  });

  it('submit failure: shows the mapped server error inline, keeps the row and dialog open', async () => {
    resolveQueueRowAction.mockResolvedValue({ ok: false, error: 'write_skipped' });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Привязать' }));

    expect(
      await screen.findByText(
        'Оплата не записана: организация вне вашей зоны доступа или нет данных для привязки'
      )
    ).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Привязать оплату')).toBeTruthy();
  });

  it('submit failure with an unmapped code falls back to "Ошибка: <code>"', async () => {
    resolveQueueRowAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');

    const dialogEl = document.querySelector('dialog') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Привязать' }));

    expect(await screen.findByText('Ошибка: weird')).toBeTruthy();
  });

  it('cancel closes the dialog without submitting', async () => {
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(resolveQueueRowAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Привязать оплату')).toBeNull());
  });

  it('submit button is disabled while no org is selected', async () => {
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row({ candidateOrgId: null, candidateOrgName: null })],
      })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    const dialogEl = document.querySelector('dialog') as HTMLElement;
    const submitBtn = within(dialogEl).getByRole('button', {
      name: 'Привязать',
    }) as HTMLButtonElement;
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
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
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
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Привязать' })[0]);
    await screen.findByText('Привязать оплату');
    await waitFor(() =>
      expect(listResolveOrdersAction).toHaveBeenCalledWith({ organizationId: 'org1' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByText('Привязать оплату')).toBeNull());

    expect(() =>
      resolveOrders([{ id: 'ord1', orderNumber: 'ПЗ-01', title: 'Поставка' }])
    ).not.toThrow();
  });
});

/**
 * Этап 10 (Т-30/Т-31): диалог «Создать организацию и привязать» — кнопка
 * только у строк с ИНН, prefill, селект компании только у admin, DaData-
 * подтяжка с тихой деградацией, русские ошибки.
 */
describe('PaymentQueueTable — создание организации из очереди (Т-30)', () => {
  const COMPANIES = [
    { id: 'co-1', name: 'Альфа' },
    { id: 'co-2', name: 'Бета' },
  ];

  beforeEach(() => {
    createOrgFromQueueRowAction.mockReset();
  });

  const openDialog = () => document.querySelector('dialog[open]') as HTMLElement;

  it('кнопка есть только у строк с ИНН', () => {
    render(<PaymentQueueTable rows={[row(), row({ id: 'r2', counterpartyInn: null })]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    expect(screen.getAllByTestId('create-org-r1')[0]).toBeTruthy();
    expect(screen.queryByTestId('create-org-r2')).toBeNull();
  });

  it('диалог: prefill наименования и ИНН; без пропа companies селекта нет; успех прячет строку', async () => {
    createOrgFromQueueRowAction.mockResolvedValue({
      ok: true,
      organizationId: 'org-new',
      paymentId: 'pay-1',
    });
    render(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);

    const dialog = openDialog();
    expect((within(dialog).getByLabelText('Наименование') as HTMLInputElement).value).toBe(
      'ООО Ромашка'
    );
    expect((within(dialog).getByLabelText('ИНН') as HTMLInputElement).value).toBe('7701234567');
    expect(within(dialog).queryByLabelText('Компания новой организации')).toBeNull();

    fireEvent.click(screen.getByTestId('create-org-submit'));
    await waitFor(() =>
      expect(createOrgFromQueueRowAction).toHaveBeenCalledWith({
        rowId: 'r1',
        name: 'ООО Ромашка',
        inn: '7701234567',
        kpp: null,
      })
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Организация создана, оплата привязана')
    );
    expect(screen.queryByTestId('create-org-r1')).toBeNull(); // строка скрыта
  });

  it('admin: селект компании обязателен, prefill компанией батча, значение уходит в экшен', async () => {
    createOrgFromQueueRowAction.mockResolvedValue({
      ok: true,
      organizationId: 'o',
      paymentId: null,
    });
    render(<PaymentQueueTable rows={[row()]} companies={COMPANIES}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);

    const select = within(openDialog()).getByLabelText(
      'Компания новой организации'
    ) as HTMLSelectElement;
    expect(select.value).toBe('co-1'); // prefill компанией батча
    fireEvent.change(select, { target: { value: 'co-2' } });

    fireEvent.click(screen.getByTestId('create-org-submit'));
    await waitFor(() =>
      expect(createOrgFromQueueRowAction).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'co-2' })
      )
    );
  });

  it('Т-31: «Подтянуть по ИНН» заполняет поля из DaData; пусто → тихая подсказка', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          suggestions: [{ name: 'ООО ДаДата', inn: '7701234567', kpp: '770101001' }],
        }),
      })
      .mockResolvedValueOnce({ json: async () => ({ suggestions: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
      fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);

      fireEvent.click(screen.getByTestId('create-org-dadata'));
      await waitFor(() =>
        expect(
          (within(openDialog()).getByLabelText('Наименование') as HTMLInputElement).value
        ).toBe('ООО ДаДата')
      );
      expect(
        (within(openDialog()).getByLabelText('КПП (необязательно)') as HTMLInputElement).value
      ).toBe('770101001');
      expect(fetchMock).toHaveBeenCalledWith('/api/suggest/party?query=7701234567');

      fireEvent.click(screen.getByTestId('create-org-dadata'));
      await waitFor(() =>
        expect(openDialog().textContent).toContain('По этому ИНН ничего не нашлось')
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Т-31: сеть упала — подсказка про ручной ввод, форма живёт', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net down')));
    try {
      render(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
      fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);
      fireEvent.click(screen.getByTestId('create-org-dadata'));
      await waitFor(() => expect(openDialog().textContent).toContain('Подсказки недоступны'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ошибки сервиса — по-русски: org_exists и bind_failed', async () => {
    createOrgFromQueueRowAction
      .mockResolvedValueOnce({ ok: false, error: 'org_exists' })
      .mockResolvedValueOnce({
        ok: false,
        error: 'bind_failed',
        organizationId: 'org-new',
        bindError: 'write_skipped',
      });
    render(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);

    fireEvent.click(screen.getByTestId('create-org-submit'));
    await waitFor(() =>
      expect(openDialog().textContent).toContain('Организация с этим ИНН уже есть в базе')
    );
    fireEvent.click(screen.getByTestId('create-org-submit'));
    await waitFor(() =>
      expect(openDialog().textContent).toContain(
        'Организация создана, но оплату привязать не удалось'
      )
    );
  });

  it('оператор правит поля: изменённые ИНН/наименование/КПП уходят в экшен (КПП — без пробелов)', async () => {
    createOrgFromQueueRowAction.mockResolvedValue({
      ok: true,
      organizationId: 'org-new',
      paymentId: 'pay-1',
    });
    render(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);

    const dialog = openDialog();
    const innInput = within(dialog).getByLabelText('ИНН') as HTMLInputElement;
    const nameInput = within(dialog).getByLabelText('Наименование') as HTMLInputElement;
    const kppInput = within(dialog).getByLabelText('КПП (необязательно)') as HTMLInputElement;

    fireEvent.change(innInput, { target: { value: '7712345678' } });
    fireEvent.change(nameInput, { target: { value: 'ООО Новая' } });
    fireEvent.change(kppInput, { target: { value: '  771201001  ' } });

    // Поля управляемые: правка видна в самом поле…
    expect(innInput.value).toBe('7712345678');
    expect(nameInput.value).toBe('ООО Новая');
    expect(kppInput.value).toBe('  771201001  ');

    // …и именно правленые значения уходят на сервер.
    fireEvent.click(screen.getByTestId('create-org-submit'));
    await waitFor(() =>
      expect(createOrgFromQueueRowAction).toHaveBeenCalledWith({
        rowId: 'r1',
        name: 'ООО Новая',
        inn: '7712345678',
        kpp: '771201001',
      })
    );
  });

  it('очистка обязательного поля блокирует кнопку создания', () => {
    render(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);

    const submit = screen.getByTestId('create-org-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.change(within(openDialog()).getByLabelText('Наименование'), {
      target: { value: '   ' },
    });
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(openDialog()).getByLabelText('Наименование'), {
      target: { value: 'ООО Ромашка' },
    });
    fireEvent.change(within(openDialog()).getByLabelText('ИНН'), { target: { value: '' } });
    expect(submit.disabled).toBe(true);
    expect(createOrgFromQueueRowAction).not.toHaveBeenCalled();
  });

  it('строка без наименования (но с ИНН): поле пустое, кнопка заблокирована до ручного ввода', async () => {
    createOrgFromQueueRowAction.mockResolvedValue({
      ok: true,
      organizationId: 'org-new',
      paymentId: null,
    });
    render(<PaymentQueueTable rows={[row({ counterpartyName: null })]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);

    const nameInput = within(openDialog()).getByLabelText('Наименование') as HTMLInputElement;
    expect(nameInput.value).toBe(''); // фолбэк вместо null
    const submit = screen.getByTestId('create-org-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: 'ООО Без имени в выписке' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(createOrgFromQueueRowAction).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'ООО Без имени в выписке' })
      )
    );
  });

  it('admin: у строки без компании батча селект пуст и кнопка заблокирована, пока компанию не выбрали', async () => {
    createOrgFromQueueRowAction.mockResolvedValue({
      ok: true,
      organizationId: 'org-new',
      paymentId: null,
    });
    render(<PaymentQueueTable rows={[row({ batchCompanyId: null })]} companies={COMPANIES}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);

    const select = within(openDialog()).getByLabelText(
      'Компания новой организации'
    ) as HTMLSelectElement;
    expect(select.value).toBe(''); // фолбэк вместо null — компания не предзаполнена
    const submit = screen.getByTestId('create-org-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'co-2' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(createOrgFromQueueRowAction).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'co-2' })
      )
    );
  });

  it('«Отмена» закрывает диалог создания: экшен не вызван, строка осталась в очереди', async () => {
    render(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);
    expect(within(openDialog()).getByText('Создать организацию и привязать')).toBeTruthy();

    fireEvent.click(within(openDialog()).getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByText('Создать организацию и привязать')).toBeNull());
    expect(createOrgFromQueueRowAction).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('create-org-r1')[0]).toBeTruthy();
  });

  it('сеть упала на создании — понятная ошибка', async () => {
    createOrgFromQueueRowAction.mockRejectedValue(new Error('net down'));
    render(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getAllByTestId('create-org-r1')[0]);
    fireEvent.click(screen.getByTestId('create-org-submit'));
    await waitFor(() => expect(openDialog().textContent).toContain('Сервер недоступен'));
  });
});

/**
 * `У-53` + решение `Р-10`: пакетное создание организаций — строго два шага.
 * Проверяем и то, ради чего шага два: без показанного списка создать нельзя,
 * а снятая галочка исключает контрагента.
 */
describe('PaymentQueueTable — пакетное создание организаций (У-53)', () => {
  beforeEach(() => {
    planQueueOrgCreationAction.mockReset();
    createOrgsFromQueueRowsAction.mockReset();
    toastSuccess.mockClear();
    refresh.mockClear();
  });

  const CANDIDATES = [
    { rowId: 'r1', name: 'ООО «Альфа»', inn: '7707083893', alsoRows: 2 },
    { rowId: 'r2', name: 'ООО «Бета»', inn: '7736207543', alsoRows: 0 },
  ];

  it('первый шаг показывает список, второй — создаёт только отмеченных', async () => {
    planQueueOrgCreationAction.mockResolvedValue({ ok: true, candidates: CANDIDATES });
    createOrgsFromQueueRowsAction.mockResolvedValue({
      ok: true,
      result: { created: 1, bound: 2, failed: [] },
    });

    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));

    // Шаг 1: сначала список, а не молчаливое создание.
    const list = await screen.findByTestId('bulk-candidates');
    expect(list.textContent).toContain('ООО «Альфа»');
    expect(list.textContent).toContain('7707083893');
    // Видно, сколько оплат подтянется вместе с организацией.
    expect(list.textContent).toContain('подтянется оплат: 3');
    expect(screen.getByTestId('bulk-count').textContent).toBe('2');

    // Снимаем галочку у «Беты» — она не должна уехать на сервер.
    fireEvent.click(screen.getByTestId('bulk-row-r2'));
    expect(screen.getByTestId('bulk-count').textContent).toBe('1');

    fireEvent.click(screen.getByTestId('bulk-confirm'));
    await waitFor(() =>
      expect(createOrgsFromQueueRowsAction).toHaveBeenCalledWith({ rowIds: ['r1'] })
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Создано организаций: 1, привязано оплат: 2')
    );
    // Список перечитывается: созданные строки больше не в очереди.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('создавать нечего — говорим об этом словами и не даём кнопку', async () => {
    planQueueOrgCreationAction.mockResolvedValue({ ok: true, candidates: [] });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));

    expect((await screen.findByTestId('bulk-empty')).textContent).toContain('Создавать нечего');
    expect(screen.queryByTestId('bulk-confirm')).toBeNull();
  });

  it('отказ по правам показывается по-русски', async () => {
    planQueueOrgCreationAction.mockResolvedValue({ ok: false, error: 'not_allowed' });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));

    await waitFor(() => {
      const open = document.querySelector('dialog[open]');
      expect(open).toBeTruthy();
      expect(within(open as HTMLElement).getByText(/администратор или руководитель/)).toBeTruthy();
    });
  });

  it('администратор выбирает компанию прямо в диалоге', async () => {
    planQueueOrgCreationAction.mockResolvedValue({ ok: true, candidates: [CANDIDATES[0]] });
    createOrgsFromQueueRowsAction.mockResolvedValue({
      ok: true,
      result: { created: 1, bound: 0, failed: [] },
    });
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row()],
        companies: [
          { id: 'co-1', name: 'Первая' },
          { id: 'co-2', name: 'Вторая' },
        ],
      })
    );
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));
    await screen.findByTestId('bulk-candidates');

    fireEvent.change(screen.getByTestId('bulk-org-company-select'), {
      target: { value: 'co-2' },
    });
    fireEvent.click(screen.getByTestId('bulk-confirm'));
    await waitFor(() =>
      expect(createOrgsFromQueueRowsAction).toHaveBeenCalledWith({
        rowIds: ['r1'],
        companyId: 'co-2',
      })
    );
  });

  it('строк с ИНН нет — кнопки пакетного создания нет вовсе', () => {
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row({ counterpartyInn: null })] }));
    expect(screen.queryByTestId('bulk-create-orgs')).toBeNull();
  });
});

/** Краевые пути пакетного диалога: отказы сервера, обрыв связи, отмена. */
describe('PaymentQueueTable — пакетное создание: краевые случаи', () => {
  beforeEach(() => {
    planQueueOrgCreationAction.mockReset();
    createOrgsFromQueueRowsAction.mockReset();
    toastSuccess.mockClear();
    refresh.mockClear();
  });

  const ONE = [{ rowId: 'r1', name: 'ООО «Альфа»', inn: '7707083893', alsoRows: 0 }];

  it('сервер недоступен на шаге плана — экран не молчит', async () => {
    planQueueOrgCreationAction.mockRejectedValue(new Error('offline'));
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));

    await waitFor(() => {
      const open = document.querySelector('dialog[open]');
      expect(open).toBeTruthy();
      expect(within(open as HTMLElement).getByText(/Сервер недоступен/)).toBeTruthy();
    });
  });

  it('отказ на создании показывается по-русски, диалог не закрывается', async () => {
    planQueueOrgCreationAction.mockResolvedValue({ ok: true, candidates: ONE });
    createOrgsFromQueueRowsAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));
    await screen.findByTestId('bulk-candidates');
    fireEvent.click(screen.getByTestId('bulk-confirm'));

    await waitFor(() => {
      const open = document.querySelector('dialog[open]');
      expect(within(open as HTMLElement).getByText('Недостаточно прав')).toBeTruthy();
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('обрыв связи на создании тоже виден', async () => {
    planQueueOrgCreationAction.mockResolvedValue({ ok: true, candidates: ONE });
    createOrgsFromQueueRowsAction.mockRejectedValue(new Error('offline'));
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));
    await screen.findByTestId('bulk-candidates');
    fireEvent.click(screen.getByTestId('bulk-confirm'));

    await waitFor(() => {
      const open = document.querySelector('dialog[open]');
      expect(within(open as HTMLElement).getByText(/Сервер недоступен/)).toBeTruthy();
    });
  });

  it('единственная компания подставляется без вопроса', async () => {
    planQueueOrgCreationAction.mockResolvedValue({ ok: true, candidates: ONE });
    createOrgsFromQueueRowsAction.mockResolvedValue({
      ok: true,
      result: { created: 1, bound: 0, failed: [] },
    });
    render(
      React.createElement(PaymentQueueTable, {
        ...tableProps,
        rows: [row()],
        companies: [{ id: 'co-only', name: 'Единственная' }],
      })
    );
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));
    await screen.findByTestId('bulk-candidates');
    // Выбора нет — есть поясняющая строка, а компания уже подставлена.
    expect(screen.getByTestId('bulk-org-company-single').textContent).toContain('Единственная');
    fireEvent.click(screen.getByTestId('bulk-confirm'));
    await waitFor(() =>
      expect(createOrgsFromQueueRowsAction).toHaveBeenCalledWith({
        rowIds: ['r1'],
        companyId: 'co-only',
      })
    );
  });

  it('галочку можно вернуть обратно, а диалог — закрыть без создания', async () => {
    planQueueOrgCreationAction.mockResolvedValue({
      ok: true,
      candidates: [...ONE, { rowId: 'r2', name: 'ООО «Бета»', inn: '7736207543', alsoRows: 0 }],
    });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));
    await screen.findByTestId('bulk-candidates');

    fireEvent.click(screen.getByTestId('bulk-row-r2'));
    expect(screen.getByTestId('bulk-count').textContent).toBe('1');
    fireEvent.click(screen.getByTestId('bulk-row-r2'));
    expect(screen.getByTestId('bulk-count').textContent).toBe('2');

    // Закрытие без подтверждения ничего не создаёт (`Р-10`).
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByTestId('bulk-candidates')).toBeNull());
    expect(createOrgsFromQueueRowsAction).not.toHaveBeenCalled();
  });

  it('контрагент без названия виден как «без названия», а не пустой строкой', async () => {
    planQueueOrgCreationAction.mockResolvedValue({
      ok: true,
      candidates: [{ rowId: 'r1', name: '', inn: '7707083893', alsoRows: 0 }],
    });
    render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));
    const list = await screen.findByTestId('bulk-candidates');
    expect(list.textContent).toContain('без названия');
  });

  it('диалог закрыли до ответа сервера — состояние размонтированного не трогаем', async () => {
    // Иначе React ругается на setState после размонтирования, а пользователь
    // видит призрачный список от прошлого открытия.
    let release: (v: unknown) => void = () => {};
    planQueueOrgCreationAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const view = render(React.createElement(PaymentQueueTable, { ...tableProps, rows: [row()] }));
    fireEvent.click(screen.getByTestId('bulk-create-orgs'));
    view.unmount();
    release({ ok: true, candidates: [] });
    await waitFor(() => expect(planQueueOrgCreationAction).toHaveBeenCalled());
  });
});
