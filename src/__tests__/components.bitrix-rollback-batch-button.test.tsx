// @vitest-environment jsdom
/**
 * «Откатить пакет» (этап 2 ТЗ 12.09.2026, `У-196`).
 *
 * Откат удаляет записи, которые перенос уже положил в рабочую базу, поэтому
 * кнопка обязана сделать две вещи. Первая — спросить подтверждение и сказать
 * словами, что именно исчезнет, а что останется на месте. Вторая — когда
 * откатывать нельзя, быть неактивной И назвать причину: «нельзя» без причины —
 * дефект приёмки (§15), человек жмёт мёртвую кнопку и не понимает, что не так.
 *
 * Харнесс — как у «Применить» (components.bitrix-apply-batch-button): jsdom не
 * умеет нативный showModal, поэтому его подменяем, а всегда смонтированное окно
 * ищем через `dialog[open]` + `within()`.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({ rollbackBitrixBatchAction: vi.fn() }));
vi.mock('@/server-actions/admin/bitrix', () => actions);

import { RollbackBatchButton } from '@/components/bitrix/rollback-batch-button';
import type { RollbackState } from '@/lib/services/bitrix/rollback';

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
  actions.rollbackBitrixBatchAction.mockResolvedValue({ ok: true });
});

function openDialog(): HTMLElement | null {
  return document.querySelector('dialog[open]');
}

function mount(props: Partial<React.ComponentProps<typeof RollbackBatchButton>> = {}) {
  return render(<RollbackBatchButton batchId="b-1" state="available" hint="" {...props} />);
}

function rollbackButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Откатить' }) as HTMLButtonElement;
}

async function open(props: Partial<React.ComponentProps<typeof RollbackBatchButton>> = {}) {
  mount(props);
  fireEvent.click(rollbackButton());
  await waitFor(() => expect(openDialog()).not.toBeNull());
  return within(openDialog() as HTMLElement);
}

/** Все четыре причины «откатить нельзя» вместе с текстом, который видит человек. */
const BLOCKED: [RollbackState, string][] = [
  ['not_applied', 'Пакет ещё не применён — возвращать нечего.'],
  ['rolled_back', 'Этот пакет уже откачен.'],
  ['expired', 'Откат возможен 30 дней после применения — срок вышел.'],
  ['nothing_to_revert', 'Применение не записало ни одной строки.'],
];

describe('RollbackBatchButton — когда можно и когда нельзя', () => {
  it('откат доступен: кнопка нажимается, подсказки-причины нет, окно закрыто', () => {
    mount({ state: 'available', hint: '' });

    const button = rollbackButton();
    expect(button).toHaveProperty('disabled', false);
    // Подсказка на живой кнопке была бы враньём: причины «нельзя» нет.
    expect(button.getAttribute('title')).toBeNull();
    expect(openDialog()).toBeNull();
  });

  it.each(BLOCKED)('состояние %s: кнопка неактивна и несёт причину', (state, hint) => {
    mount({ state, hint });

    const button = rollbackButton();
    expect(button).toHaveProperty('disabled', true);
    // §15: «нельзя» обязано объяснить себя, иначе человек жмёт мёртвую кнопку.
    expect(button.getAttribute('title')).toBe(hint);

    fireEvent.click(button);
    expect(openDialog()).toBeNull();
    expect(actions.rollbackBitrixBatchAction).not.toHaveBeenCalled();
  });

  it('кнопку строки видно по её пакету — список рисует по одной на строку', () => {
    mount({ batchId: 'b-77' });
    expect(screen.getByTestId('bitrix-rollback-b-77')).toBeTruthy();
  });
});

describe('RollbackBatchButton — подтверждение', () => {
  it('окно говорит, что удалится, что вернётся и что останется на месте', async () => {
    const dialog = await open();

    expect(dialog.getByRole('heading', { name: 'Откатить перенос?' })).toBeTruthy();
    expect(dialog.getByText(/Записи, созданные этим пакетом, будут удалены/)).toBeTruthy();
    expect(dialog.getByText(/изменённые — возвращены к прежним значениям/)).toBeTruthy();
    // Главный страх человека: «а моя работа после переноса?» — отвечаем сразу.
    expect(dialog.getByText(/Всё, что появилось после переноса, останется на месте/)).toBeTruthy();
    expect(dialog.getByText(/попадут в отчёт сверки со своей причиной/)).toBeTruthy();

    expect(dialog.getByRole('button', { name: 'Да, откатить' })).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Отмена' })).toBeTruthy();
    // Пока не подтвердили — ничего не запускается.
    expect(actions.rollbackBitrixBatchAction).not.toHaveBeenCalled();
  });

  it('«Отмена» закрывает окно, ничего не запуская', async () => {
    const dialog = await open();

    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(actions.rollbackBitrixBatchAction).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

describe('RollbackBatchButton — запуск отката', () => {
  it('«Да, откатить» зовёт действие с пакетом; успех закрывает окно и перечитывает экран', async () => {
    const dialog = await open({ batchId: 'b-42' });

    fireEvent.click(dialog.getByRole('button', { name: 'Да, откатить' }));

    await waitFor(() => expect(actions.rollbackBitrixBatchAction).toHaveBeenCalledWith('b-42'));
    await waitFor(() => expect(openDialog()).toBeNull());
    // Без перечитывания состояние пакета на экране осталось бы старым.
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('пока идёт запуск — «Запускаем…», обе кнопки заблокированы', async () => {
    let finish: (v: unknown) => void = () => {};
    actions.rollbackBitrixBatchAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    const dialog = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Да, откатить' }));

    // Двойное нажатие завело бы откат дважды — обе кнопки на время запроса мертвы.
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Запускаем…' })).toHaveProperty('disabled', true)
    );
    expect(dialog.getByRole('button', { name: 'Отмена' })).toHaveProperty('disabled', true);
    expect(dialog.queryByRole('button', { name: 'Да, откатить' })).toBeNull();

    await act(async () => {
      finish({ ok: true });
    });
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it.each([
    ['expired', 'Откат возможен 30 дней после применения — срок вышел.'],
    ['rolled_back', 'Этот пакет уже откачен.'],
    ['not_applied', 'Пакет ещё не применён — возвращать нечего.'],
    ['nothing_to_revert', 'Применение не записало ни одной строки.'],
    ['forbidden', 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.'],
    ['not_found', 'Пакет не найден — возможно, его удалили.'],
  ])('отказ %s объяснён по-русски, окно остаётся открытым', async (error, text) => {
    actions.rollbackBitrixBatchAction.mockResolvedValue({ ok: false, error });

    const dialog = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Да, откатить' }));

    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe(text));
    // Окно не закрываем: человек должен прочитать причину, а не гадать.
    expect(openDialog()).not.toBeNull();
    expect(nav.refresh).not.toHaveBeenCalled();
    // Кнопки снова живые — можно закрыть или попробовать ещё раз.
    expect(dialog.getByRole('button', { name: 'Да, откатить' })).toHaveProperty('disabled', false);
  });

  it('незнакомый код показывается сам — немого окна не остаётся', async () => {
    actions.rollbackBitrixBatchAction.mockResolvedValue({ ok: false, error: 'boom' });

    const dialog = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Да, откатить' }));

    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe('Ошибка: boom'));
  });
});
