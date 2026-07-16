// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { transitionOrderLifecycleAction, setOrderAccountingSignedAction } = vi.hoisted(() => ({
  transitionOrderLifecycleAction: vi.fn(),
  setOrderAccountingSignedAction: vi.fn()
}));
vi.mock('@/server-actions/manager/orderLifecycle', () => ({
  transitionOrderLifecycleAction,
  setOrderAccountingSignedAction
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { OrderLifecyclePanel } from '@/components/manager/order-lifecycle-panel';

const DIALOG_TITLE = 'Перевод в «Ждём клиента»';

function renderPanel(overrides: Partial<Parameters<typeof OrderLifecyclePanel>[0]> = {}) {
  return render(
    <OrderLifecyclePanel
      orderId='o1'
      status='new'
      accountingSigned={false}
      returnReason={null}
      {...overrides}
    />
  );
}

function transitionButtons(): string[] {
  return screen
    .queryAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) =>
      ['В работу', 'Ждём клиента', 'Завершить', 'Вернуть в работу', 'Переоткрыть'].includes(t)
    );
}

describe('OrderLifecyclePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  describe('рендер по статусам (локальная копия ALLOWED_TRANSITIONS)', () => {
    it('заголовок, бейдж текущего статуса и подпись-различение осей', () => {
      renderPanel({ status: 'new' });
      expect(screen.getByText('Жизненный цикл')).toBeTruthy();
      expect(screen.getByText('Новый')).toBeTruthy();
      expect(screen.getByText('Операционный статус — в блоке выше')).toBeTruthy();
    });

    it('new → только [В работу]', () => {
      renderPanel({ status: 'new' });
      expect(transitionButtons()).toEqual(['В работу']);
    });

    it('in_progress → [Ждём клиента][Завершить], бейдж «В работе»', () => {
      renderPanel({ status: 'in_progress' });
      expect(transitionButtons()).toEqual(['Ждём клиента', 'Завершить']);
      expect(screen.getByText('В работе')).toBeTruthy();
    });

    it('waiting_client → [Вернуть в работу], бейдж «Ждём клиента»', () => {
      renderPanel({ status: 'waiting_client' });
      expect(transitionButtons()).toEqual(['Вернуть в работу']);
      expect(screen.getByText('Ждём клиента')).toBeTruthy();
    });

    it('completed → [Переоткрыть], бейдж «Завершён»', () => {
      renderPanel({ status: 'completed' });
      expect(transitionButtons()).toEqual(['Переоткрыть']);
      expect(screen.getByText('Завершён')).toBeTruthy();
    });

    it('неизвестный статус: кнопок переходов нет, бейдж показывает сырой код', () => {
      // единственный каст: проверяем runtime forward-compat ветку `??` за пределами union-типа
      renderPanel({ status: 'cancelled' as never });
      expect(transitionButtons()).toEqual([]);
      expect(screen.getByText('cancelled')).toBeTruthy();
    });
  });

  describe('прямые переходы (без причины)', () => {
    it('«В работу» вызывает экшен {orderId, to:in_progress}; успех — success-тост', async () => {
      transitionOrderLifecycleAction.mockResolvedValue({ ok: true, changed: true, status: 'in_progress' });
      renderPanel({ status: 'new' });

      fireEvent.click(screen.getByRole('button', { name: 'В работу' }));

      await waitFor(() =>
        expect(transitionOrderLifecycleAction).toHaveBeenCalledWith({ orderId: 'o1', to: 'in_progress' })
      );
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Статус заказа обновлён'));
      expect(toastError).not.toHaveBeenCalled();
    });

    it('«Завершить» вызывает экшен {to:completed}; «Переоткрыть» — {to:in_progress}', async () => {
      transitionOrderLifecycleAction.mockResolvedValue({ ok: true, changed: true, status: 'completed' });
      const { unmount } = renderPanel({ status: 'in_progress' });
      fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
      await waitFor(() =>
        expect(transitionOrderLifecycleAction).toHaveBeenCalledWith({ orderId: 'o1', to: 'completed' })
      );
      unmount();

      renderPanel({ status: 'completed' });
      fireEvent.click(screen.getByRole('button', { name: 'Переоткрыть' }));
      await waitFor(() =>
        expect(transitionOrderLifecycleAction).toHaveBeenLastCalledWith({ orderId: 'o1', to: 'in_progress' })
      );
    });

    it('pending: кнопки переходов и чекбокс заблокированы до резолва экшена', async () => {
      let resolveAction!: (v: { ok: true; changed: boolean; status: string }) => void;
      transitionOrderLifecycleAction.mockImplementation(
        () => new Promise((r) => { resolveAction = r; })
      );
      renderPanel({ status: 'in_progress' });

      const complete = screen.getByRole('button', { name: 'Завершить' }) as HTMLButtonElement;
      const wait = screen.getByRole('button', { name: 'Ждём клиента' }) as HTMLButtonElement;
      const checkbox = screen.getByRole('checkbox', { name: 'Бухгалтерия подписана' }) as HTMLInputElement;
      fireEvent.click(complete);

      await waitFor(() => expect(complete.disabled).toBe(true));
      expect(wait.disabled).toBe(true);
      expect(checkbox.disabled).toBe(true);

      resolveAction({ ok: true, changed: true, status: 'completed' });
      await waitFor(() => expect(complete.disabled).toBe(false));
      expect(checkbox.disabled).toBe(false);
    });
  });

  describe('диалог причины для «Ждём клиента»', () => {
    it('клик открывает диалог; пустая/пробельная причина — submit disabled', async () => {
      renderPanel({ status: 'in_progress' });

      fireEvent.click(screen.getByRole('button', { name: 'Ждём клиента' }));
      const dialog = await screen.findByRole('dialog', { name: DIALOG_TITLE });
      const submit = within(dialog).getByRole('button', { name: 'Перевести' }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);

      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '   ' } });
      expect(submit.disabled).toBe(true);

      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'нет данных' } });
      expect(submit.disabled).toBe(false);
    });

    it('сабмит зовёт экшен с trimmed-причиной и закрывает диалог на успехе', async () => {
      transitionOrderLifecycleAction.mockResolvedValue({ ok: true, changed: true, status: 'waiting_client' });
      renderPanel({ status: 'in_progress' });

      fireEvent.click(screen.getByRole('button', { name: 'Ждём клиента' }));
      const dialog = await screen.findByRole('dialog', { name: DIALOG_TITLE });
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  клиент молчит  ' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Перевести' }));

      await waitFor(() =>
        expect(transitionOrderLifecycleAction).toHaveBeenCalledWith({
          orderId: 'o1',
          to: 'waiting_client',
          reason: 'клиент молчит'
        })
      );
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: DIALOG_TITLE })).toBeNull()
      );
      expect(toastSuccess).toHaveBeenCalledWith('Статус заказа обновлён');
    });

    it('повторное открытие сбрасывает причину; «Отмена» закрывает без вызова экшена', async () => {
      renderPanel({ status: 'in_progress' });

      fireEvent.click(screen.getByRole('button', { name: 'Ждём клиента' }));
      let dialog = await screen.findByRole('dialog', { name: DIALOG_TITLE });
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'черновик' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: DIALOG_TITLE })).toBeNull()
      );
      expect(transitionOrderLifecycleAction).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Ждём клиента' }));
      dialog = await screen.findByRole('dialog', { name: DIALOG_TITLE });
      expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    });

    it('Escape (cancel-событие <dialog>) закрывает через Dialog.onClose', async () => {
      renderPanel({ status: 'in_progress' });
      fireEvent.click(screen.getByRole('button', { name: 'Ждём клиента' }));
      const dialog = await screen.findByRole('dialog', { name: DIALOG_TITLE });
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: DIALOG_TITLE })).toBeNull()
      );
    });

    it('ошибка перехода из диалога (reason_required из центральной карты) — error-тост, диалог остаётся открыт', async () => {
      transitionOrderLifecycleAction.mockResolvedValue({ ok: false, error: 'reason_required' });
      renderPanel({ status: 'in_progress' });

      fireEvent.click(screen.getByRole('button', { name: 'Ждём клиента' }));
      const dialog = await screen.findByRole('dialog', { name: DIALOG_TITLE });
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'причина' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Перевести' }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Укажите причину.'));
      expect(screen.getByRole('dialog', { name: DIALOG_TITLE })).toBeTruthy();
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  describe('условия завершения (completion_conditions_unmet)', () => {
    it('рендерит aria-live список RU-лейблов по всем трём кодам', async () => {
      transitionOrderLifecycleAction.mockResolvedValue({
        ok: false,
        error: 'completion_conditions_unmet',
        unmet: ['documents_uploaded', 'accounting_signed', 'certificates_issued']
      });
      renderPanel({ status: 'in_progress' });

      fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));

      const region = await screen.findByTestId('completion-unmet');
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(within(region).getByText('Нет чистого документа')).toBeTruthy();
      expect(within(region).getByText('Бухгалтерия не подписана')).toBeTruthy();
      expect(within(region).getByText('Не выданы удостоверения')).toBeTruthy();
      expect(toastError).not.toHaveBeenCalled();
    });

    it('следующая успешная попытка очищает список', async () => {
      transitionOrderLifecycleAction.mockResolvedValueOnce({
        ok: false,
        error: 'completion_conditions_unmet',
        unmet: ['accounting_signed']
      });
      renderPanel({ status: 'in_progress' });

      const complete = screen.getByRole('button', { name: 'Завершить' }) as HTMLButtonElement;
      fireEvent.click(complete);
      await screen.findByText('Бухгалтерия не подписана');
      // список появляется ещё внутри transition — дожидаемся конца pending,
      // иначе второй клик придётся на disabled кнопку и станет no-op
      await waitFor(() => expect(complete.disabled).toBe(false));

      transitionOrderLifecycleAction.mockResolvedValueOnce({ ok: true, changed: true, status: 'completed' });
      fireEvent.click(complete);
      await waitFor(() => expect(screen.queryByText('Бухгалтерия не подписана')).toBeNull());
    });

    it('чекбокс «подписана» точечно убирает accounting_signed из unmet, остальные строки остаются', async () => {
      transitionOrderLifecycleAction.mockResolvedValueOnce({
        ok: false,
        error: 'completion_conditions_unmet',
        unmet: ['documents_uploaded', 'accounting_signed']
      });
      setOrderAccountingSignedAction.mockResolvedValue({ ok: true, changed: true });
      renderPanel({ status: 'in_progress', accountingSigned: false });

      fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
      await screen.findByText('Бухгалтерия не подписана');

      const checkbox = screen.getByRole('checkbox', { name: 'Бухгалтерия подписана' }) as HTMLInputElement;
      await waitFor(() => expect(checkbox.disabled).toBe(false));
      fireEvent.click(checkbox);

      await waitFor(() => expect(screen.queryByText('Бухгалтерия не подписана')).toBeNull());
      expect(screen.getByText('Нет чистого документа')).toBeTruthy();
    });
  });

  describe('ошибки переходов', () => {
    it('forbidden — локальная дельта «Нет доступа к этому заказу.» (центральный текст — про документы)', async () => {
      transitionOrderLifecycleAction.mockResolvedValue({ ok: false, error: 'forbidden' });
      renderPanel({ status: 'new' });

      fireEvent.click(screen.getByRole('button', { name: 'В работу' }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет доступа к этому заказу.'));
    });

    it('invalid_transition — текст центральной карты «Недопустимый переход.»', async () => {
      transitionOrderLifecycleAction.mockResolvedValue({ ok: false, error: 'invalid_transition' });
      renderPanel({ status: 'new' });

      fireEvent.click(screen.getByRole('button', { name: 'В работу' }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Недопустимый переход.'));
    });
  });

  describe('чекбокс «Бухгалтерия подписана»', () => {
    it('accountingSigned=false: клик зовёт экшен с signed:true; успех — success-тост', async () => {
      setOrderAccountingSignedAction.mockResolvedValue({ ok: true, changed: true });
      renderPanel({ status: 'in_progress', accountingSigned: false });

      const checkbox = screen.getByRole('checkbox', { name: 'Бухгалтерия подписана' }) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      fireEvent.click(checkbox);

      await waitFor(() =>
        expect(setOrderAccountingSignedAction).toHaveBeenCalledWith({ orderId: 'o1', signed: true })
      );
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Отметка бухгалтерии обновлена'));
    });

    it('accountingSigned=true: клик зовёт экшен с signed:false', async () => {
      setOrderAccountingSignedAction.mockResolvedValue({ ok: true, changed: true });
      renderPanel({ status: 'in_progress', accountingSigned: true });

      const checkbox = screen.getByRole('checkbox', { name: 'Бухгалтерия подписана' }) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
      fireEvent.click(checkbox);

      await waitFor(() =>
        expect(setOrderAccountingSignedAction).toHaveBeenCalledWith({ orderId: 'o1', signed: false })
      );
    });

    it('ошибка чекбокса уходит в resolveErrorText (not_found → центральная карта)', async () => {
      setOrderAccountingSignedAction.mockResolvedValue({ ok: false, error: 'not_found' });
      renderPanel({ status: 'in_progress' });

      fireEvent.click(screen.getByRole('checkbox', { name: 'Бухгалтерия подписана' }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Заказ не найден.'));
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('чекбокс disabled во время pending собственного экшена', async () => {
      let resolveAction!: (v: { ok: true; changed: boolean }) => void;
      setOrderAccountingSignedAction.mockImplementation(
        () => new Promise((r) => { resolveAction = r; })
      );
      renderPanel({ status: 'in_progress' });

      const checkbox = screen.getByRole('checkbox', { name: 'Бухгалтерия подписана' }) as HTMLInputElement;
      fireEvent.click(checkbox);

      await waitFor(() => expect(checkbox.disabled).toBe(true));
      resolveAction({ ok: true, changed: true });
      await waitFor(() => expect(checkbox.disabled).toBe(false));
    });
  });

  describe('причина возврата (returnReason)', () => {
    it('показывается только при status=waiting_client и непустой причине', () => {
      renderPanel({ status: 'waiting_client', returnReason: 'нет сканов договора' });
      expect(screen.getByText('нет сканов договора')).toBeTruthy();
      expect(screen.getByText('Причина ожидания:')).toBeTruthy();
    });

    it('не показывается при других статусах, даже если returnReason задан', () => {
      renderPanel({ status: 'in_progress', returnReason: 'устаревшая причина' });
      expect(screen.queryByText('устаревшая причина')).toBeNull();
    });

    it('не показывается при waiting_client без причины', () => {
      renderPanel({ status: 'waiting_client', returnReason: null });
      expect(screen.queryByText('Причина ожидания:')).toBeNull();
    });
  });
});
