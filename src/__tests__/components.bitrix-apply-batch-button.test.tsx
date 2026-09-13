// @vitest-environment jsdom
/**
 * «Применить пакет» (этап 2 ТЗ 12.09.2026, `У-194`).
 *
 * Кнопка запускает запись сотен строк в рабочую базу, поэтому спрашивает
 * подтверждение и показывает число записей ДО нажатия. Проверяем: сколько
 * обещано — столько и написано, отказ сервера объяснён по-русски, успех
 * закрывает окно и перечитывает карточку, а при незаконченном сопоставлении
 * кнопка вовсе не нажимается.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({ applyBitrixBatchAction: vi.fn() }));
vi.mock('@/server-actions/admin/bitrix', () => actions);

import { ApplyBatchButton } from '@/components/bitrix/apply-batch-button';

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
  actions.applyBitrixBatchAction.mockResolvedValue({ ok: true });
});

function openDialog(): HTMLElement | null {
  return document.querySelector('dialog[open]');
}

async function open(props: Partial<React.ComponentProps<typeof ApplyBatchButton>> = {}) {
  render(<ApplyBatchButton batchId="b-1" total={1234} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  await waitFor(() => expect(openDialog()).not.toBeNull());
  return within(openDialog() as HTMLElement);
}

describe('ApplyBatchButton', () => {
  it('до нажатия окна нет', () => {
    render(<ApplyBatchButton batchId="b-1" total={7} />);
    expect(openDialog()).toBeNull();
  });

  it('подтверждение называет число записей и говорит про откат', async () => {
    const dialog = await open();

    expect(dialog.getByRole('heading', { name: 'Перенести данные из Битрикс24?' })).toBeTruthy();
    expect(dialog.getByText(/В личный кабинет будет записано записей: 1234/)).toBeTruthy();
    expect(dialog.getByText(/откатить в течение 30 дней/)).toBeTruthy();
    expect(actions.applyBitrixBatchAction).not.toHaveBeenCalled();
  });

  it('«Да, перенести» зовёт действие с пакетом; успех закрывает окно и перечитывает карточку', async () => {
    const dialog = await open({ batchId: 'b-77' });

    fireEvent.click(dialog.getByRole('button', { name: 'Да, перенести' }));

    await waitFor(() => expect(actions.applyBitrixBatchAction).toHaveBeenCalledWith('b-77'));
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('пока идёт запуск — «Запускаем…», обе кнопки заблокированы', async () => {
    let finish: (v: unknown) => void = () => {};
    actions.applyBitrixBatchAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    const dialog = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Да, перенести' }));

    await waitFor(() => expect(dialog.getByRole('button', { name: 'Запускаем…' })).toBeTruthy());
    expect(dialog.getByRole('button', { name: 'Отмена' })).toHaveProperty('disabled', true);

    await act(async () => {
      finish({ ok: true });
    });
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it.each([
    ['mapping_incomplete', 'Сначала сопоставьте все стадии сделок и статусы лидов.'],
    ['forbidden', 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.'],
    ['not_found', 'Пакет не найден — возможно, его удалили.'],
    ['invalid', 'Пакет уже применяется или применён.'],
  ])('отказ %s объяснён по-русски, окно остаётся открытым', async (error, text) => {
    actions.applyBitrixBatchAction.mockResolvedValue({ ok: false, error });

    const dialog = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Да, перенести' }));

    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe(text));
    expect(openDialog()).not.toBeNull();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('незнакомый код показывается сам — немого окна не остаётся', async () => {
    actions.applyBitrixBatchAction.mockResolvedValue({ ok: false, error: 'boom' });

    const dialog = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Да, перенести' }));

    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe('Ошибка: boom'));
  });

  it('«Отмена» закрывает окно, ничего не запуская', async () => {
    const dialog = await open();

    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(actions.applyBitrixBatchAction).not.toHaveBeenCalled();
  });

  it('Escape закрывает окно так же, как «Отмена»', async () => {
    await open();

    fireEvent(openDialog() as HTMLElement, new Event('cancel', { cancelable: true }));

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(actions.applyBitrixBatchAction).not.toHaveBeenCalled();
  });

  it('сопоставление не закончено (disabled): кнопка не нажимается и окно не открывается', async () => {
    render(<ApplyBatchButton batchId="b-1" total={12} disabled />);

    const button = screen.getByRole('button', { name: 'Применить' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);

    expect(openDialog()).toBeNull();
    expect(actions.applyBitrixBatchAction).not.toHaveBeenCalled();
  });
});
