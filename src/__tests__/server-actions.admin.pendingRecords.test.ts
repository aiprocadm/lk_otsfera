import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requeueDeadRecord } = vi.hoisted(() => ({ requeueDeadRecord: vi.fn() }));
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/services/admin/pendingRecords', () => ({ requeueDeadRecord }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { requeuePendingRecordAction } from '@/server-actions/admin/pendingRecords';

const SESSION = { sub: 'admin-1', role: 'admin' as const };

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(SESSION);
});

describe('requeuePendingRecordAction', () => {
  it('calls requireAdmin, service with full session, and revalidates on success', async () => {
    requeueDeadRecord.mockResolvedValue({ ok: true });
    const res = await requeuePendingRecordAction(fd({ id: 'rec-1' }));
    expect(requireAdmin).toHaveBeenCalled();
    expect(requeueDeadRecord).toHaveBeenCalledWith({}, SESSION, 'rec-1');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations/sync');
    expect(res).toEqual({ ok: true });
  });

  it('rejects a missing id with validation — bare stable code, no zod details (R2)', async () => {
    const res = await requeuePendingRecordAction(fd({}));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(requeueDeadRecord).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(['forbidden', 'not_found', 'not_dead'] as const)(
    'passes through the %s service error',
    async (error) => {
      requeueDeadRecord.mockResolvedValue({ ok: false, error });
      expect(await requeuePendingRecordAction(fd({ id: 'rec-1' }))).toEqual({ ok: false, error });
    }
  );

  it('CAS race surfaces as the same not_dead code the service returned (count=0)', async () => {
    requeueDeadRecord.mockResolvedValue({ ok: false, error: 'not_dead' });
    const res = await requeuePendingRecordAction(fd({ id: 'rec-race' }));
    expect(res).toEqual({ ok: false, error: 'not_dead' });
    // страница всё равно ревалидируется — состояние могло поменяться конкурентом
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations/sync');
  });
});
