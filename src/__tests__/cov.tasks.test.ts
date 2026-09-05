/**
 * Track E / E1 — coverage restoration for the internal tasks/kanban domain.
 *
 * Targets the EXACT residual uncovered lines/branches that drifted below 100%
 * after later feature tracks merged. Mirrors the mocks/style of the module's
 * existing tests:
 *   - services.tasks.board.integration.test.ts / services.tasks.columns.integration.test.ts
 *     (real service functions driven with controlled prisma fakes)
 *   - services.tasks.isolation.test.ts (client-role / cross-company deny contract)
 *   - tasks.columns.unit.test.ts (pure column helpers)
 *   - server-actions.tasks.test.ts (requireSession + next/cache + db/prisma mocked)
 *
 * This file is PURE (no `new PrismaClient(`) → unit-tier per CLAUDE.md §6. Every
 * branch is reached by calling the REAL exported function against a hand-built
 * prisma fake whose call-shape matches exactly what the function invokes. The
 * boundary-catch re-throw arms use a prisma whose `$transaction` rejects with a
 * NON-domain error so the `throw e` re-throw arm executes (not a mapped code).
 *
 * `@/lib/auth/audit` recordAudit is mocked to a no-op: the tests that let a
 * transaction body run to completion do not need a real `auditLog.create`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// recordAudit no-op so successful transaction bodies don't require a tx.auditLog.
const { recordAuditMock, requireSessionMock, revalidatePathMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  requireSessionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession: requireSessionMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { createTask, updateTask, deleteTask, assignTask } from '@/lib/services/tasks/tasks';
import {
  listTaskColumns,
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
} from '@/lib/services/tasks/columns';
import { listTaskBoard, getTaskFormOptions, moveTask } from '@/lib/services/tasks/board';
import { resolveTaskColumns } from '@/lib/tasks/columns';
import {
  createTaskAction,
  updateTaskAction,
  deleteTaskAction,
  assignTaskAction,
  createTaskColumnAction,
  updateTaskColumnAction,
  deleteTaskColumnAction,
} from '@/server-actions/tasks';

// ─── shared helpers ──────────────────────────────────────────────────────────

/** Prisma fake whose `$transaction` rejects with a non-domain error → re-throw arm. */
function txThrows(err: unknown, extra: Record<string, unknown> = {}): PrismaClient {
  return {
    ...extra,
    $transaction: vi.fn().mockRejectedValue(err),
  } as unknown as PrismaClient;
}

/** Prisma fake that runs a $transaction callback against the supplied `tx`. */
function txRuns(tx: unknown, extra: Record<string, unknown> = {}): PrismaClient {
  return {
    ...extra,
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
}

const P2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
  code: 'P2002',
  clientVersion: '5.0.0',
});

const managerA = (): SessionPayload =>
  ({
    sub: 'm1',
    role: 'manager',
    companyId: 'co-A',
    managedOrgIds: [],
  }) as unknown as SessionPayload;
const leaderA = (): SessionPayload =>
  ({
    sub: 'l1',
    role: 'leader',
    companyId: 'co-A',
  }) as unknown as SessionPayload;
const plainA = (): SessionPayload =>
  ({
    sub: 'p1',
    role: 'manager',
    companyId: 'co-A',
  }) as unknown as SessionPayload;
const adminA = (): SessionPayload =>
  ({ sub: 'a1', role: 'admin', companyId: 'co-A' }) as unknown as SessionPayload;
const noCompany = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', managedOrgIds: [] }) as unknown as SessionPayload; // no companyId

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// services/tasks/tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('tasks.ts — createTask', () => {
  it('invalid input (empty title) → validation before touching the DB (branch@113)', async () => {
    const r = await createTask({} as unknown as PrismaClient, managerA(), { title: '' });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('custom (non-default) target column → persistColumnId keeps the real id (branch@120)', async () => {
    const columns = [
      {
        id: 'col-x',
        name: 'Backlog',
        position: 0,
        statusAnchor: 'todo',
        isDoneColumn: false,
        color: null,
      },
    ];
    const created = { id: 'task-1' };
    const tx = { task: { create: vi.fn().mockResolvedValue(created) } };
    const prisma = txRuns(tx, { taskColumn: { findMany: vi.fn().mockResolvedValue(columns) } });

    const r = await createTask(prisma, managerA(), { title: 'x', columnId: 'col-x' });
    expect(r).toEqual({ ok: true, id: 'task-1' });
    // persistColumnId = 'col-x' (real id), status = the column's anchor.
    const createArg = tx.task.create.mock.calls[0][0].data;
    expect(createArg.columnId).toBe('col-x');
    expect(createArg.status).toBe('todo');
  });

  it('re-throws a non-TaskError from the transaction (branch@151, lines152-153)', async () => {
    const boom = new Error('db exploded');
    const prisma = txThrows(boom, { taskColumn: { findMany: vi.fn().mockResolvedValue([]) } });
    await expect(createTask(prisma, managerA(), { title: 'x' })).rejects.toThrow('db exploded');
  });
});

describe('tasks.ts — updateTask', () => {
  it('invalid input (empty title) → validation (branch@165)', async () => {
    const r = await updateTask({} as unknown as PrismaClient, managerA(), 't1', { title: '' });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('missing task → not_found (branch@171 !before arm)', async () => {
    const tx = { task: { findUnique: vi.fn().mockResolvedValue(null) } };
    const r = await updateTask(txRuns(tx), managerA(), 'missing', { title: 'x' });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('assigneeIds present → syncAssignees runs (branch@185 !== undefined arm)', async () => {
    const before = {
      companyId: 'co-A',
      createdById: 'm1',
      linkedOrganizationId: null,
      assignees: [],
      title: 'old',
    };
    const findMany = vi.fn().mockResolvedValue([]); // no existing assignees
    const tx = {
      task: {
        findUnique: vi.fn().mockResolvedValue(before),
        update: vi.fn().mockResolvedValue({}),
      },
      taskAssignee: { findMany, createMany: vi.fn(), deleteMany: vi.fn() },
    };
    const r = await updateTask(txRuns(tx), managerA(), 't1', { title: 'new', assigneeIds: [] });
    expect(r).toEqual({ ok: true });
    expect(findMany).toHaveBeenCalledTimes(1); // syncAssignees was entered
  });

  it('re-throws a non-TaskError from the transaction (branch@193, lines194-195)', async () => {
    const boom = new Error('update tx failed');
    await expect(updateTask(txThrows(boom), managerA(), 't1', { title: 'x' })).rejects.toThrow(
      'update tx failed'
    );
  });
});

describe('tasks.ts — deleteTask', () => {
  it('missing task → not_found (branch@209 !before arm)', async () => {
    const tx = { task: { findUnique: vi.fn().mockResolvedValue(null) } };
    const r = await deleteTask(txRuns(tx), managerA(), 'missing');
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('re-throws a non-TaskError from the transaction (branch@219, lines220-221)', async () => {
    const boom = new Error('delete tx failed');
    await expect(deleteTask(txThrows(boom), managerA(), 't1')).rejects.toThrow('delete tx failed');
  });
});

describe('tasks.ts — assignTask', () => {
  it('missing task → not_found (branch@235 !before arm)', async () => {
    const tx = { task: { findUnique: vi.fn().mockResolvedValue(null) } };
    const r = await assignTask(txRuns(tx), managerA(), { taskId: 'missing', assigneeIds: [] });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('task in another company → not_found via canSeeTask deny (branch@236)', async () => {
    const before = {
      companyId: 'co-B',
      createdById: 'x',
      linkedOrganizationId: null,
      assignees: [],
    };
    const tx = { task: { findUnique: vi.fn().mockResolvedValue(before) } };
    const r = await assignTask(txRuns(tx), managerA(), { taskId: 't1', assigneeIds: [] });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('re-throws a non-TaskError from the transaction (branch@251, lines252-253)', async () => {
    const boom = new Error('assign tx failed');
    await expect(
      assignTask(txThrows(boom), managerA(), { taskId: 't1', assigneeIds: [] })
    ).rejects.toThrow('assign tx failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// services/tasks/columns.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('columns.ts — role gate', () => {
  it('admin passes canManage → listTaskColumns returns rows (branch@37 admin arm)', async () => {
    const prisma = {
      taskColumn: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const r = await listTaskColumns(prisma, adminA());
    expect(r).toEqual({ ok: true, rows: [] });
  });

  it('plain manager (not leader) → forbidden on list (branch@62)', async () => {
    const r = await listTaskColumns({} as unknown as PrismaClient, plainA());
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('plain manager → forbidden on update (branch@105)', async () => {
    const r = await updateTaskColumn({} as unknown as PrismaClient, plainA(), 'c1', {
      name: 'X',
      position: 0,
      statusAnchor: 'todo',
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('plain manager → forbidden on delete (branch@137)', async () => {
    const r = await deleteTaskColumn({} as unknown as PrismaClient, plainA(), 'c1');
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('columns.ts — createTaskColumn', () => {
  it('re-throws a non-P2002 error (branch@93 isUnique-false, lines94-95)', async () => {
    const boom = new Error('column tx failed');
    const r = createTaskColumn(txThrows(boom), leaderA(), {
      name: 'X',
      position: 0,
      statusAnchor: 'todo',
    });
    await expect(r).rejects.toThrow('column tx failed');
  });
});

describe('columns.ts — updateTaskColumn', () => {
  it('invalid input (empty name) → validation (branch@107)', async () => {
    const r = await updateTaskColumn({} as unknown as PrismaClient, leaderA(), 'c1', {
      name: '  ',
      position: 0,
      statusAnchor: 'todo',
    });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('missing / cross-company column → not_found (branch@125 TaskColumnError arm)', async () => {
    const tx = {
      taskColumn: {
        findUnique: vi.fn().mockResolvedValue({
          companyId: 'co-B',
          name: 'x',
          position: 0,
          statusAnchor: 'todo',
          color: null,
          isDoneColumn: false,
        }),
      },
    };
    const r = await updateTaskColumn(txRuns(tx), leaderA(), 'c1', {
      name: 'X',
      position: 0,
      statusAnchor: 'todo',
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('P2002 during update → position_taken (line126 isUnique-true arm)', async () => {
    const tx = {
      taskColumn: {
        findUnique: vi.fn().mockResolvedValue({
          companyId: 'co-A',
          name: 'x',
          position: 0,
          statusAnchor: 'todo',
          color: null,
          isDoneColumn: false,
        }),
        update: vi.fn().mockRejectedValue(P2002),
      },
    };
    const r = await updateTaskColumn(txRuns(tx), leaderA(), 'c1', {
      name: 'X',
      position: 1,
      statusAnchor: 'todo',
    });
    expect(r).toEqual({ ok: false, error: 'position_taken' });
  });

  it('re-throws a non-domain, non-P2002 error (line127 throw e)', async () => {
    const boom = new Error('update column exploded');
    const tx = {
      taskColumn: {
        findUnique: vi.fn().mockResolvedValue({
          companyId: 'co-A',
          name: 'x',
          position: 0,
          statusAnchor: 'todo',
          color: null,
          isDoneColumn: false,
        }),
        update: vi.fn().mockRejectedValue(boom),
      },
    };
    await expect(
      updateTaskColumn(txRuns(tx), leaderA(), 'c1', {
        name: 'X',
        position: 1,
        statusAnchor: 'todo',
      })
    ).rejects.toThrow('update column exploded');
  });
});

describe('columns.ts — deleteTaskColumn', () => {
  it('missing / cross-company column → not_found (branch@142 !before/company arm, branch@150 TaskColumnError arm, line151)', async () => {
    const tx = { taskColumn: { findUnique: vi.fn().mockResolvedValue(null) } };
    const r = await deleteTaskColumn(txRuns(tx), leaderA(), 'c1');
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('re-throws a non-domain error (branch@150 non-TaskColumnError arm, lines152-153)', async () => {
    const boom = new Error('delete column exploded');
    await expect(deleteTaskColumn(txThrows(boom), leaderA(), 'c1')).rejects.toThrow(
      'delete column exploded'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// services/tasks/board.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('board.ts — listTaskBoard', () => {
  it('session without companyId → resolveTaskColumns("") default board, no cards (branch@44 ?? "" arm)', async () => {
    const prisma = {
      taskColumn: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;
    const board = await listTaskBoard(prisma, noCompany());
    expect(board.columns.map((c) => c.statusAnchor)).toEqual([
      'todo',
      'in_progress',
      'review',
      'done',
    ]);
    expect(board.board.every((c) => c.cards.length === 0)).toBe(true);
    // resolveTaskColumns was called with '' (the ?? '' fallback).
    const findMany = prisma.taskColumn.findMany as unknown as ReturnType<typeof vi.fn>;
    expect(findMany.mock.calls[0][0].where.companyId).toBe('');
  });

  it('task whose status has no matching custom column is skipped; linkedOrder/linkedOrg names resolve both arms (branch@63, branch@79)', async () => {
    const customColumns = [
      {
        id: 'c-todo',
        name: 'Todo',
        position: 0,
        statusAnchor: 'todo',
        isDoneColumn: false,
        color: null,
      },
    ];
    const cardWithLinks = {
      id: 'A',
      title: 'A',
      description: null,
      priority: null,
      dueDate: null,
      completedAt: null,
      status: 'todo',
      columnId: null,
      createdAt: new Date(),
      createdBy: { name: 'Creator' },
      assignees: [{ userId: 'u9', user: { name: 'U9' } }],
      linkedOrderId: 'ord-1',
      linkedOrder: { title: 'Order One' },
      linkedOrganizationId: 'org-1',
      linkedOrganization: { name: 'Org One' },
    };
    const cardNoLinks = {
      id: 'B',
      title: 'B',
      description: null,
      priority: null,
      dueDate: null,
      completedAt: null,
      status: 'todo',
      columnId: null,
      createdAt: new Date(),
      createdBy: { name: 'Creator' },
      assignees: [],
      linkedOrderId: null,
      linkedOrder: null,
      linkedOrganizationId: null,
      linkedOrganization: null,
    };
    // Status 'done' has no column in the custom set → columnForTask returns undefined → skipped.
    const cardOrphan = {
      id: 'C',
      title: 'C',
      description: null,
      priority: null,
      dueDate: null,
      completedAt: null,
      status: 'done',
      columnId: null,
      createdAt: new Date(),
      createdBy: { name: 'Creator' },
      assignees: [],
      linkedOrderId: null,
      linkedOrder: null,
      linkedOrganizationId: null,
      linkedOrganization: null,
    };
    const prisma = {
      taskColumn: { findMany: vi.fn().mockResolvedValue(customColumns) },
      task: {
        findMany: vi.fn().mockResolvedValue([cardWithLinks, cardNoLinks, cardOrphan]),
        count: vi.fn().mockResolvedValue(3),
      },
    } as unknown as PrismaClient;

    const board = await listTaskBoard(prisma, managerA());
    const todo = board.board.find((c) => c.column.id === 'c-todo')!;
    const ids = todo.cards.map((c) => c.id);
    expect(ids).toContain('A');
    expect(ids).toContain('B');
    expect(ids).not.toContain('C'); // orphan skipped (branch@63)
    const a = todo.cards.find((c) => c.id === 'A')!;
    const b = todo.cards.find((c) => c.id === 'B')!;
    expect(a.linkedOrderTitle).toBe('Order One');
    expect(a.linkedOrganizationName).toBe('Org One'); // branch@79 name-present arm
    expect(b.linkedOrderTitle).toBeNull();
    expect(b.linkedOrganizationName).toBeNull(); // branch@79 ?? null arm
  });
});

describe('board.ts — getTaskFormOptions', () => {
  it('session without companyId → NO_COMPANY_SENTINEL, empty lists (branch@94 ?? arm)', async () => {
    const userFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      user: { findMany: userFindMany },
      organization: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      order: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;
    const opt = await getTaskFormOptions(prisma, noCompany());
    expect(opt).toEqual({
      users: [],
      organizations: [],
      orders: [],
      organizationsTotal: 0,
      ordersTotal: 0,
    });
    // companyId fell back to the never-match sentinel.
    expect(userFindMany.mock.calls[0][0].where.companyId).toBe('__no_company__');
  });
});

describe('board.ts — moveTask', () => {
  it('session without companyId → forbidden (branch@110)', async () => {
    const r = await moveTask({} as unknown as PrismaClient, noCompany(), {
      taskId: 't1',
      toColumnId: 'default:todo',
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('custom (non-default) target column → persistColumnId keeps the real id (branch@134)', async () => {
    const customColumns = [
      {
        id: 'col-y',
        name: 'Doing',
        position: 0,
        statusAnchor: 'in_progress',
        isDoneColumn: false,
        color: null,
      },
    ];
    const task = {
      id: 't1',
      companyId: 'co-A',
      status: 'todo',
      columnId: null,
      completedAt: null,
      createdById: 'm1',
      linkedOrganizationId: null,
      assignees: [],
    };
    const update = vi.fn().mockResolvedValue({});
    const tx = { task: { update } };
    const prisma = txRuns(tx, {
      taskColumn: { findMany: vi.fn().mockResolvedValue(customColumns) },
      task: { findUnique: vi.fn().mockResolvedValue(task) },
    });
    const r = await moveTask(prisma, managerA(), { taskId: 't1', toColumnId: 'col-y' });
    expect(r).toEqual({ ok: true });
    expect(update.mock.calls[0][0].data.columnId).toBe('col-y'); // real id, not null
    expect(update.mock.calls[0][0].data.status).toBe('in_progress');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lib/tasks/columns.ts — resolveTaskColumns custom-columns mapping (branch@30, lines31-39)
// ─────────────────────────────────────────────────────────────────────────────
describe('lib/tasks/columns.ts — resolveTaskColumns', () => {
  it('maps custom columns when the company has them (branch@30 non-empty arm, lines31-39)', async () => {
    const custom = [
      {
        id: 'k1',
        name: 'Backlog',
        position: 0,
        statusAnchor: 'todo',
        isDoneColumn: false,
        color: '#fff',
        companyId: 'co-A',
      },
      {
        id: 'k2',
        name: 'Done',
        position: 1,
        statusAnchor: 'done',
        isDoneColumn: true,
        color: null,
        companyId: 'co-A',
      },
    ];
    const prisma = {
      taskColumn: { findMany: vi.fn().mockResolvedValue(custom) },
    } as unknown as PrismaClient;
    const cols = await resolveTaskColumns(prisma, 'co-A');
    expect(cols).toEqual([
      {
        id: 'k1',
        name: 'Backlog',
        position: 0,
        statusAnchor: 'todo',
        isDoneColumn: false,
        color: '#fff',
      },
      {
        id: 'k2',
        name: 'Done',
        position: 1,
        statusAnchor: 'done',
        isDoneColumn: true,
        color: null,
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// server-actions/tasks/index.ts — helper + guard branches
//   Driven through the REAL server actions with a mocked requireSession. A partner
//   session makes the underlying service short-circuit at its role gate (before any
//   prisma access), so the mocked `prisma: {}` is never dereferenced and each
//   action's `if (!res.ok)` return arm executes.
// ─────────────────────────────────────────────────────────────────────────────
function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}
const partner = (): SessionPayload =>
  ({
    sub: 'part-1',
    role: 'partner',
    partnerId: 'pp1',
    managedOrgIds: [],
  }) as unknown as SessionPayload;

describe('server-actions/tasks — taskInput helper (branch@49 dueDate present)', () => {
  it('builds a Date when dueDate is a non-empty string, then service denies partner', async () => {
    requireSessionMock.mockResolvedValue(partner());
    const res = await createTaskAction(fd({ title: 'X', dueDate: '2026-01-15' }));
    // partner → createTask staffGate → forbidden; the @49 truthy `new Date(due)` arm ran.
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('server-actions/tasks — service-error return arms', () => {
  it('updateTaskAction returns the service error (branch@81)', async () => {
    requireSessionMock.mockResolvedValue(partner());
    expect(await updateTaskAction(fd({ id: 't1', title: 'X' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('deleteTaskAction returns the service error (branch@91)', async () => {
    requireSessionMock.mockResolvedValue(partner());
    expect(await deleteTaskAction(fd({ id: 't1' }))).toEqual({ ok: false, error: 'forbidden' });
  });

  it('assignTaskAction returns the service error (branch@102)', async () => {
    requireSessionMock.mockResolvedValue(partner());
    expect(await assignTaskAction(fd({ taskId: 't1' }))).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createTaskColumnAction returns the service error (branch@120)', async () => {
    requireSessionMock.mockResolvedValue(partner());
    // isDoneColumn='true' → @110 right-hand `=== 'true'` arm; no statusAnchor → @111 `|| 'todo'` fallback.
    const res = await createTaskColumnAction(
      fd({ name: 'Col', position: '0', isDoneColumn: 'true' })
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('updateTaskColumnAction returns the service error (branch@130)', async () => {
    requireSessionMock.mockResolvedValue(partner());
    expect(
      await updateTaskColumnAction(fd({ id: 'c1', name: 'X', position: '0', statusAnchor: 'todo' }))
    ).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('deleteTaskColumnAction returns the service error (branch@140)', async () => {
    requireSessionMock.mockResolvedValue(partner());
    expect(await deleteTaskColumnAction(fd({ id: 'c1' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
