// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));

const { claimIntakeAction, closeCallIntakeAction } = vi.hoisted(() => ({
  claimIntakeAction: vi.fn(),
  closeCallIntakeAction: vi.fn(),
}));
vi.mock('@/server-actions/intake', () => ({ claimIntakeAction, closeCallIntakeAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { leadDialogSpy, taskDialogSpy } = vi.hoisted(() => ({
  leadDialogSpy: vi.fn(),
  taskDialogSpy: vi.fn(),
}));
vi.mock('@/components/intake/create-lead-from-source-dialog', () => ({
  CreateLeadFromSourceDialog: (props: { kind: string; sourceId: string; onClose: () => void }) => {
    leadDialogSpy(props);
    return React.createElement('div', { 'data-testid': 'lead-dialog-stub' });
  },
}));
vi.mock('@/components/intake/quick-task-dialog', () => ({
  QuickTaskDialog: (props: { titlePrefill: string; onClose: () => void }) => {
    taskDialogSpy(props);
    return React.createElement('div', { 'data-testid': 'task-dialog-stub' });
  },
}));

import { IntakeTable, waitingLabel, sourceHref } from '@/components/intake/intake-table';
import type { IntakeItem } from '@/lib/services/intake/list';

function item(over: Partial<IntakeItem>): IntakeItem {
  return {
    type: 'client_request',
    id: 'x1',
    from: 'ООО Ромашка',
    essence: 'Обучение',
    createdAt: new Date('2026-07-26T00:00:00Z'),
    waitingMs: 60_000,
    slaLevel: 'ok',
    responsibleUserId: null,
    responsibleName: null,
    href: '/requests',
    leadPrefill: null,
    taskTitle: 'Обращение клиента: Обучение',
    organizationId: null,
    ...over,
  };
}

const fetchMock = vi.fn();

describe('helpers', () => {
  it('waitingLabel: минуты → часы → дни', () => {
    expect(waitingLabel(5 * 60_000)).toBe('5 мин');
    expect(waitingLabel(5 * 3_600_000)).toBe('5 ч');
    expect(waitingLabel(72 * 3_600_000)).toBe('3 дн');
  });

  it('sourceHref: inbox/calls всегда в кабинете менеджера, остальное — по роли зрителя', () => {
    expect(sourceHref('inbound', '/leader')).toBe('/manager/inbox');
    expect(sourceHref('call', '/admin')).toBe('/manager/calls');
    expect(sourceHref('enrollment', '/leader')).toBe('/leader/enrollments');
    expect(sourceHref('client_request', '/admin')).toBe('/admin/requests');
  });
});

describe('IntakeTable', () => {
  beforeEach(() => {
    refresh.mockReset();
    push.mockReset();
    claimIntakeAction.mockReset();
    closeCallIntakeAction.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    leadDialogSpy.mockReset();
    taskDialogSpy.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('пустое состояние «Всё разобрано»', () => {
    render(<IntakeTable items={[]} viewerPrefix="/manager" currentUserId="m1" />);
    expect(screen.getByText('Всё разобрано')).toBeTruthy();
  });

  it('строка: тип, от кого, суть, ожидание, «нет» ответственного, действия', () => {
    render(
      <IntakeTable
        items={[item({ slaLevel: 'breach', waitingMs: 30 * 3_600_000 })]}
        viewerPrefix="/manager"
        currentUserId="m1"
      />
    );
    expect(screen.getByText('Заявка клиента')).toBeTruthy();
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    expect(screen.getByText('30 ч')).toBeTruthy();
    expect(screen.getByText('нет')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Взять в работу' })).toBeTruthy();
    expect(screen.getByText('Открыть →')).toBeTruthy();
  });

  it('«Взять в работу» вызывает claim с типом и id; успех → toast + refresh', async () => {
    claimIntakeAction.mockResolvedValue({ ok: true });
    render(
      <IntakeTable
        items={[item({ type: 'inbound', id: 'i1', leadPrefill: null })]}
        viewerPrefix="/manager"
        currentUserId="m1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(claimIntakeAction).toHaveBeenCalled());
    const fd = claimIntakeAction.mock.calls[0]![0] as FormData;
    expect(fd.get('type')).toBe('inbound');
    expect(fd.get('id')).toBe('i1');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('ошибка claim → русский toast; already_assigned мапится', async () => {
    claimIntakeAction.mockResolvedValue({ ok: false, error: 'already_assigned' });
    render(<IntakeTable items={[item({})]} viewerPrefix="/manager" currentUserId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Уже взято другим сотрудником.'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('отказ claim без кода ошибки → общий русский текст', async () => {
    claimIntakeAction.mockResolvedValue({ ok: false });
    render(<IntakeTable items={[item({})]} viewerPrefix="/manager" currentUserId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось выполнить действие.'));
  });

  it('незнакомый код ошибки claim → общий русский текст', async () => {
    // Словарь понятных сообщений не покрывает будущие коды. Пользователь должен
    // увидеть осмысленную фразу, а не пустой toast.
    claimIntakeAction.mockResolvedValue({ ok: false, error: 'quota_exceeded' });
    render(<IntakeTable items={[item({})]} viewerPrefix="/manager" currentUserId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось выполнить действие.'));
  });

  it('ответственный назначен, но имя ещё не подгрузилось → многоточие вместо «нет»', () => {
    // Имя приходит отдельным запросом. Пока его нет, показываем «…», иначе
    // сотрудник решит, что единица свободна, и возьмёт чужую.
    render(
      <IntakeTable
        items={[item({ responsibleUserId: 'm9', responsibleName: null })]}
        viewerPrefix="/manager"
        currentUserId="m1"
      />
    );
    expect(screen.getByText('…')).toBeTruthy();
  });

  it('у взятой единицы кнопки claim нет; отмечен «(вы)» для своей', () => {
    render(
      <IntakeTable
        items={[item({ responsibleUserId: 'm1', responsibleName: 'Я' })]}
        viewerPrefix="/manager"
        currentUserId="m1"
      />
    );
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
    expect(screen.getByText('(вы)')).toBeTruthy();
  });

  it('client_request: «Создать лид» дергает PATCH API и уводит на карточку лида', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ leadId: 'lead-9' }) });
    render(<IntakeTable items={[item({ id: 'r1' })]} viewerPrefix="/manager" currentUserId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/client-requests/r1',
        expect.objectContaining({ method: 'PATCH' })
      )
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/manager/leads/lead-9'));
  });

  it('client_request: ответ без leadId → просто обновление списка, без перехода', async () => {
    // Сервер может не вернуть id лида (например, обращение уже было
    // сконвертировано). Тогда правильнее обновить список, чем уводить в никуда.
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    render(<IntakeTable items={[item({ id: 'r1' })]} viewerPrefix="/manager" currentUserId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it('client_request: ошибка API → toast без перехода', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<IntakeTable items={[item({ id: 'r1' })]} viewerPrefix="/manager" currentUserId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it('inbound/call: «Создать лид» открывает диалог с префиллом', () => {
    const prefill = {
      companyName: '',
      contactName: '+7999',
      contactPhone: '+7999',
      contactEmail: '',
      subject: 'Входящий звонок',
    };
    render(
      <IntakeTable
        items={[item({ type: 'call', id: 'c1', leadPrefill: prefill })]}
        viewerPrefix="/manager"
        currentUserId="m1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    expect(screen.getByTestId('lead-dialog-stub')).toBeTruthy();
    expect(leadDialogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'call', sourceId: 'c1' })
    );
  });

  it('обращение (не звонок): диалог лида открывается с типом inbound', () => {
    // Тип источника определяет, каким сервисом создаётся лид. Перепутать их
    // нельзя: лид уедет к другому источнику и обращение останется неразобранным.
    const prefill = {
      companyName: 'ООО Ромашка',
      contactName: 'Иван',
      contactPhone: '',
      contactEmail: 'i@x.ru',
      subject: 'Вопрос',
    };
    render(
      <IntakeTable
        items={[item({ type: 'inbound', id: 'i1', leadPrefill: prefill })]}
        viewerPrefix="/manager"
        currentUserId="m1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    expect(leadDialogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inbound', sourceId: 'i1' })
    );
  });

  it('закрытие диалогов снимает их с экрана', async () => {
    // Диалоги монтируются условно. Если бы onClose потерялся, второй раз
    // открыть их уже не вышло бы.
    const prefill = {
      companyName: '',
      contactName: '+7999',
      contactPhone: '+7999',
      contactEmail: '',
      subject: 'Звонок',
    };
    render(
      <IntakeTable
        items={[item({ type: 'call', id: 'c1', leadPrefill: prefill })]}
        viewerPrefix="/manager"
        currentUserId="m1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    const leadClose = leadDialogSpy.mock.calls.at(-1)![0].onClose as () => void;
    await act(async () => leadClose());
    expect(screen.queryByTestId('lead-dialog-stub')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    const taskClose = taskDialogSpy.mock.calls.at(-1)![0].onClose as () => void;
    await act(async () => taskClose());
    expect(screen.queryByTestId('task-dialog-stub')).toBeNull();
  });

  it('«Задача» открывает quick-диалог с префиллом; «Закрыть» только у звонка', async () => {
    closeCallIntakeAction.mockResolvedValue({ ok: true });
    render(
      <IntakeTable
        items={[
          item({ type: 'call', id: 'c1', taskTitle: 'Перезвонить: +7999', leadPrefill: null }),
        ]}
        viewerPrefix="/manager"
        currentUserId="m1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    expect(taskDialogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ titlePrefill: 'Перезвонить: +7999' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(closeCallIntakeAction).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Звонок закрыт.'));
  });

  it('у не-звонков кнопки «Закрыть» нет', () => {
    render(<IntakeTable items={[item({})]} viewerPrefix="/manager" currentUserId="m1" />);
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
  });
});
