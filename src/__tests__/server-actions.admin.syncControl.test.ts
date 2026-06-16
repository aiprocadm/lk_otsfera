import { describe, it, expect, vi, beforeEach } from 'vitest';

const { triggerSync, setSchedulePaused, rewindCursor } = vi.hoisted(() => ({
  triggerSync: vi.fn(), setSchedulePaused: vi.fn(), rewindCursor: vi.fn(),
}));
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/services/admin/syncControl', () => ({ triggerSync, setSchedulePaused, rewindCursor }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { triggerSyncAction, setSchedulePausedAction, rewindCursorAction } from '@/server-actions/admin/syncControl';

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1' });
});

describe('triggerSyncAction', () => {
  it('calls requireAdmin, service, and revalidates on success', async () => {
    triggerSync.mockResolvedValue({ ok: true, jobId: 'manual:order:1' });
    const res = await triggerSyncAction(fd({ entity: 'order' }));
    expect(requireAdmin).toHaveBeenCalled();
    expect(triggerSync).toHaveBeenCalledWith({}, 'admin-1', 'order');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/sync');
    expect(res).toEqual({ ok: true, jobId: 'manual:order:1' });
  });

  it('rejects a missing entity with validation', async () => {
    const res = await triggerSyncAction(fd({}));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('passes through service errors', async () => {
    triggerSync.mockResolvedValue({ ok: false, error: 'already_running' });
    expect(await triggerSyncAction(fd({ entity: 'order' }))).toEqual({ ok: false, error: 'already_running' });
  });
});

describe('setSchedulePausedAction', () => {
  it('coerces paused and calls the service', async () => {
    setSchedulePaused.mockResolvedValue({ ok: true, paused: true });
    const res = await setSchedulePausedAction(fd({ schedulerId: 'oneCSync.pullOrders.cron', paused: 'true' }));
    expect(setSchedulePaused).toHaveBeenCalledWith({}, 'admin-1', 'oneCSync.pullOrders.cron', true);
    expect(res).toEqual({ ok: true, paused: true });
  });

  it('returns validation when schedulerId is missing', async () => {
    const res = await setSchedulePausedAction(fd({ paused: 'true' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(setSchedulePaused).not.toHaveBeenCalled();
  });
});

describe('rewindCursorAction', () => {
  it('maps empty cursor string to null', async () => {
    rewindCursor.mockResolvedValue({ ok: true, entity: 'order', cursor: null });
    await rewindCursorAction(fd({ entity: 'order', cursor: '' }));
    expect(rewindCursor).toHaveBeenCalledWith({}, 'admin-1', 'order', null);
  });

  it('forwards an ISO cursor', async () => {
    rewindCursor.mockResolvedValue({ ok: true, entity: 'order', cursor: '2026-06-01T00:00:00.000Z' });
    await rewindCursorAction(fd({ entity: 'order', cursor: '2026-06-01T00:00:00.000Z' }));
    expect(rewindCursor).toHaveBeenCalledWith({}, 'admin-1', 'order', '2026-06-01T00:00:00.000Z');
  });

  it('returns validation when entity is missing', async () => {
    const res = await rewindCursorAction(fd({ cursor: '2026-06-01' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(rewindCursor).not.toHaveBeenCalled();
  });
});
