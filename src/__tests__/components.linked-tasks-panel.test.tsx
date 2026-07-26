// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { createTaskAction } = vi.hoisted(() => ({ createTaskAction: vi.fn() }));
vi.mock('@/server-actions/tasks', () => ({ createTaskAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { LinkedTasksPanel } from '@/components/tasks/linked-tasks-panel';
import type { TaskCard } from '@/lib/services/tasks/board';

function card(over: Partial<TaskCard>): TaskCard {
  return {
    id: 'id',
    title: 'T',
    description: null,
    priority: null,
    dueDate: null,
    completedAt: null,
    createdAt: new Date('2026-01-01'),
    createdByName: 'Автор',
    columnId: 'col-1',
    assigneeIds: [],
    assigneeNames: [],
    linkedOrderId: null,
    linkedOrderTitle: null,
    linkedOrganizationId: null,
    linkedOrganizationName: null,
    linkedLeadId: null,
    linkedLeadSubject: null,
    linkedDealId: null,
    linkedDealTitle: null,
    ...over
  };
}

describe('LinkedTasksPanel (этап 7, ФТ-7.1/3.2)', () => {
  beforeEach(() => {
    refresh.mockReset();
    createTaskAction.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('пустое состояние и кнопка «+ Задача»', () => {
    render(<LinkedTasksPanel link={{ leadId: 'l1' }} tasks={[]} currentUserId="m1" />);
    expect(screen.getByText('Привязанных задач нет.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Задача' })).toBeTruthy();
  });

  it('список: срок, исполнители, зачёркнутая завершённая', () => {
    const tasks = [
      card({ id: 't1', title: 'Открытая', dueDate: new Date('2026-08-15'), assigneeNames: ['Иван'] }),
      card({ id: 't2', title: 'Готовая', completedAt: new Date('2026-07-01') })
    ];
    render(<LinkedTasksPanel link={{ leadId: 'l1' }} tasks={tasks} currentUserId="m1" />);
    expect(screen.getByText('Открытая')).toBeTruthy();
    expect(screen.getByText(/до 15\.08\.2026/)).toBeTruthy();
    expect(screen.getByText('Иван')).toBeTruthy();
    expect(screen.getByText('Готовая').className).toContain('line-through');
  });

  it('quick-add для лида: linkedLeadId + исполнитель «на себя» (чекбокс включён по умолчанию)', async () => {
    createTaskAction.mockResolvedValue({ ok: true, id: 't9' });
    render(<LinkedTasksPanel link={{ leadId: 'l1' }} tasks={[]} currentUserId="m1" />);

    fireEvent.click(screen.getByRole('button', { name: '+ Задача' }));
    fireEvent.change(screen.getByLabelText('Название задачи'), { target: { value: 'Перезвонить' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(createTaskAction).toHaveBeenCalledTimes(1));
    const fd = createTaskAction.mock.calls[0]![0] as FormData;
    expect(fd.get('title')).toBe('Перезвонить');
    expect(fd.get('linkedLeadId')).toBe('l1');
    expect(fd.get('linkedDealId')).toBeNull();
    expect(fd.getAll('assigneeIds')).toEqual(['m1']);
    expect(fd.get('assignSelf')).toBeNull(); // служебное поле вычищено
    expect(toastSuccess).toHaveBeenCalledWith('Задача создана.');
    expect(refresh).toHaveBeenCalled(); // дефолтный onCreated
    // Форма закрылась.
    expect(screen.queryByLabelText('Название задачи')).toBeNull();
  });

  it('quick-add для сделки: linkedDealId; снятый чекбокс — без исполнителя; кастомный onCreated', async () => {
    createTaskAction.mockResolvedValue({ ok: true, id: 't9' });
    const onCreated = vi.fn();
    render(<LinkedTasksPanel link={{ dealId: 'd1' }} tasks={[]} currentUserId="m1" onCreated={onCreated} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Задача' }));
    fireEvent.change(screen.getByLabelText('Название задачи'), { target: { value: 'Счёт' } });
    fireEvent.click(screen.getByText('на себя')); // снять чекбокс
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(createTaskAction).toHaveBeenCalledTimes(1));
    const fd = createTaskAction.mock.calls[0]![0] as FormData;
    expect(fd.get('linkedDealId')).toBe('d1');
    expect(fd.getAll('assigneeIds')).toEqual([]);
    expect(onCreated).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ошибка сервиса: toast.error, форма остаётся открытой', async () => {
    createTaskAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(<LinkedTasksPanel link={{ leadId: 'l1' }} tasks={[]} currentUserId="m1" />);

    fireEvent.click(screen.getByRole('button', { name: '+ Задача' }));
    fireEvent.change(screen.getByLabelText('Название задачи'), { target: { value: 'Х' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByLabelText('Название задачи')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('«Отмена» закрывает форму без вызова экшена', () => {
    render(<LinkedTasksPanel link={{ leadId: 'l1' }} tasks={[]} currentUserId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Задача' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByLabelText('Название задачи')).toBeNull();
    expect(createTaskAction).not.toHaveBeenCalled();
  });
});
