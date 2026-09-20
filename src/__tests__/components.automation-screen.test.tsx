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
  // Форму подменяем, но её ДВА выхода оставляем настоящими кнопками: экран
  // обязан на них отреагировать — закрыть окно и обновить список. Заглушка без
  // выходов делала бы вид, что этих обязанностей нет.
  AutomationRuleForm: (props: {
    rule: { id: string } | null;
    onClose: () => void;
    onSaved: () => void;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'rule-form' },
      props.rule?.id ?? 'new',
      React.createElement('button', { type: 'button', onClick: props.onClose }, 'стоп-закрыть'),
      React.createElement('button', { type: 'button', onClick: props.onSaved }, 'стоп-сохранено')
    ),
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

    // Кнопка на пустом экране обязана РАБОТАТЬ, а не просто быть нарисованной:
    // это единственный вход в раздел, пока правил нет (`У-74`).
    const buttons = screen.getAllByRole('button', { name: '+ Новое правило' });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(screen.getByTestId('rule-form').textContent).toContain('new');
  });

  it('счётчик срабатываний без даты последнего — прочерк, а не «Invalid Date»', () => {
    // Строки прежних версий помнят число запусков, но не момент последнего.
    // `new Date(null)` дал бы «01.01.1970», и человек решил бы, что правило
    // не работает с семидесятого года.
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule({ isActive: true, runsTotal: 5, lastRunAt: null })]}
        runs={[]}
      />
    );
    expect(screen.getByText(/Срабатывало 5 раз, последний — —/)).toBeTruthy();
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
    expect(screen.getByTestId('rule-form').textContent).toContain('r1');
  });

  it('«Новое правило» открывает ПУСТУЮ форму, а не форму последнего правила', () => {
    // Окно переиспользуется, поэтому у него свой ключ: без него React показал
    // бы в «новом» правиле поля предыдущего.
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Новое правило' }));
    expect(screen.getByTestId('rule-form').textContent).toContain('new');
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

describe('AutomationScreen — отказ удаления и подписи действий', () => {
  it('удаление не удалось — человек видит причину, список не перерисовывается', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteAutomationRuleAction.mockResolvedValue({ ok: false, error: 'builtin_readonly' });
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
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('правило без действий подписано словами, а не пустой строкой', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule({ actions: [] })]}
        runs={[]}
      />
    );
    expect(screen.getByText(/действие не задано/)).toBeTruthy();
  });

  it('«написать клиенту» названо своим словом — это самое заметное действие робота', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[
          rule({
            actions: [
              { kind: 'send_message', channel: 'email', template: 'Здравствуйте' },
              { kind: 'notify', audience: 'role:leader', template: 'Смотри' },
            ],
          }),
        ]}
        runs={[]}
      />
    );
    expect(screen.getByText(/написать клиенту/)).toBeTruthy();
    expect(screen.getByText(/сообщить сотруднику/)).toBeTruthy();
  });
});

describe('AutomationScreen — выходы формы', () => {
  it('сохранение закрывает окно и обновляет список', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'стоп-сохранено' }));
    await waitFor(() => expect(screen.queryByTestId('rule-form')).toBeNull());
    expect(refresh).toHaveBeenCalled();
  });

  it('закрытие окна список НЕ обновляет — обновлять нечего', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'стоп-закрыть' }));
    expect(screen.queryByTestId('rule-form')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('AutomationScreen — выбор компании и подписи журнала', () => {
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

  it('администратор выбирает компанию — адрес меняется, выбор снимается — возвращается к чистому', () => {
    render(
      <AutomationScreen
        cabinet="admin"
        companyId={null}
        companies={[{ id: 'co-1', name: 'Альфа' }]}
        rules={[]}
        runs={[]}
      />
    );
    const select = screen.getByLabelText('Компания');
    fireEvent.change(select, { target: { value: 'co-1' } });
    expect(push).toHaveBeenCalledWith(expect.stringContaining('companyId=co-1'));

    push.mockClear();
    fireEvent.change(select, { target: { value: '' } });
    // Пустой выбор ведёт на тот же раздел БЕЗ хвоста — иначе в адресе осталась
    // бы пустая строка и экран считал бы её выбранной компанией.
    expect(push).toHaveBeenCalledWith(expect.not.stringContaining('companyId='));
  });

  it('срабатывание без даты и без последствий подписано словами', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule({ lastRunAt: null })]}
        runs={[run({ createdTasks: 0, notified: 0 })]}
      />
    );
    // Правило ещё ни разу не срабатывало: вместо даты — прочерк, а не пустота.
    expect(document.body.textContent).toContain('—');
    expect(screen.getByText(/без изменений/)).toBeTruthy();
  });

  it('срабатывание с уведомлениями называет их число', () => {
    render(
      <AutomationScreen
        cabinet="leader"
        companyId="co-1"
        companies={[]}
        rules={[rule()]}
        runs={[run({ createdTasks: 0, notified: 3 })]}
      />
    );
    expect(screen.getByText(/уведомлений: 3/)).toBeTruthy();
  });
});
