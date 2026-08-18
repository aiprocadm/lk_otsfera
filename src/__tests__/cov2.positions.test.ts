import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Coverage top-up (100% gate) — the `Number(str(fd,'position') || 0)` fallback,
 * i.e. the `|| 0` (missing / empty `position`) branch, in the shared input
 * builders of both position-carrying server-action modules:
 *   • src/server-actions/funnel/index.ts @48  (stageInput → createFunnelStageAction)
 *   • src/server-actions/tasks/index.ts  @110 (columnInput → createTaskColumnAction)
 *
 * Pure action-level unit test — mirrors server-actions.tasks.test.ts: mock
 * next/cache + requireRole (mocked requireSession) + the prisma singleton + every
 * downstream service so nothing touches Postgres or any external system. The
 * input builder (which parses `position`) runs BEFORE the service call, so the
 * `|| 0` fallback is exercised regardless of what the mocked service returns; we
 * only assert the action resolves and forwards `position: 0` into the service.
 */

const {
  requireSession,
  revalidatePath,
  // funnel services
  moveFunnelLead,
  createFunnelStage,
  updateFunnelStage,
  deleteFunnelStage,
  // tasks services
  moveTask,
  createTask,
  updateTask,
  deleteTask,
  assignTask,
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  moveFunnelLead: vi.fn(),
  createFunnelStage: vi.fn(),
  updateFunnelStage: vi.fn(),
  deleteFunnelStage: vi.fn(),
  moveTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  assignTask: vi.fn(),
  createTaskColumn: vi.fn(),
  updateTaskColumn: vi.fn(),
  deleteTaskColumn: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/funnel/board', () => ({ moveFunnelLead }));
vi.mock('@/lib/services/access/funnelStages', () => ({
  createFunnelStage,
  updateFunnelStage,
  deleteFunnelStage,
}));
vi.mock('@/lib/services/tasks/board', () => ({ moveTask }));
vi.mock('@/lib/services/tasks/tasks', () => ({ createTask, updateTask, deleteTask, assignTask }));
vi.mock('@/lib/services/tasks/columns', () => ({
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
}));

// Imported AFTER the mocks so the action modules pick up the mocked deps.
import { createFunnelStageAction } from '@/server-actions/funnel';
import { createTaskColumnAction } from '@/server-actions/tasks';

const SESSION = { sub: 'u1', role: 'leader', companyId: 'co-A' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  revalidatePath.mockReturnValue(undefined);
});

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe('position `|| 0` fallback — funnel stageInput @48', () => {
  it('createFunnelStageAction with FormData omitting `position` → parses to 0', async () => {
    createFunnelStage.mockResolvedValue({ ok: false, error: 'forbidden' });
    // 'position' AND 'statusAnchor' omitted → `'' || 0` → 0 (@48) and
    // `'' || 'new'` → 'new' (@49) both fire.
    const res = await createFunnelStageAction(form({ name: 'Стадия' }));
    // Service is mocked to forbidden; we only need the action to return — the
    // input parse ran before the (mocked) service call.
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(createFunnelStage).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ name: 'Стадия', position: 0, statusAnchor: 'new' })
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('empty-string `position` also hits `|| 0` → 0', async () => {
    createFunnelStage.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await createFunnelStageAction(
      form({ name: 'Стадия', position: '', statusAnchor: 'new' })
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(createFunnelStage).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ position: 0 })
    );
  });
});

describe('position `|| 0` fallback — tasks columnInput @110', () => {
  it('createTaskColumnAction with FormData omitting `position` → parses to 0', async () => {
    createTaskColumn.mockResolvedValue({ ok: false, error: 'forbidden' });
    // 'position' intentionally omitted → str() returns '' → `'' || 0` → Number(0) = 0.
    const res = await createTaskColumnAction(form({ name: 'Колонка', statusAnchor: 'todo' }));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(createTaskColumn).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ name: 'Колонка', position: 0 })
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('empty-string `position` also hits `|| 0` → 0', async () => {
    createTaskColumn.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await createTaskColumnAction(
      form({ name: 'Колонка', position: '', statusAnchor: 'todo' })
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(createTaskColumn).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ position: 0 })
    );
  });
});
