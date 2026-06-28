import { describe, it, expect, vi } from 'vitest';
import { setManagerRole } from '@/lib/services/admin/managerRole';

function makePrisma(user: { role: string; managerRole: string | null } | null) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({})
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) }
  } as unknown as Parameters<typeof setManagerRole>[0];
}

describe('setManagerRole', () => {
  it('grants leader to a manager (changed + audit)', async () => {
    const prisma = makePrisma({ role: 'manager', managerRole: null });
    const res = await setManagerRole(prisma, 'admin-1', 'mgr-1', 'leader');
    expect(res).toEqual({ ok: true, changed: true });
    expect((prisma.user.update as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      where: { id: 'mgr-1' },
      data: { managerRole: 'leader' }
    });
  });

  it('refuses a non-manager target', async () => {
    const prisma = makePrisma({ role: 'organization', managerRole: null });
    expect(await setManagerRole(prisma, 'admin-1', 'u-1', 'leader')).toEqual({ ok: false, error: 'not_a_manager' });
  });

  it('refuses unknown user', async () => {
    const prisma = makePrisma(null);
    expect(await setManagerRole(prisma, 'admin-1', 'nope', 'leader')).toEqual({ ok: false, error: 'user_not_found' });
  });

  it('no-op when already in target role', async () => {
    const prisma = makePrisma({ role: 'manager', managerRole: 'leader' });
    const res = await setManagerRole(prisma, 'admin-1', 'mgr-1', 'leader');
    expect(res).toEqual({ ok: true, changed: false });
    expect((prisma.user.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
