import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { createNotification, deliverNotificationToUser } = vi.hoisted(() => ({
  createNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));

const { notifyNoteMention } = vi.hoisted(() => ({ notifyNoteMention: vi.fn() }));
vi.mock('@/lib/notifications/noteMention', () => ({ notifyNoteMention }));

const { extractMentions, listColleagues } = vi.hoisted(() => ({
  extractMentions: vi.fn(),
  listColleagues: vi.fn(),
}));
vi.mock('@/lib/services/staffChat/mentions', () => ({ extractMentions, listColleagues }));

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError } }));

import { addTaskComment, listTaskComments } from '@/lib/services/tasks/comments';

/**
 * Обсуждение внутри задачи (`У-218`, этап 4 PR-1).
 *
 * Здесь проверяются три вещи, каждая из которых ломается тихо:
 *
 * 1. **Кто получает уведомление.** Автор себе не пишет, а упомянутый по `@`
 *    получает ОДНО уведомление, а не два: `note_mention` вместо `task_comment`.
 *    Два уведомления об одной строке — это тот самый шум, из-за которого
 *    уведомления выключают целиком.
 * 2. **Чужая задача.** Комментарий — ещё одна дверь в задачу: `taskId` приходит
 *    из формы.
 * 3. **Сбой доставки не отменяет комментарий** (fail-open §3): строка уже
 *    сохранена, и падать из-за почты нельзя.
 */

const taskFindUnique = vi.fn();
const commentCreate = vi.fn();
const commentFindMany = vi.fn();
const auditCreate = vi.fn();

const prisma = {
  task: { findUnique: taskFindUnique },
  taskComment: { create: commentCreate, findMany: commentFindMany },
  auditLog: { create: auditCreate },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
} as unknown as PrismaClient;

const manager = { sub: 'author', role: 'manager', companyId: 'co-1' } as SessionPayload;

const TASK = {
  id: 't1',
  title: 'Проверить документы',
  companyId: 'co-1',
  createdById: 'creator',
  linkedOrganizationId: null,
  assignees: [{ userId: 'worker' }, { userId: 'author' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  taskFindUnique.mockResolvedValue(TASK);
  commentCreate.mockResolvedValue({ id: 'c1' });
  createNotification.mockResolvedValue({ id: 'n1' });
  deliverNotificationToUser.mockResolvedValue(undefined);
  notifyNoteMention.mockResolvedValue(0);
  listColleagues.mockResolvedValue({ rows: [{ id: 'worker', name: 'Иван Петров' }] });
  extractMentions.mockReturnValue([]);
});

describe('addTaskComment — запись', () => {
  it('сохраняет комментарий и пишет в журнал факт, но НЕ текст', async () => {
    const res = await addTaskComment(prisma, manager, { taskId: 't1', body: '  Готово  ' });
    expect(res).toEqual({ ok: true, id: 'c1' });
    expect(commentCreate.mock.calls[0][0].data).toEqual({
      taskId: 't1',
      authorId: 'author',
      body: 'Готово',
      mentionUserIds: [],
    });
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'task_comment_added', entity: 'task', entityId: 't1' });
    expect(JSON.stringify(audit)).not.toContain('Готово');
  });

  it('пустой текст — отказ, задачу даже не ищем', async () => {
    expect(await addTaskComment(prisma, manager, { taskId: 't1', body: '   ' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(taskFindUnique).not.toHaveBeenCalled();
  });

  it('слишком длинный текст — отказ', async () => {
    const res = await addTaskComment(prisma, manager, { taskId: 't1', body: 'x'.repeat(4001) });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('сессия без компании — forbidden', async () => {
    const res = await addTaskComment(prisma, { ...manager, companyId: null } as SessionPayload, {
      taskId: 't1',
      body: 'Текст',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('задачи нет — not_found', async () => {
    taskFindUnique.mockResolvedValue(null);
    expect(await addTaskComment(prisma, manager, { taskId: 'нет', body: 'Текст' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('ЧУЖАЯ задача: not_found и ни одной записи', async () => {
    taskFindUnique.mockResolvedValue({ ...TASK, companyId: 'co-2' });
    expect(await addTaskComment(prisma, manager, { taskId: 't1', body: 'Текст' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(commentCreate).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('addTaskComment — кого уведомляем', () => {
  it('исполнителей и создателя, но НЕ автора комментария', async () => {
    await addTaskComment(prisma, manager, { taskId: 't1', body: 'Текст' });
    const notified = createNotification.mock.calls.map((c) => c[0].userId);
    expect(new Set(notified)).toEqual(new Set(['worker', 'creator']));
    expect(notified).not.toContain('author');
  });

  it('тип уведомления и ссылка ведут на страницу задачи', async () => {
    await addTaskComment(prisma, manager, { taskId: 't1', body: 'Текст' });
    expect(createNotification.mock.calls[0][0].type).toBe('task_comment');
    expect(createNotification.mock.calls[0][0].meta.url).toBe('/manager/tasks/t1');
    expect(deliverNotificationToUser.mock.calls[0][0].url).toBe('/manager/tasks/t1');
  });

  it('УПОМЯНУТЫЙ получает ОДНО уведомление — mention, а не второе про комментарий', async () => {
    extractMentions.mockReturnValue(['worker']);
    await addTaskComment(prisma, manager, { taskId: 't1', body: '@Иван Петров посмотри' });
    const notified = createNotification.mock.calls.map((c) => c[0].userId);
    expect(notified).not.toContain('worker');
    expect(notified).toEqual(['creator']);
    expect(notifyNoteMention).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ entity: 'task', entityId: 't1', mentionedUserIds: ['worker'] })
    );
  });

  it('упоминания разбираются только когда в тексте есть «@»', async () => {
    await addTaskComment(prisma, manager, { taskId: 't1', body: 'Без упоминаний' });
    expect(listColleagues).not.toHaveBeenCalled();
    expect(commentCreate.mock.calls[0][0].data.mentionUserIds).toEqual([]);
  });

  it('автор не зовёт сам себя', async () => {
    extractMentions.mockReturnValue(['author', 'worker']);
    await addTaskComment(prisma, manager, { taskId: 't1', body: '@сам @Иван Петров' });
    expect(commentCreate.mock.calls[0][0].data.mentionUserIds).toEqual(['worker']);
  });

  it('СБОЙ ДОСТАВКИ не отменяет уже сохранённый комментарий', async () => {
    createNotification.mockRejectedValue(new Error('SMTP лёг'));
    const res = await addTaskComment(prisma, manager, { taskId: 't1', body: 'Текст' });
    expect(res).toEqual({ ok: true, id: 'c1' });
    expect(logError).toHaveBeenCalled();
  });
});

describe('listTaskComments', () => {
  it('отдаёт ленту по возрастанию времени с именем автора', async () => {
    commentFindMany.mockResolvedValue([
      {
        id: 'c1',
        createdAt: new Date('2026-09-15T10:00:00Z'),
        authorId: 'author',
        body: 'Первый',
        author: { name: 'Пётр' },
      },
    ]);
    const rows = await listTaskComments(prisma, 't1');
    expect(commentFindMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
    expect(rows).toEqual([
      {
        id: 'c1',
        createdAt: new Date('2026-09-15T10:00:00Z'),
        authorId: 'author',
        authorName: 'Пётр',
        body: 'Первый',
      },
    ]);
  });
});
