// @vitest-environment jsdom
/**
 * «Это тот же заказ, что …» (этап 2 ТЗ 12.09.2026, `У-197`, `В-2-4`).
 *
 * Кнопка стоит на карточке заказа, перенесённого из Битрикс24, и переносит всё
 * его содержимое на заказ 1С. Проверяем путь человека целиком: открыл — список
 * подгрузился, выбрал — подтвердил, успех закрыл окно и обновил страницу, а
 * отказ сервера показан по-русски, а не кодом.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  listMergeTargetsAction: vi.fn(),
  mergeExternalOrderAction: vi.fn(),
}));
vi.mock('@/server-actions/orders/mergeExternal', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { MergeExternalOrderButton } from '@/components/orders/merge-external-order-button';

const TARGETS = [
  {
    id: 'o-1c-1',
    label: '2024-001 — Обучение по ОТ',
    totalAmount: '120000.00',
    closedAt: new Date('2026-09-13T09:05:00Z'),
  },
  { id: 'o-1c-2', label: '2024-002 — Аттестация', totalAmount: '0.00', closedAt: null },
];

beforeAll(() => {
  // Нативный <dialog> в jsdom не умеет showModal — как в остальных тестах примитива Dialog.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  actions.listMergeTargetsAction.mockResolvedValue({ ok: true, targets: TARGETS });
  actions.mergeExternalOrderAction.mockResolvedValue({ ok: true, moved: {} });
});

function openDialog(): HTMLElement | null {
  return document.querySelector('dialog[open]');
}

/** Открывает окно объединения и отдаёт запросы внутри него. */
async function open(orderId = 'ord-bitrix') {
  render(<MergeExternalOrderButton orderId={orderId} />);
  fireEvent.click(screen.getByRole('button', { name: 'Это тот же заказ, что…' }));
  await waitFor(() => expect(openDialog()).not.toBeNull());
  return within(openDialog() as HTMLElement);
}

describe('MergeExternalOrderButton', () => {
  it('до нажатия окна нет и кандидатов никто не спрашивает', () => {
    render(<MergeExternalOrderButton orderId="ord-bitrix" />);

    expect(openDialog()).toBeNull();
    expect(actions.listMergeTargetsAction).not.toHaveBeenCalled();
  });

  it('кнопка открывает окно, объясняет последствия и подгружает кандидатов действием', async () => {
    const dialog = await open();

    expect(dialog.getByRole('heading', { name: 'Объединить с заказом из 1С' })).toBeTruthy();
    expect(dialog.getByText(/Сделка, документы, задачи и заметки перейдут/)).toBeTruthy();
    expect(actions.listMergeTargetsAction).toHaveBeenCalledWith('ord-bitrix');

    const list = await dialog.findByRole('list', { name: 'Заказы из 1С' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((li) => li.textContent)).toEqual([
      '2024-001 — Обучение по ОТ120000.00 ₽ · закрыт 13.09.2026',
      '2024-002 — Аттестация0.00 ₽',
    ]);
  });

  it('пока кандидаты не пришли — честная подпись, а не пустое место', async () => {
    actions.listMergeTargetsAction.mockReturnValue(new Promise(() => {}));

    const dialog = await open();

    expect(dialog.getByText('Ищем заказы этой организации…')).toBeTruthy();
    expect(dialog.queryByRole('list', { name: 'Заказы из 1С' })).toBeNull();
  });

  it('кандидатов нет — окно объясняет, что объединять не с чем; кнопка «Объединить» недоступна', async () => {
    actions.listMergeTargetsAction.mockResolvedValue({ ok: true, targets: [] });

    const dialog = await open();

    expect(
      await dialog.findByText('У этой организации нет заказов из 1С, с которыми можно объединить.')
    ).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Объединить' })).toHaveProperty('disabled', true);
  });

  it('отказ на чтении кандидатов переводится на русский и список показывается пустым', async () => {
    actions.listMergeTargetsAction.mockResolvedValue({ ok: false, error: 'not_bitrix_order' });

    const dialog = await open();

    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toBe(
        'Объединять можно только заказ, перенесённый из Битрикс24.'
      )
    );
    expect(
      dialog.getByText('У этой организации нет заказов из 1С, с которыми можно объединить.')
    ).toBeTruthy();
  });

  it('незнакомый код отказа показывается сам, а не немым окном', async () => {
    actions.listMergeTargetsAction.mockResolvedValue({ ok: false, error: 'boom' });

    const dialog = await open();

    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe('Ошибка: boom'));
  });

  it('выбор и подтверждение зовут действие с обоими заказами; успех закрывает окно и обновляет страницу', async () => {
    const dialog = await open('ord-bitrix');
    const list = await dialog.findByRole('list', { name: 'Заказы из 1С' });

    const radios = within(list).getAllByRole('radio');
    fireEvent.click(radios[1]!);
    expect(radios[1]).toHaveProperty('checked', true);
    expect(radios[0]).toHaveProperty('checked', false);

    fireEvent.click(dialog.getByRole('button', { name: 'Объединить' }));

    await waitFor(() =>
      expect(actions.mergeExternalOrderAction).toHaveBeenCalledWith({
        sourceOrderId: 'ord-bitrix',
        targetOrderId: 'o-1c-2',
      })
    );
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(toastMock.success).toHaveBeenCalledWith('Заказы объединены');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['forbidden', 'Объединять заказы могут администратор и руководитель.'],
    ['not_found', 'Заказ не найден.'],
    ['validation', 'Выберите заказ из 1С.'],
    ['same_order', 'Это один и тот же заказ.'],
    ['other_organization', 'Заказы принадлежат разным организациям.'],
    ['target_is_bitrix', 'Второй заказ тоже из Битрикс24 — выберите заказ из 1С.'],
    ['has_payments', 'На заказе из Битрикс24 есть оплаты — объединение отменено.'],
    ['has_lines', 'На заказе из Битрикс24 есть строки или слушатели — объединение отменено.'],
    ['has_activity', 'На заказе из Битрикс24 уже есть переписка или файлы — объединение отменено.'],
    ['target_has_deal', 'К заказу из 1С уже привязана другая сделка.'],
  ])('отказ %s показан русским текстом, окно остаётся открытым', async (error, text) => {
    actions.mergeExternalOrderAction.mockResolvedValue({ ok: false, error });

    const dialog = await open();
    const list = await dialog.findByRole('list', { name: 'Заказы из 1С' });
    fireEvent.click(within(list).getAllByRole('radio')[0]!);
    fireEvent.click(dialog.getByRole('button', { name: 'Объединить' }));

    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe(text));
    expect(openDialog()).not.toBeNull();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('пока идёт объединение — «Объединяем…», обе кнопки заблокированы', async () => {
    let finish: (v: unknown) => void = () => {};
    actions.mergeExternalOrderAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    const dialog = await open();
    const list = await dialog.findByRole('list', { name: 'Заказы из 1С' });
    fireEvent.click(within(list).getAllByRole('radio')[0]!);
    fireEvent.click(dialog.getByRole('button', { name: 'Объединить' }));

    await waitFor(() => expect(dialog.getByRole('button', { name: 'Объединяем…' })).toBeTruthy());
    expect(dialog.getByRole('button', { name: 'Отмена' })).toHaveProperty('disabled', true);

    await act(async () => {
      finish({ ok: true, moved: {} });
    });
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it('«Отмена» закрывает окно, ничего не объединяя', async () => {
    const dialog = await open();
    await dialog.findByRole('list', { name: 'Заказы из 1С' });

    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(actions.mergeExternalOrderAction).not.toHaveBeenCalled();
  });

  it('Escape закрывает окно так же, как «Отмена»', async () => {
    const dialog = await open();
    await dialog.findByRole('list', { name: 'Заказы из 1С' });

    fireEvent(openDialog() as HTMLElement, new Event('cancel', { cancelable: true }));

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(actions.mergeExternalOrderAction).not.toHaveBeenCalled();
  });

  it('ответ, пришедший после закрытия окна, не подставляет список задним числом', async () => {
    // Человек открыл, передумал и закрыл — ответ сервера прилетел в пустоту.
    // Без отмены он подставил бы список в следующее открытие и перезаписал
    // свежий запрос уже неактуальными кандидатами.
    let firstResolve: (v: unknown) => void = () => {};
    actions.listMergeTargetsAction
      .mockReturnValueOnce(
        new Promise((resolve) => {
          firstResolve = resolve;
        })
      )
      .mockReturnValueOnce(new Promise(() => {}));

    const dialog = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(openDialog()).toBeNull());

    await act(async () => {
      firstResolve({ ok: true, targets: TARGETS });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Это тот же заказ, что…' }));
    await waitFor(() => expect(openDialog()).not.toBeNull());
    const reopened = within(openDialog() as HTMLElement);
    expect(reopened.getByText('Ищем заказы этой организации…')).toBeTruthy();
    expect(reopened.queryByRole('list', { name: 'Заказы из 1С' })).toBeNull();
    expect(actions.listMergeTargetsAction).toHaveBeenCalledTimes(2);
  });

  it('без выбранного заказа подтверждение недоступно — действие не зовётся', async () => {
    const dialog = await open();
    await dialog.findByRole('list', { name: 'Заказы из 1С' });

    const submit = dialog.getByRole('button', { name: 'Объединить' });
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.click(submit);

    expect(actions.mergeExternalOrderAction).not.toHaveBeenCalled();
  });
});
