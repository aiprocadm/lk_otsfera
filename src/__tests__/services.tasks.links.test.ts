/**
 * Этап 7 (ФТ-7.1/7.2) — CRUD задач: привязки к лиду/сделке (валидация refs),
 * сброс dueSoonNotifiedAt при переносе срока, уведомления task_assigned только
 * новым исполнителям. Стиль — cov.tasks.test.ts (реальные сервисы + prisma-фейки).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock, notifyTaskAssignedMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  notifyTaskAssignedMock: vi.fn()
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/services/tasks/notify', () => ({
  notifyTaskAssigned: notifyTaskAssignedMock,
  TASKS_BOARD_URL: '/manager/tasks'
}));

import { createTask, updateTask, assignTask } from '@/lib/services/tasks/tasks';

const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A', managedOrgIds: [] } as unknown as SessionPayload);

function txRuns(tx: unknown, extra: Record<string, unknown> = {}): PrismaClient {
  return {
    ...extra,
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
  } as unknown as PrismaClient;
}

/** Fake tx: лид/сделка настраиваются per-тест; create возвращает строку задачи. */
function makeTx(over: Record<string, unknown> = {}) {
  return {
    order: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn().mockResolvedValue({ id: 'l1' }) },
    deal: { findUnique: vi.fn().mockResolvedValue({ companyId: 'co-A' }) },
    // count == числу запрошенных id → валидация исполнителей проходит.
    user: {
      count: vi.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.length)
      )
    },
    task: {
      create: vi.fn().mockResolvedValue({ id: 't1', title: 'T', status: 'todo', dueDate: null }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn()
    },
    taskAssignee: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    ...over
  };
}

const noColumns = { taskColumn: { findMany: vi.fn().mockResolvedValue([]) } };

beforeEach(() => {
  recordAuditMock.mockReset();
  notifyTaskAssignedMock.mockReset().mockResolvedValue(undefined);
});

describe('createTask — привязки к лиду/сделке (ФТ-7.1)', () => {
  it('персистит linkedLeadId/linkedDealId после валидации', async () => {
    const tx = makeTx();
    const prisma = txRuns(tx, noColumns);

    const r = await createTask(prisma, manager(), { title: 'T', linkedLeadId: 'l1', linkedDealId: 'd1' });

    expect(r.ok).toBe(true);
    expect(tx.lead.findUnique).toHaveBeenCalledWith({ where: { id: 'l1' }, select: { id: true } });
    expect(tx.deal.findUnique).toHaveBeenCalledWith({ where: { id: 'd1' }, select: { companyId: true } });
    expect(tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ linkedLeadId: 'l1', linkedDealId: 'd1' }) })
    );
  });

  it('несуществующий лид → validation', async () => {
    const tx = makeTx({ lead: { findUnique: vi.fn().mockResolvedValue(null) } });
    const r = await createTask(txRuns(tx, noColumns), manager(), { title: 'T', linkedLeadId: 'nope' });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('сделка чужой компании → validation (C8)', async () => {
    const tx = makeTx({ deal: { findUnique: vi.fn().mockResolvedValue({ companyId: 'co-B' }) } });
    const r = await createTask(txRuns(tx, noColumns), manager(), { title: 'T', linkedDealId: 'd-b' });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('несуществующая сделка → validation', async () => {
    const tx = makeTx({ deal: { findUnique: vi.fn().mockResolvedValue(null) } });
    const r = await createTask(txRuns(tx, noColumns), manager(), { title: 'T', linkedDealId: 'nope' });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('уведомляет исполнителей после успеха; при ошибке — нет', async () => {
    const tx = makeTx();
    const r = await createTask(txRuns(tx, noColumns), manager(), { title: 'T', assigneeIds: ['u2', 'u3'] });
    expect(r.ok).toBe(true);
    expect(notifyTaskAssignedMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', actorUserId: 'm1', assigneeUserIds: ['u2', 'u3'] })
    );

    notifyTaskAssignedMock.mockClear();
    const txBad = makeTx({ lead: { findUnique: vi.fn().mockResolvedValue(null) } });
    await createTask(txRuns(txBad, noColumns), manager(), { title: 'T', linkedLeadId: 'x', assigneeIds: ['u2'] });
    expect(notifyTaskAssignedMock).not.toHaveBeenCalled();
  });
});

const BEFORE_ROW = {
  companyId: 'co-A',
  createdById: 'm1',
  linkedOrganizationId: null,
  assignees: [] as { userId: string }[],
  title: 'Old',
  dueDate: null as Date | null
};

describe('updateTask — dueSoonNotifiedAt и диф исполнителей (ФТ-7.2)', () => {
  it('смена dueDate → сброс dueSoonNotifiedAt', async () => {
    const tx = makeTx({ task: { findUnique: vi.fn().mockResolvedValue({ ...BEFORE_ROW }), update: vi.fn(), create: vi.fn() } });
    const r = await updateTask(txRuns(tx), manager(), 't1', { title: 'New', dueDate: new Date('2026-08-01') });
    expect(r.ok).toBe(true);
    expect(tx.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dueSoonNotifiedAt: null }) })
    );
  });

  it('dueDate не менялся → поле не трогаем', async () => {
    const due = new Date('2026-08-01');
    const tx = makeTx({
      task: { findUnique: vi.fn().mockResolvedValue({ ...BEFORE_ROW, dueDate: due }), update: vi.fn(), create: vi.fn() }
    });
    const r = await updateTask(txRuns(tx), manager(), 't1', { title: 'New', dueDate: new Date('2026-08-01') });
    expect(r.ok).toBe(true);
    const data = (tx.task.update as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect('dueSoonNotifiedAt' in data).toBe(false);
  });

  it('уведомляются только ДОБАВЛЕННЫЕ исполнители', async () => {
    const tx = makeTx({
      task: { findUnique: vi.fn().mockResolvedValue({ ...BEFORE_ROW }), update: vi.fn(), create: vi.fn() },
      taskAssignee: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'u-old' }]),
        createMany: vi.fn(),
        deleteMany: vi.fn()
      }
    });
    const r = await updateTask(txRuns(tx), manager(), 't1', { title: 'T', assigneeIds: ['u-old', 'u-new'] });
    expect(r.ok).toBe(true);
    expect(notifyTaskAssignedMock).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserIds: ['u-new'] }));
  });

  it('assigneeIds не передан → диф не считается, notify с пустым списком', async () => {
    const tx = makeTx({ task: { findUnique: vi.fn().mockResolvedValue({ ...BEFORE_ROW }), update: vi.fn(), create: vi.fn() } });
    const r = await updateTask(txRuns(tx), manager(), 't1', { title: 'T' });
    expect(r.ok).toBe(true);
    expect(notifyTaskAssignedMock).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserIds: [] }));
  });
});

describe('assignTask — уведомление добавленным (ФТ-7.2)', () => {
  it('передаёт в notify только новых; титул и срок из строки задачи', async () => {
    const due = new Date('2026-09-01');
    const tx = makeTx({
      task: { findUnique: vi.fn().mockResolvedValue({ ...BEFORE_ROW, title: 'Задача', dueDate: due }), update: vi.fn(), create: vi.fn() },
      taskAssignee: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'u-old' }]),
        createMany: vi.fn(),
        deleteMany: vi.fn()
      }
    });
    const r = await assignTask(txRuns(tx), manager(), { taskId: 't1', assigneeIds: ['u-old', 'u-new'] });
    expect(r.ok).toBe(true);
    expect(notifyTaskAssignedMock).toHaveBeenCalledWith({
      taskId: 't1',
      taskTitle: 'Задача',
      dueDate: due,
      actorUserId: 'm1',
      assigneeUserIds: ['u-new']
    });
  });

  it('ошибка транзакции → notify не вызывается', async () => {
    const tx = makeTx({ task: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn(), create: vi.fn() } });
    const r = await assignTask(txRuns(tx), manager(), { taskId: 'nope', assigneeIds: [] });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(notifyTaskAssignedMock).not.toHaveBeenCalled();
  });
});
