// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));

const { toggleAutomationRuleAction, deleteAutomationRuleAction } = vi.hoisted(() => ({
  toggleAutomationRuleAction: vi.fn(),
  deleteAutomationRuleAction: vi.fn(),
}));
vi.mock('@/server-actions/admin/automationRules', () => ({
  toggleAutomationRuleAction,
  deleteAutomationRuleAction,
  createAutomationRuleAction: vi.fn(),
  updateAutomationRuleAction: vi.fn(),
}));

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

// Форма правила покрыта своим тестом — здесь она заглушка, чтобы экран
// проверялся отдельно от неё.
vi.mock('@/components/automation/automation-rule-form', () => ({
  AutomationRuleForm: (props: { rule: { id: string } | null }) =>
    React.createElement('div', { 'data-testid': 'rule-form' }, props.rule?.id ?? 'new'),
}));

import { AutomationScreen } from '@/components/automation/automation-screen';
import type { AutomationRuleView, AutomationRunView } from '@/lib/services/automation/rules';

/**
 * Раздел «Автоматизация» (`У-222`, `У-223`, `У-224`).
 *
 * Проверяется то, что видит человек: три вопроса §15, пустые состояния с
 * объяснением, отличие правила из коробки от своего и журнал, который называет
 * причину отказа, а не просто «не выполнено».
 */

function rule(over: Partial<AutomationRuleView> = {}): AutomationRuleView {
  return {
    id: 'r1',
    name: 'Счёт выставлен',
    isActive: false,
    isBuiltin: false,
    trigger: 'document_issued',
    triggerLabel: 'Документ выставлен',
    conditions: {},
    actions: [{ kind: 'create_task', titleTemplate: 'Проверить', assignee: 'responsible_manager' }],
    updatedAt: new Date('2026-09-15'),
    runsTotal: 0,
    lastRunAt: null,
    lastRunStatus: null,
    ...over,
  };
}

const COMPANIES = [{ id: 'co-1', name: 'Промтехносфера' }];

beforeEach(() => {
  vi.clearAllMocks();
  toggleAutomationRuleAction.mockResolvedValue({ ok: true });
  deleteAutomationRuleAction.mockResolvedValue({ ok: true });
});

describe('AutomationScreen — три вопроса и пустые состояния', () => {
  it('отвечает на «где я», «что здесь» и «что дальше» (§15)', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    expect(screen.getByRole('heading', { name: 'Автоматизация' })).toBeTruthy();
    expect(screen.getByText(/если случилось событие/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Новое правило' })).toBeTruthy();
  });

  it('правил нет — объясняет, зачем раздел, и даёт кнопку (`У-74`)', () => {
    render(
      <AutomationScreen cabinet="leader" companyId="co-1" companies={[]} rules={[]} runs={[]} />
    );
    expect(screen.getByText('Правил пока нет')).toBeTruthy();
    expect(screen.getByText(/счёт выставлен — через пять дней/i)).toBeTruthy();
  });

  it('у руководителя без компании — объяснение, а не пустой список правил', () => {
    render(
      <AutomationScreen cabinet="leader" companyId={null} companies={[]} rules={[]} runs={[]} />
    );
    expect(screen.getByText('Компания не определена')).toBeTruthy();
    // Главной кнопки нет: нажимать её было бы некуда.
    expect(screen.queryByRole('button', { name: '+ Новое правило' })).toBeNull();
  });

  it('администратор выбирает компанию; без выбора — подсказка', () => {
    render(
      <AutomationScreen
        cabinet="admin"
        companyId={null}
        companies={COMPANIES}
        rules={[]}
        runs={[]}
      />
    );
    expect(screen.getByLabelText('Компания')).toBeTruthy();
    expect(screen.getByText('Компания не выбрана')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Компания'), { target: { value: 'co-1' } });
    expect(push).toHaveBeenCalledWith('/admin/settings/processes/automation?companyId=co-1');
  });

  it('у руководителя выбора компании нет вовсе', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    expect(screen.queryByLabelText('Компания')).toBeNull();
  });
});

describe('AutomationScreen — правила', () => {
  it('показывает «если … то …» человеческими словами', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    expect(screen.getByText(/Если: Документ выставлен\. То: создать задачу\./)).toBeTruthy();
    expect(screen.getByText('Ещё не срабатывало')).toBeTruthy();
  });

  it('ПРАВИЛО ИЗ КОРОБКИ помечено и не имеет кнопки «Удалить»', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule({ isBuiltin: true })]}
        runs={[]}
      />
    );
    expect(screen.getByText('Из коробки')).toBeTruthy();
    // Его выключают, а не удаляют: иначе набор правил у компаний разошёлся бы.
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Включить' })).toBeTruthy();
  });

  it('включение уходит на сервер и обновляет экран', async () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Включить' }));
    await waitFor(() => expect(toggleAutomationRuleAction).toHaveBeenCalled());
    expect(toggleAutomationRuleAction).toHaveBeenCalledWith('leader', 'co-1', 'r1', true);
    expect(refresh).toHaveBeenCalled();
  });

  it('включённое правило предлагает выключить', async () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule({ isActive: true, runsTotal: 2, lastRunAt: new Date('2026-09-14') })]}
        runs={[]}
      />
    );
    expect(screen.getByText('Включено')).toBeTruthy();
    expect(screen.getByText(/Срабатывало 2 раз/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Выключить' }));
    await waitFor(() =>
      expect(toggleAutomationRuleAction).toHaveBeenCalledWith('leader', 'co-1', 'r1', false)
    );
  });

  it('отказ сервера показывается по-русски и экран не обновляется', async () => {
    toggleAutomationRuleAction.mockResolvedValue({ ok: false, error: 'company_required' });
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Включить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('удаление СПРАШИВАЕТ подтверждение', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(confirm).toHaveBeenCalled();
    // Отказались — ничего не произошло.
    expect(deleteAutomationRuleAction).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(deleteAutomationRuleAction).toHaveBeenCalled());
    confirm.mockRestore();
  });

  it('«Изменить» открывает форму с этим правилом, «Новое» — пустую', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(screen.getByTestId('rule-form').textContent).toBe('r1');
  });
});

describe('AutomationScreen — журнал срабатываний', () => {
  const run = (over: Partial<AutomationRunView> = {}): AutomationRunView => ({
    id: 'run1',
    at: new Date('2026-09-15T10:00:00Z'),
    ruleName: 'Счёт выставлен',
    status: 'ok',
    error: null,
    createdTasks: 1,
    notified: 0,
    ...over,
  });

  it('пусто — объясняет, что здесь появится', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    expect(screen.getByText(/Срабатываний пока не было/)).toBeTruthy();
  });

  it('успех показывает, что именно сделано', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[run()]}
      />
    );
    expect(screen.getByText('Выполнено')).toBeTruthy();
    expect(screen.getByText('задач: 1')).toBeTruthy();
  });

  it('ОТКАЗ называет причину, а не просто «не выполнено»', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[run({ status: 'failed', error: 'у объекта нет ответственного менеджера' })]}
      />
    );
    expect(screen.getByText('Не выполнено')).toBeTruthy();
    expect(screen.getByText('у объекта нет ответственного менеджера')).toBeTruthy();
  });

  it('незнакомый статус показывается как есть, а не пустотой', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[run({ status: 'что-то новое' })]}
      />
    );
    expect(screen.getByText('что-то новое')).toBeTruthy();
  });
});
