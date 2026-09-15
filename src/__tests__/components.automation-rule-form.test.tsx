// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react';

const { createAutomationRuleAction, updateAutomationRuleAction } = vi.hoisted(() => ({
  createAutomationRuleAction: vi.fn(),
  updateAutomationRuleAction: vi.fn(),
}));
vi.mock('@/server-actions/admin/automationRules', () => ({
  createAutomationRuleAction,
  updateAutomationRuleAction,
}));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { AutomationRuleForm } from '@/components/automation/automation-rule-form';
import type { AutomationRuleView } from '@/lib/services/automation/rules';

/**
 * Форма правила (`У-222`).
 *
 * Главное здесь — **предпросмотр**. Человек пишет `{{document.number}}`, а
 * должен увидеть готовую фразу: без этого узнать, что получится, можно было бы
 * только дождавшись настоящего срабатывания робота.
 *
 * Второе — понятный отказ. «Ошибка сохранения» без указания, что именно не так,
 * отправила бы человека гадать; неизвестную подстановку называем поимённо.
 */

beforeEach(() => {
  vi.clearAllMocks();
  createAutomationRuleAction.mockResolvedValue({ ok: true, id: 'r1' });
  updateAutomationRuleAction.mockResolvedValue({ ok: true, id: 'r1' });
  // Нативный <dialog> в jsdom не открывается сам.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

function open(rule: AutomationRuleView | null = null) {
  return render(
    <AutomationRuleForm
      cabinet="leader"
      companyId="co-1"
      rule={rule}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );
}

const dialog = () => within(document.querySelector('dialog[open]') as HTMLElement);

describe('AutomationRuleForm — предпросмотр', () => {
  it('до текста — приглашение, а не пустое место', () => {
    open();
    expect(dialog().getByTestId('automation-preview').textContent).toContain('Напишите текст');
  });

  it('ПОДСТАВЛЯЕТ пример данных: человек видит фразу, а не фигурные скобки', () => {
    open();
    fireEvent.change(dialog().getByLabelText('Текст правила'), {
      target: { value: 'Проверить оплату по счёту {{document.number}}' },
    });
    const preview = dialog().getByTestId('automation-preview').textContent ?? '';
    expect(preview).toContain('Проверить оплату по счёту');
    expect(preview).not.toContain('{{');
  });

  it('список доступных подстановок — по-русски', () => {
    open();
    expect(dialog().getByText(/номер документа/)).toBeTruthy();
  });
});

describe('AutomationRuleForm — сохранение', () => {
  it('новое правило уходит с событием, текстом и сроком', async () => {
    open();
    fireEvent.change(dialog().getByLabelText('Название правила'), {
      target: { value: 'Счёт выставлен' },
    });
    fireEvent.change(dialog().getByLabelText('Текст правила'), {
      target: { value: 'Проверить оплату по счёту {{document.number}}' },
    });
    fireEvent.change(dialog().getByLabelText('Срок в днях'), { target: { value: '5' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(createAutomationRuleAction).toHaveBeenCalled());
    const [, companyId, input] = createAutomationRuleAction.mock.calls[0];
    expect(companyId).toBe('co-1');
    expect(input.name).toBe('Счёт выставлен');
    expect(input.trigger).toBe('document_issued');
    expect(input.actions[0]).toMatchObject({
      kind: 'create_task',
      assignee: 'responsible_manager',
      dueInDays: 5,
    });
    // Правило создаётся выключенным — человек об этом узнаёт сразу.
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('выключено'));
  });

  it('без срока поле просто не отправляется', async () => {
    open();
    fireEvent.change(dialog().getByLabelText('Название правила'), { target: { value: 'Правило' } });
    fireEvent.change(dialog().getByLabelText('Текст правила'), { target: { value: 'Дело' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(createAutomationRuleAction).toHaveBeenCalled());
    expect(createAutomationRuleAction.mock.calls[0][2].actions[0].dueInDays).toBeUndefined();
  });

  it('НЕИЗВЕСТНАЯ ПОДСТАНОВКА названа поимённо, а не «ошибкой сохранения»', async () => {
    createAutomationRuleAction.mockResolvedValue({
      ok: false,
      error: 'unknown_placeholder',
      unknown: ['order.nomer'],
    });
    open();
    fireEvent.change(dialog().getByLabelText('Название правила'), { target: { value: 'Правило' } });
    fireEvent.change(dialog().getByLabelText('Текст правила'), {
      target: { value: 'Счёт {{order.nomer}}' },
    });
    fireEvent.click(dialog().getByRole('button', { name: 'Сохранить' }));
    // Ищем именно СООБЩЕНИЕ формы: тот же текст есть и в поле ввода, где
    // человек его написал.
    await waitFor(() =>
      expect(dialog().getByRole('alert').textContent).toContain('{{order.nomer}}')
    );
  });

  it('действие «написать клиенту» ПРЕДУПРЕЖДАЕТ и убирает выбор получателя', () => {
    open();
    expect(dialog().getByLabelText('Кому')).toBeTruthy();
    fireEvent.change(dialog().getByLabelText('Действие'), { target: { value: 'send_message' } });
    expect(dialog().getByText(/без участия менеджера/i)).toBeTruthy();
    // Получателя выбирать не нужно — адресат клиент, а не сотрудник.
    expect(dialog().queryByLabelText('Кому')).toBeNull();
    // И срока у сообщения нет.
    expect(dialog().queryByLabelText('Срок в днях')).toBeNull();
  });

  it('уведомление сотруднику отправляется как notify, без срока', async () => {
    open();
    fireEvent.change(dialog().getByLabelText('Название правила'), {
      target: { value: 'Сообщить' },
    });
    fireEvent.change(dialog().getByLabelText('Действие'), { target: { value: 'notify' } });
    fireEvent.change(dialog().getByLabelText('Кому'), { target: { value: 'role:leader' } });
    fireEvent.change(dialog().getByLabelText('Текст правила'), {
      target: { value: 'Смотри почту' },
    });
    fireEvent.click(dialog().getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(createAutomationRuleAction).toHaveBeenCalled());
    expect(createAutomationRuleAction.mock.calls[0][2].actions[0]).toEqual({
      kind: 'notify',
      audience: 'role:leader',
      template: 'Смотри почту',
    });
  });

  it('правка существующего правила подставляет его значения и зовёт update', async () => {
    const rule: AutomationRuleView = {
      id: 'r1',
      name: 'Старое имя',
      isActive: true,
      isBuiltin: true,
      trigger: 'proposal_no_answer',
      triggerLabel: 'КП без ответа',
      conditions: {},
      actions: [
        {
          kind: 'create_task',
          titleTemplate: 'Позвонить по КП {{document.number}}',
          assignee: 'role:leader',
          dueInDays: 1,
        },
      ],
      updatedAt: new Date(),
      runsTotal: 0,
      lastRunAt: null,
      lastRunStatus: null,
    };
    open(rule);
    expect((dialog().getByLabelText('Название правила') as HTMLInputElement).value).toBe(
      'Старое имя'
    );
    expect((dialog().getByLabelText('Событие') as HTMLSelectElement).value).toBe(
      'proposal_no_answer'
    );
    fireEvent.click(dialog().getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(updateAutomationRuleAction).toHaveBeenCalled());
    // Правило из коробки править МОЖНО — текст правится (`У-224`).
    expect(updateAutomationRuleAction.mock.calls[0][2]).toBe('r1');
  });
});
