// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { addTaskCommentAction } = vi.hoisted(() => ({ addTaskCommentAction: vi.fn() }));
vi.mock('@/server-actions/tasks', () => ({ addTaskCommentAction }));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { TaskComments } from '@/components/tasks/task-comments';
import type { TaskCommentView } from '@/lib/services/tasks/comments';

/** Обсуждение внутри задачи (`У-218`). */

const comments: TaskCommentView[] = [
  {
    id: 'c1',
    createdAt: new Date('2026-09-15T10:00:00Z'),
    authorId: 'u2',
    authorName: 'Иван Петров',
    body: 'Документы получены',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  addTaskCommentAction.mockResolvedValue({ ok: true });
});

describe('TaskComments', () => {
  it('показывает автора и текст', () => {
    render(React.createElement(TaskComments, { taskId: 't1', comments }));
    expect(screen.getByText('Иван Петров')).toBeTruthy();
    expect(screen.getByText('Документы получены')).toBeTruthy();
  });

  it('пустое обсуждение объясняет, что делать, и подсказывает про «@» (`У-74`)', () => {
    render(React.createElement(TaskComments, { taskId: 't1', comments: [] }));
    expect(screen.getByText(/Обсуждения пока нет/)).toBeTruthy();
    expect(screen.getByText(/через «@»/)).toBeTruthy();
  });

  it('отправка уходит с текстом и id задачи, поле чистится', async () => {
    render(React.createElement(TaskComments, { taskId: 't1', comments }));
    const area = screen.getByLabelText('Текст комментария') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Проверил, всё на месте' } });
    fireEvent.submit(area.closest('form')!);
    await waitFor(() => expect(addTaskCommentAction).toHaveBeenCalled());
    const fd = addTaskCommentAction.mock.calls[0][0] as FormData;
    expect(fd.get('body')).toBe('Проверил, всё на месте');
    expect(fd.get('taskId')).toBe('t1');
    await waitFor(() => expect(area.value).toBe(''));
    expect(refresh).toHaveBeenCalled();
  });

  it('отказ сервера показывается по-русски, текст НЕ теряется', async () => {
    addTaskCommentAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(React.createElement(TaskComments, { taskId: 't1', comments }));
    const area = screen.getByLabelText('Текст комментария') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Черновик' } });
    fireEvent.submit(area.closest('form')!);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // Написанное не должно пропадать из-за отказа сервера.
    expect(area.value).toBe('Черновик');
    expect(refresh).not.toHaveBeenCalled();
  });
});
